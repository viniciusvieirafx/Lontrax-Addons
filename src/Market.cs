using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LontraxAddons;

/// <summary>Talks to the Battle.net API (WoW Forever namespaces, US region). Each person uses their own
/// Client ID / Secret from develop.battle.net, kept encrypted for this Windows user.</summary>
sealed class BlizzardClient
{
    const string Region = "us";
    public const string StaticNs = "static-forever-us";
    public const string DynamicNs = "dynamic-forever-us";
    static readonly HttpClient http = new(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
    { Timeout = TimeSpan.FromMinutes(4) };

    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    string? token;
    DateTime tokenUntil;

    public bool HasKeys => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);

    public void ForgetToken() => token = null;

    async Task<string> Token()
    {
        if (token != null && DateTime.UtcNow < tokenUntil) return token;
        if (!HasKeys) throw new MarketException("Falta colocar a chave da Blizzard.");
        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://oauth.battle.net/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "client_credentials" }),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic",
            Convert.ToBase64String(Encoding.UTF8.GetBytes($"{ClientId!.Trim()}:{ClientSecret!.Trim()}")));
        HttpResponseMessage res;
        try { res = await http.SendAsync(req); }
        catch (Exception ex) { throw new MarketException("Sem conexão com a Blizzard: " + ex.Message); }
        if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.BadRequest)
            throw new MarketException("A Blizzard recusou a chave. Confira o Client ID e o Client Secret.", badKeys: true);
        res.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        token = doc.RootElement.GetProperty("access_token").GetString();
        var secs = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;
        tokenUntil = DateTime.UtcNow.AddSeconds(Math.Max(60, secs - 120));
        return token!;
    }

    public sealed record Response(HttpStatusCode Status, byte[]? Body, DateTimeOffset? LastModified);

    public async Task<Response> Get(string path, string ns, DateTimeOffset? ifModifiedSince = null)
    {
        for (var attempt = 0; ; attempt++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://{Region}.api.blizzard.com{path}?namespace={ns}&locale=pt_BR");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await Token());
            if (ifModifiedSince != null) req.Headers.IfModifiedSince = ifModifiedSince;
            HttpResponseMessage res;
            try { res = await http.SendAsync(req); }
            catch (Exception) when (attempt < 2) { await Task.Delay(1500); continue; }
            catch (Exception ex) { throw new MarketException("Sem conexão com a Blizzard: " + ex.Message); }
            using (res)
            {
                if (res.StatusCode == HttpStatusCode.Unauthorized && attempt == 0) { token = null; continue; }
                if ((res.StatusCode == HttpStatusCode.TooManyRequests || (int)res.StatusCode >= 500) && attempt < 3)
                { await Task.Delay(1000 * (attempt + 1)); continue; }
                var lm = res.Content.Headers.LastModified;
                if (res.StatusCode == HttpStatusCode.NotModified) return new(res.StatusCode, null, lm ?? ifModifiedSince);
                if (!res.IsSuccessStatusCode) return new(res.StatusCode, null, lm);
                return new(res.StatusCode, await res.Content.ReadAsByteArrayAsync(), lm);
            }
        }
    }

    public async Task<JsonDocument?> GetJson(string path, string ns)
    {
        var r = await Get(path, ns);
        return r.Body == null ? null : JsonDocument.Parse(r.Body);
    }
}

sealed class MarketException(string message, bool badKeys = false) : Exception(message)
{
    public bool BadKeys { get; } = badKeys;
}

// ---------- data kept on disk (%LOCALAPPDATA%\LontraxAddons\ah) ----------

sealed class RecipeBook
{
    public int Version { get; set; } = 1;
    public DateTime Fetched { get; set; }
    public List<Profession> Professions { get; set; } = new();
    /// <summary>Price of reagents sold by NPC vendors (copper), keyed by item id.</summary>
    public Dictionary<int, long> Vendor { get; set; } = new();
}

sealed class Profession
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<Recipe> Recipes { get; set; } = new();
}

sealed class Recipe
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public int Item { get; set; }
    public string ItemName { get; set; } = "";
    public double Qty { get; set; } = 1;
    public List<Reagent> Reagents { get; set; } = new();
}

sealed class Reagent
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int Qty { get; set; }
}

/// <summary>One item's price in one snapshot. Min = cheapest listing; Market = average of the cheapest 15% of
/// units (ignores a single bait listing); Qty = units for sale.</summary>
sealed class Price
{
    public long Min { get; set; }
    public long Market { get; set; }
    public int Qty { get; set; }
    public int Listings { get; set; }
}

sealed class Snapshot
{
    public int House { get; set; }
    public DateTimeOffset LastModified { get; set; }
    public DateTime Fetched { get; set; }
    public Dictionary<int, Price> Prices { get; set; } = new();
    /// <summary>"jogo" when the prices came from the in-game "Escanear tudo" button; null = Blizzard.</summary>
    public string? Origem { get; set; }
}

sealed class HouseInfo
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Faction { get; set; } = "";
}

/// <summary>Hourly history per item: [unix hour, min, market, qty].</summary>
sealed class History
{
    public Dictionary<int, List<long[]>> Items { get; set; } = new();
}

sealed class Market
{
    public BlizzardClient Api { get; } = new();
    public RecipeBook? Book { get; private set; }
    public List<HouseInfo> Houses { get; private set; } = new();
    readonly Dictionary<int, Snapshot> snaps = new();
    readonly Dictionary<int, History> histories = new();

    /// <summary>AH cut on a sale (5%).</summary>
    public const double AhCut = 0.05;
    const int Ruleset = 2; // every ruleset lists the same houses
    static readonly JsonSerializerOptions Json = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    static string Dir { get { var d = Path.Combine(Config.DataDir, "ah"); Directory.CreateDirectory(d); return d; } }

    /// <summary>Reagents bought from NPCs (classic-era list; copper). The API price, when it answers, wins.</summary>
    static readonly Dictionary<int, long> KnownVendor = new()
    {
        [2320] = 10, [2321] = 100, [4291] = 500, [8343] = 2000, [14341] = 5000,          // threads
        [2324] = 25, [2325] = 1000, [2604] = 50, [2605] = 100, [4340] = 350, [4341] = 500,
        [4342] = 2500, [6260] = 50, [6261] = 1000, [10290] = 2500,                       // bleach & dyes
        [4289] = 50, [3371] = 20, [3372] = 200, [8925] = 2500, [18256] = 20000,           // salt & vials
        [2880] = 100, [3466] = 2000, [18567] = 15000, [3857] = 500,                       // flux & coal
        [4470] = 38, [11291] = 4500, [4399] = 200, [4400] = 2000, [6217] = 124,           // wood, stocks, rod
        [10647] = 2000, [10648] = 500, [17020] = 1000,                                    // ink, parchment, powder
        [2678] = 10, [2692] = 40, [3713] = 160, [159] = 25, [1179] = 125, [17194] = 10, [17196] = 50, [2894] = 50,
    };

    // ---------- keys ----------
    sealed class Keys { public string? Id { get; set; } public string? Secret { get; set; } }

    public static string KeysTextFile => Path.Combine(Config.DataDir, "blizzard-api.txt");

    public void LoadKeys(Settings s)
    {
        if (s.BlizzardKeysProtected != null)
        {
            try
            {
                var raw = ProtectedData.Unprotect(Convert.FromBase64String(s.BlizzardKeysProtected), null, DataProtectionScope.CurrentUser);
                var k = JsonSerializer.Deserialize<Keys>(raw);
                Api.ClientId = k?.Id; Api.ClientSecret = k?.Secret;
            }
            catch { }
        }
        // First run: take the keys from blizzard-api.txt (made during setup), store them encrypted, delete the file.
        if (!Api.HasKeys && File.Exists(KeysTextFile))
        {
            string? id = null, sec = null;
            foreach (var l in File.ReadAllLines(KeysTextFile))
            {
                var i = l.IndexOf('=');
                if (i < 0) continue;
                var k = l[..i].Trim().ToUpperInvariant(); var v = l[(i + 1)..].Trim();
                if (k == "CLIENT_ID") id = v;
                if (k == "CLIENT_SECRET") sec = v;
            }
            if (!string.IsNullOrEmpty(id) && !string.IsNullOrEmpty(sec))
            {
                SaveKeys(s, id, sec);
                try { File.Delete(KeysTextFile); } catch { }
            }
        }
    }

    public void SaveKeys(Settings s, string? id, string? secret)
    {
        Api.ClientId = id?.Trim(); Api.ClientSecret = secret?.Trim(); Api.ForgetToken();
        s.BlizzardKeysProtected = !Api.HasKeys ? null : Convert.ToBase64String(ProtectedData.Protect(
            JsonSerializer.SerializeToUtf8Bytes(new Keys { Id = Api.ClientId, Secret = Api.ClientSecret }), null, DataProtectionScope.CurrentUser));
        s.Save();
    }

    // ---------- recipes ----------
    /// <summary>A copy of the recipes ships inside the app (src\data), so the Mercado opens at once even on a
    /// friend's first run. The app refreshes it from Blizzard in the background once a week.</summary>
    static T? Embedded<T>(string name)
    {
        try
        {
            using var s = typeof(Market).Assembly.GetManifestResourceStream("data." + name);
            return s == null ? default : JsonSerializer.Deserialize<T>(s);
        }
        catch { return default; }
    }

    /// <summary>English names (src\data\nomes-en.json, made by tools\nomes_en.py) for the PT | EN toggle.</summary>
    public static string? EnglishNamesJson()
    {
        using var s = typeof(Market).Assembly.GetManifestResourceStream("data.nomes-en.json");
        if (s == null) return null;
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    public bool RecipesStale => Book == null || DateTime.UtcNow - Book.Fetched > TimeSpan.FromDays(7);

    /// <summary>Loads recipes from disk or the built-in copy (instant). Downloads from Blizzard only when there is
    /// nothing at all, or when <paramref name="force"/> is set (weekly background refresh).</summary>
    public async Task LoadRecipes(IProgress<double>? progress, bool force = false)
    {
        var file = Path.Combine(Dir, "receitas.json");
        if (Book == null && File.Exists(file))
            try { Book = JsonSerializer.Deserialize<RecipeBook>(File.ReadAllText(file)); } catch { }
        if (Book == null || Book.Professions.Count == 0)
        {
            var built = Embedded<RecipeBook>("receitas.json");
            if (built != null && built.Professions.Count > 0) Book = built;
        }
        if (!force && Book != null && Book.Professions.Count > 0) return;
        if (!Api.HasKeys && Book != null && Book.Professions.Count > 0) return; // no key: the built-in copy is the list

        var book = new RecipeBook { Fetched = DateTime.UtcNow };
        using var idx = await Api.GetJson("/data/wow/profession/index", BlizzardClient.StaticNs)
                        ?? throw new MarketException("A Blizzard não mandou a lista de profissões.");
        var profs = idx.RootElement.GetProperty("professions").EnumerateArray()
            .Select(p => (id: p.GetProperty("id").GetInt32(), name: p.TryGetProperty("name", out var n) ? n.GetString() : null))
            .Where(p => !string.IsNullOrEmpty(p.name)).ToList();

        // Every recipe id with its category, per profession.
        var todo = new List<(Profession prof, int recipe, string cat)>();
        foreach (var (id, name) in profs)
        {
            var prof = new Profession { Id = id, Name = name! };
            using var pd = await Api.GetJson($"/data/wow/profession/{id}", BlizzardClient.StaticNs);
            if (pd != null && pd.RootElement.TryGetProperty("skill_tiers", out var tiers))
                foreach (var t in tiers.EnumerateArray())
                {
                    using var td = await Api.GetJson($"/data/wow/profession/{id}/skill-tier/{t.GetProperty("id").GetInt32()}", BlizzardClient.StaticNs);
                    if (td == null || !td.RootElement.TryGetProperty("categories", out var cats)) continue;
                    foreach (var c in cats.EnumerateArray())
                        foreach (var r in c.GetProperty("recipes").EnumerateArray())
                            todo.Add((prof, r.GetProperty("id").GetInt32(), c.GetProperty("name").GetString() ?? ""));
                }
            book.Professions.Add(prof);
        }
        progress?.Report(0.05);

        var done = 0;
        var results = new System.Collections.Concurrent.ConcurrentBag<(Profession prof, Recipe r)>();
        await Parallel.ForEachAsync(todo, new ParallelOptions { MaxDegreeOfParallelism = 20 }, async (x, _) =>
        {
            using var rd = await Api.GetJson($"/data/wow/recipe/{x.recipe}", BlizzardClient.StaticNs);
            var p = Interlocked.Increment(ref done);
            if (p % 40 == 0) progress?.Report(0.05 + 0.9 * p / todo.Count);
            if (rd == null) return;
            var e = rd.RootElement;
            if (!e.TryGetProperty("crafted_item", out var ci) || !e.TryGetProperty("reagents", out var rgs)) return;
            var r = new Recipe
            {
                Id = x.recipe,
                Name = e.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "",
                Category = x.cat,
                Item = ci.GetProperty("id").GetInt32(),
                ItemName = ci.TryGetProperty("name", out var cn) ? cn.GetString() ?? "" : "",
                Qty = e.TryGetProperty("crafted_quantity", out var cq) && cq.TryGetProperty("value", out var cv) && cv.GetDouble() > 0 ? cv.GetDouble() : 1,
            };
            foreach (var g in rgs.EnumerateArray())
            {
                var it = g.GetProperty("reagent");
                r.Reagents.Add(new Reagent { Id = it.GetProperty("id").GetInt32(), Name = it.TryGetProperty("name", out var rn) ? rn.GetString() ?? "" : "", Qty = g.GetProperty("quantity").GetInt32() });
            }
            results.Add((x.prof, r));
        });
        foreach (var (prof, r) in results) prof.Recipes.Add(r);
        foreach (var p in book.Professions) p.Recipes.Sort((a, b) => a.Id.CompareTo(b.Id));
        book.Professions.RemoveAll(p => p.Recipes.Count == 0);

        // Vendor reagents: ask the API for the NPC price, keep the list price when it does not answer.
        var used = book.Professions.SelectMany(p => p.Recipes).SelectMany(r => r.Reagents).Select(r => r.Id).ToHashSet();
        foreach (var (id, fallback) in KnownVendor.Where(k => used.Contains(k.Key)))
        {
            long price = fallback;
            try
            {
                using var it = await Api.GetJson($"/data/wow/item/{id}", BlizzardClient.StaticNs);
                if (it != null && it.RootElement.TryGetProperty("purchase_price", out var pp) && pp.GetInt64() > 0)
                    price = pp.GetInt64() / Math.Max(1, it.RootElement.TryGetProperty("purchase_quantity", out var pq) ? pq.GetInt32() : 1);
            }
            catch { }
            book.Vendor[id] = price;
        }
        progress?.Report(1);
        Book = book;
        File.WriteAllText(file, JsonSerializer.Serialize(book, Json));
    }

    // ---------- houses ----------
    public async Task LoadHouses()
    {
        var file = Path.Combine(Dir, "casas.json");
        if (Houses.Count == 0 && File.Exists(file))
            try { Houses = JsonSerializer.Deserialize<List<HouseInfo>>(File.ReadAllText(file)) ?? new(); } catch { }
        if (Houses.Count == 0) Houses = Embedded<List<HouseInfo>>("casas.json") ?? new();
        if (Houses.Count > 0) return;
        using var d = await Api.GetJson($"/data/wow/ruleset/{Ruleset}/auctions/", BlizzardClient.DynamicNs)
                      ?? throw new MarketException("A Blizzard não mandou a lista de casas de leilão.");
        Houses = d.RootElement.GetProperty("auctions").EnumerateArray().Select(h =>
        {
            var name = h.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
            var fac = name.Contains("Alian") ? "Aliança" : name.Contains("Horda") ? "Horda" : name.Contains("negra") || name.Contains("Blackwater") ? "Aguanegra" : "?";
            return new HouseInfo { Id = h.GetProperty("id").GetInt32(), Name = name, Faction = fac };
        }).OrderBy(h => h.Faction != "Aliança").ThenBy(h => h.Faction).ThenBy(h => h.Id).ToList();
        File.WriteAllText(file, JsonSerializer.Serialize(Houses, Json));
    }

    // ---------- prices ----------
    public Snapshot? GetSnapshot(int house)
    {
        if (snaps.TryGetValue(house, out var s)) return s;
        var file = Path.Combine(Dir, $"casa-{house}.json");
        if (!File.Exists(file)) return null;
        try { s = JsonSerializer.Deserialize<Snapshot>(File.ReadAllText(file)); } catch { return null; }
        if (s != null) snaps[house] = s;
        return s;
    }

    /// <summary>Downloads the house when Blizzard has a newer dump. Returns true when there is new data.</summary>
    public async Task<bool> RefreshHouse(int house, bool keepHistory = true)
    {
        var old = GetSnapshot(house);
        var since = old?.LastModified;
        var basePath = $"/data/wow/ruleset/{Ruleset}/auctions/{house}";
        // Both lists at the same time (≈17 MB together); with If-Modified-Since both answer "no change" in a blink.
        var comTask = Api.Get(basePath + "/commodities", BlizzardClient.DynamicNs, since);
        var aucTask = Api.Get(basePath, BlizzardClient.DynamicNs, since);
        var com = await comTask;
        var auc = await aucTask;
        if (com.Status == HttpStatusCode.NotModified) { if (old != null) old.Fetched = DateTime.UtcNow; return false; }
        if (com.Body == null) throw new MarketException($"A Blizzard não mandou os preços (erro {(int)com.Status}).");
        if (auc.Status == HttpStatusCode.NotModified) auc = await Api.Get(basePath, BlizzardClient.DynamicNs);

        var units = new Dictionary<int, List<(long unit, int qty)>>();
        void Add(int id, long unit, int qty)
        {
            if (unit <= 0 || qty <= 0) return;
            if (!units.TryGetValue(id, out var l)) units[id] = l = new();
            l.Add((unit, qty));
        }
        using (var cd = JsonDocument.Parse(com.Body))
            if (cd.RootElement.TryGetProperty("auctions", out var arr))
                foreach (var a in arr.EnumerateArray())
                    Add(a.GetProperty("item").GetProperty("id").GetInt32(), a.GetProperty("unit_price").GetInt64(), a.GetProperty("quantity").GetInt32());
        if (auc.Body != null)
            using (var ad = JsonDocument.Parse(auc.Body))
                if (ad.RootElement.TryGetProperty("auctions", out var arr))
                    foreach (var a in arr.EnumerateArray())
                    {
                        if (!a.TryGetProperty("buyout", out var bo)) continue; // bid-only
                        var q = a.TryGetProperty("quantity", out var qq) ? qq.GetInt32() : 1;
                        Add(a.GetProperty("item").GetProperty("id").GetInt32(), bo.GetInt64() / Math.Max(1, q), q);
                    }

        var snap = new Snapshot { House = house, LastModified = com.LastModified ?? DateTimeOffset.UtcNow, Fetched = DateTime.UtcNow };
        foreach (var (id, l) in units)
        {
            l.Sort((a, b) => a.unit.CompareTo(b.unit));
            var total = l.Sum(x => x.qty);
            var take = Math.Max(1, (int)Math.Ceiling(total * 0.15));
            long sum = 0; var got = 0;
            foreach (var (u, q) in l)
            {
                var t = Math.Min(q, take - got);
                sum += u * t; got += t;
                if (got >= take) break;
            }
            snap.Prices[id] = new Price { Min = l[0].unit, Market = sum / Math.Max(1, got), Qty = total, Listings = l.Count };
        }
        snaps[house] = snap;
        File.WriteAllText(Path.Combine(Dir, $"casa-{house}.json"), JsonSerializer.Serialize(snap, Json));
        if (keepHistory) AddHistory(house, snap);
        return true;
    }

    /// <summary>Prices from the in-game scan (Lontrax Mercado "Escanear tudo") become the house prices when they
    /// are newer than what the app has. Blizzard data replaces them again once Blizzard has a newer dump.</summary>
    public bool ApplyGameScan(int house, DateTimeOffset when, Dictionary<int, Price> prices)
    {
        var old = GetSnapshot(house);
        if (prices.Count == 0 || (old != null && old.LastModified >= when)) return false;
        var snap = new Snapshot { House = house, LastModified = when, Fetched = DateTime.UtcNow, Prices = prices, Origem = "jogo" };
        snaps[house] = snap;
        File.WriteAllText(Path.Combine(Dir, $"casa-{house}.json"), JsonSerializer.Serialize(snap, Json));
        AddHistory(house, snap);
        return true;
    }

    // ---------- shared prices (no key needed) ----------
    /// <summary>The GitHub login the app already has. Without an own Blizzard key, prices come from the
    /// "precos" branch of the Lontrax repo, which GitHub Actions refreshes every hour (tools/precos.py).</summary>
    public GitHubClient? Shared { get; set; }
    public const string SharedRef = "precos";
    string? sharedSha;

    public bool UsingShared => !Api.HasKeys;
    public bool CanFetch => Api.HasKeys || !string.IsNullOrEmpty(Shared?.Token);

    /// <summary>Prices for one house: from Blizzard with the person's own key, or from the shared file.</summary>
    /// <summary>Asks Blizzard for a token and one small page: throws a MarketException when the key is wrong.</summary>
    public async Task CheckKeys()
    {
        Api.ForgetToken();
        using var _ = await Api.GetJson("/data/wow/ruleset/index", BlizzardClient.DynamicNs);
    }

    public Task<bool> Refresh(int house, bool keepHistory = true) =>
        Api.HasKeys ? RefreshHouse(house, keepHistory) : RefreshShared(house, keepHistory);

    async Task<bool> RefreshShared(int house, bool keepHistory)
    {
        if (Shared == null || string.IsNullOrEmpty(Shared.Token)) throw new MarketException("Entre com o GitHub para ver os preços da galera.");
        var old = GetSnapshot(house);
        try
        {
            // Cheap check first: the branch has one commit per hour; skip the download when nothing changed.
            var c = await Shared.GetLatestCommit(Config.CatalogRepo, SharedRef);
            if (c.Sha == sharedSha && old != null) { old.Fetched = DateTime.UtcNow; return false; }
            var raw = await Shared.GetRawFile(Config.CatalogRepo, $"casa-{house}.json", SharedRef);
            var snap = JsonSerializer.Deserialize<Snapshot>(raw) ?? throw new MarketException("O arquivo de preços veio vazio.");
            sharedSha = c.Sha;
            snap.Fetched = DateTime.UtcNow;
            if (old != null && old.LastModified >= snap.LastModified) { old.Fetched = snap.Fetched; return false; }
            snaps[house] = snap;
            File.WriteAllText(Path.Combine(Dir, $"casa-{house}.json"), JsonSerializer.Serialize(snap, Json));
            if (keepHistory) AddHistory(house, snap);
            return true;
        }
        catch (GitHubException ex) { throw new MarketException("Preços da galera: " + ex.Message); }
    }

    // ---------- character: profession level + known recipes ----------
    public sealed class CharProf
    {
        public int nivel { get; set; }
        public int max { get; set; }
        public List<int> receitas { get; set; } = new();
    }
    public sealed class CharInfo
    {
        public string slug { get; set; } = "";
        public string nome { get; set; } = "";
        public Dictionary<string, CharProf> profissoes { get; set; } = new();
        public DateTime lido { get; set; }
    }
    sealed class CharFile
    {
        public string? guilda { get; set; }
        public Dictionary<string, CharInfo> personagens { get; set; } = new();
    }

    CharFile? guildChars;
    string? guildCharsSha;

    /// <summary>"Miranajanela Lontrax" → "miranajanela-lontrax" (how the Forever API names characters).</summary>
    public static string Slug(string name) =>
        string.Join("-", name.Trim().ToLowerInvariant().Split(new[] { ' ', '-' }, StringSplitOptions.RemoveEmptyEntries));

    /// <summary>The guild's characters published hourly by GitHub (tools/precos.py), for the character picker.</summary>
    public async Task<List<(string slug, string nome)>> GuildCharacters()
    {
        await LoadGuildFile();
        return guildChars?.personagens.Select(kv => (kv.Key, kv.Value.nome)).OrderBy(x => x.nome, StringComparer.CurrentCultureIgnoreCase).ToList()
               ?? new List<(string, string)>();
    }

    async Task LoadGuildFile()
    {
        if (Shared == null || string.IsNullOrEmpty(Shared.Token)) return;
        try
        {
            var c = await Shared.GetLatestCommit(Config.CatalogRepo, SharedRef);
            if (c.Sha == guildCharsSha && guildChars != null) return;
            var raw = await Shared.GetRawFile(Config.CatalogRepo, "personagens.json", SharedRef);
            guildChars = JsonSerializer.Deserialize<CharFile>(raw);
            guildCharsSha = c.Sha;
        }
        catch (GitHubException) { }
    }

    /// <summary>Reads one character's professions: straight from Blizzard with an own key (fresh after logout),
    /// otherwise from the guild file. Null when not found.</summary>
    public async Task<CharInfo?> LoadCharacter(string slug)
    {
        CharInfo? info = null;
        if (Api.HasKeys)
        {
            using var d = await Api.GetJson($"/profile/wow/character/{Uri.EscapeDataString(slug)}/professions", "profile-forever-us");
            if (d != null)
            {
                var e = d.RootElement;
                info = new CharInfo { slug = slug };
                if (e.TryGetProperty("character", out var ch))
                    info.nome = $"{(ch.TryGetProperty("name", out var n) ? n.GetString() : "")} {(ch.TryGetProperty("surname", out var s) ? s.GetString() : "")}".Trim();
                foreach (var group in new[] { "primaries", "secondaries" })
                    if (e.TryGetProperty(group, out var arr))
                        foreach (var pr in arr.EnumerateArray())
                        {
                            var pid = pr.GetProperty("profession").GetProperty("id").GetInt32().ToString();
                            if (!info.profissoes.TryGetValue(pid, out var cp)) info.profissoes[pid] = cp = new CharProf();
                            if (!pr.TryGetProperty("tiers", out var tiers)) continue;
                            foreach (var t in tiers.EnumerateArray())
                            {
                                cp.nivel = Math.Max(cp.nivel, t.TryGetProperty("skill_points", out var sp) ? sp.GetInt32() : 0);
                                cp.max = Math.Max(cp.max, t.TryGetProperty("max_skill_points", out var mp) ? mp.GetInt32() : 0);
                                if (t.TryGetProperty("known_recipes", out var kr))
                                    cp.receitas.AddRange(kr.EnumerateArray().Select(r => r.GetProperty("id").GetInt32()));
                            }
                        }
            }
        }
        if (info == null)
        {
            await LoadGuildFile();
            if (guildChars != null && guildChars.personagens.TryGetValue(slug, out var g)) { info = g; info.slug = slug; }
        }
        if (info != null) info.lido = DateTime.UtcNow;
        return info;
    }

    // ---------- history (14 days, only items used by recipes) ----------
    History GetHistory(int house)
    {
        if (histories.TryGetValue(house, out var h)) return h;
        var file = Path.Combine(Dir, $"historico-{house}.json");
        try { h = File.Exists(file) ? JsonSerializer.Deserialize<History>(File.ReadAllText(file)) : null; } catch { h = null; }
        return histories[house] = h ?? new History();
    }

    void AddHistory(int house, Snapshot snap)
    {
        if (Book == null) return;
        var h = GetHistory(house);
        var hour = snap.LastModified.ToUnixTimeSeconds() / 3600;
        var keep = hour - 14 * 24;
        var ids = Book.Professions.SelectMany(p => p.Recipes).SelectMany(r => r.Reagents.Select(x => x.Id).Append(r.Item)).ToHashSet();
        foreach (var id in ids)
        {
            if (!snap.Prices.TryGetValue(id, out var p)) continue;
            if (!h.Items.TryGetValue(id, out var l)) h.Items[id] = l = new();
            if (l.Count > 0 && l[^1][0] == hour) l[^1] = new[] { hour, p.Min, p.Market, p.Qty };
            else l.Add(new[] { hour, p.Min, p.Market, p.Qty });
            l.RemoveAll(x => x[0] < keep);
        }
        File.WriteAllText(Path.Combine(Dir, $"historico-{house}.json"), JsonSerializer.Serialize(h, Json));
    }

    string? historySha;

    /// <summary>The GitHub job keeps 14 days of prices (one point every 3 hours) for everyone, so the chart and the
    /// 24h column work even when the app was closed. Merged into the local history (union by hour).</summary>
    public async Task MergeSharedHistory(int house)
    {
        if (Shared == null || string.IsNullOrEmpty(Shared.Token)) return;
        try
        {
            var c = await Shared.GetLatestCommit(Config.CatalogRepo, SharedRef);
            if (c.Sha == historySha) return;
            var raw = await Shared.GetRawFile(Config.CatalogRepo, $"historico-{house}.json", SharedRef);
            var remote = JsonSerializer.Deserialize<History>(raw);
            historySha = c.Sha;
            if (remote == null || remote.Items.Count == 0) return;
            var h = GetHistory(house);
            var newest = remote.Items.Values.Where(l => l.Count > 0).Select(l => l[^1][0]).DefaultIfEmpty(0).Max();
            var keep = newest - 14 * 24;
            foreach (var (id, pts) in remote.Items)
            {
                var byHour = new SortedDictionary<long, long[]>();
                if (h.Items.TryGetValue(id, out var mine)) foreach (var p in mine) byHour[p[0]] = p;
                foreach (var p in pts) if (!byHour.ContainsKey(p[0])) byHour[p[0]] = p; // own hourly points win
                h.Items[id] = byHour.Values.Where(p => p[0] >= keep).ToList();
            }
            File.WriteAllText(Path.Combine(Dir, $"historico-{house}.json"), JsonSerializer.Serialize(h, Json));
        }
        catch (GitHubException) { }       // file not there yet (first hours)
        catch (JsonException) { }
    }

    public List<long[]> ItemHistory(int house, int item) =>
        GetHistory(house).Items.TryGetValue(item, out var l) ? l : new List<long[]>();

    /// <summary>Price of the same item ~24 hours before the newest point (market price), or null.</summary>
    long? DayAgo(int house, int item)
    {
        var l = ItemHistory(house, item);
        if (l.Count < 2) return null;
        var target = l[^1][0] - 24;
        long[]? best = null;
        foreach (var x in l) if (x[0] <= target) best = x;
        return best?[2];
    }

    /// <summary>Highest stock seen in the last 24 hours (to tell if the item is selling), or null.</summary>
    int? PeakQty(int house, int item)
    {
        var l = ItemHistory(house, item);
        if (l.Count < 2) return null;
        var from = l[^1][0] - 24;
        long peak = 0;
        foreach (var x in l) if (x[0] >= from && x.Length > 3 && x[3] > peak) peak = x[3];
        return peak > 0 ? (int)peak : null;
    }

    /// <summary>What one unit really sells for, not what the cheapest seller is asking: 1 copper under the
    /// cheapest listing (to be the first one bought), and never above the typical cheapest price of the last
    /// 7 days (median), so a price that spiked now or one lonely listing at a crazy price doesn't count.</summary>
    public long? SellUnit(int house, int item, Price? p)
    {
        if (p == null || p.Min <= 0) return null;
        var unit = Math.Max(1, p.Min - 1);
        var l = ItemHistory(house, item);
        if (l.Count > 0)
        {
            var from = l[^1][0] - 7 * 24;
            var mins = l.Where(x => x[0] >= from && x[1] > 0).Select(x => x[1]).OrderBy(x => x).ToList();
            if (mins.Count >= 4) unit = Math.Min(unit, Math.Max(1, mins[mins.Count / 2] - 1));
        }
        return unit;
    }

    // ---------- profit ----------
    public sealed record ReagentRow(int id, string nome, int qtd, long? preco, string fonte, int aVenda);
    public sealed record Row(int receita, string nome, string profissao, string categoria, int item, double qtdFeita,
        long custo, long? venda, long? vendaMercado, long? lucro, double? margem, int aVenda, int anuncios,
        long? ontem, bool completo, List<ReagentRow> materiais, int? estoquePico, long? vendaAgora);

    public List<Row> Compute(int house, IEnumerable<int> professionIds)
    {
        var rows = new List<Row>();
        var snap = GetSnapshot(house);
        if (Book == null || snap == null) return rows;
        var want = professionIds.ToHashSet();
        foreach (var prof in Book.Professions.Where(p => want.Count == 0 || want.Contains(p.Id)))
            foreach (var r in prof.Recipes)
            {
                long cost = 0; var complete = true;
                var mats = new List<ReagentRow>();
                foreach (var g in r.Reagents)
                {
                    snap.Prices.TryGetValue(g.Id, out var p);
                    Book.Vendor.TryGetValue(g.Id, out var vendor);
                    long? unit; string src;
                    if (vendor > 0 && (p == null || vendor <= p.Market)) { unit = vendor; src = "npc"; }
                    else if (p != null) { unit = p.Market; src = "ah"; }
                    else { unit = null; src = "falta"; complete = false; }
                    if (unit != null) cost += unit.Value * g.Qty;
                    mats.Add(new ReagentRow(g.Id, g.Name, g.Qty, unit, src, p?.Qty ?? 0));
                }
                snap.Prices.TryGetValue(r.Item, out var outP);
                var sellUnit = SellUnit(house, r.Item, outP);
                long? sell = sellUnit == null ? null : (long)(sellUnit.Value * r.Qty);
                long? sellNow = outP == null ? null : (long)(outP.Min * r.Qty);
                long? sellMkt = outP == null ? null : (long)(outP.Market * r.Qty);
                long? profit = sell == null || !complete ? null : (long)(sell.Value * (1 - AhCut)) - cost;
                double? margin = profit == null || cost <= 0 ? null : (double)profit.Value / cost;
                var day = outP == null ? null : DayAgo(house, r.Item);
                rows.Add(new Row(r.Id, r.ItemName.Length > 0 ? r.ItemName : r.Name, prof.Name, r.Category, r.Item, r.Qty,
                    cost, sell, sellMkt, profit, margin, outP?.Qty ?? 0, outP?.Listings ?? 0, day == null ? null : (long)(day.Value * r.Qty), complete, mats,
                    outP == null ? null : PeakQty(house, r.Item), sellNow));
            }
        return rows;
    }

    /// <summary>Cheapest price of a few common items in every house of a faction, so the person can tell
    /// which house is theirs by looking in-game.</summary>
    public async Task<List<object>> CompareHouses(string faction, IProgress<double>? progress)
    {
        var check = new (int id, string name)[] { (2318, "Couro Leve"), (2447, "Florpaz"), (2589, "Tecido de Linho"), (2770, "Minério de Cobre") };
        var list = new List<object>();
        var hs = Houses.Where(h => h.Faction == faction).ToList();
        for (var i = 0; i < hs.Count; i++)
        {
            var h = hs[i];
            var s = GetSnapshot(h.Id);
            if (s == null || DateTime.UtcNow - s.Fetched > TimeSpan.FromHours(2)) { await Refresh(h.Id, keepHistory: false); s = GetSnapshot(h.Id); }
            progress?.Report((i + 1.0) / hs.Count);
            if (s == null) continue;
            list.Add(new
            {
                id = h.Id,
                anuncios = s.Prices.Values.Sum(p => p.Listings),
                itens = check.Select(c => new { id = c.id, nome = c.name, preco =s.Prices.TryGetValue(c.id, out var p) ? p.Min : (long?)null }).ToList(),
            });
        }
        return list;
    }
}
