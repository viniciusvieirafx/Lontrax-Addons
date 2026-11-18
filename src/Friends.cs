using System.Globalization;
using System.Text;
using System.Text.Json;

namespace LontraxAddons;

/// <summary>Friends tab: reads what the in-game addon Lontrax Mercado (its Amigos.lua, 1.4.0+) saved
/// (WTF\Account\*\SavedVariables\LontraxAmigos.lua), keeps a level history per friend and, with an own
/// Blizzard key, adds guild / item level / last login from the Forever character API.
/// The character picture needs no key: render.worldofwarcraft.com is public and the character id is the
/// end of the in-game GUID ("Player-6926-004E61DB" → 0x4E61DB).</summary>
sealed class Friends
{
    public const int MaxLevel = 60;

    public sealed class Friend
    {
        public string slug { get; set; } = "";
        public string nome { get; set; } = "";
        public string? sobrenome { get; set; }
        public int nivel { get; set; }
        public string? classe { get; set; }
        public string? classeEn { get; set; }
        public string? raca { get; set; }
        public string? area { get; set; }
        public bool online { get; set; }
        public long? visto { get; set; }
        public string? nota { get; set; }
        public bool bnet { get; set; }
        /// <summary>One of your own characters (shown first, with its own frame).</summary>
        public bool eu { get; set; }
        public string? conta { get; set; }
        public List<string> amigoDe { get; set; } = new();
        public string? boneco { get; set; }
        public string? rosto { get; set; }
        // from the API (own key only)
        public string? guilda { get; set; }
        public int? ilvl { get; set; }
        public long? ultimoLogin { get; set; }
        // from the local history
        public int ganhou7 { get; set; }
        public int ganhou30 { get; set; }
        public List<int[]> historico { get; set; } = new();
    }

    sealed class History
    {
        /// <summary>slug → [[unix day, level], ...] (one point per day, only kept when it changes).</summary>
        public Dictionary<string, List<int[]>> niveis { get; set; } = new();
    }

    sealed class ApiInfo
    {
        public DateTime lido { get; set; }
        public bool achou { get; set; }
        public int? nivel { get; set; }
        public string? guilda { get; set; }
        public int? ilvl { get; set; }
        public long? ultimoLogin { get; set; }
        public string? classeEn { get; set; }
        public string? raca { get; set; }
    }

    static string Dir => Path.Combine(Config.DataDir, "amigos");
    static string HistoryFile => Path.Combine(Dir, "historico.json");
    static string ApiFile => Path.Combine(Dir, "api.json");

    Dictionary<string, ApiInfo>? apiCache;
    bool apiBusy;

    /// <summary>Every SavedVariables file that may hold LontraxAmigosDB (one or two per WoW account folder).
    /// WoW saves an addon's variables in a file named after the addon, so since the friends list moved into
    /// Lontrax Mercado it lives in LontraxMercado.lua; LontraxAmigos.lua is the short-lived separate addon.</summary>
    public static List<string> Files(string? addOnsPath)
    {
        var list = new List<string>();
        if (string.IsNullOrEmpty(addOnsPath)) return list;
        try
        {
            var flavor = Directory.GetParent(addOnsPath)?.Parent?.FullName;
            var accounts = flavor == null ? null : Path.Combine(flavor, "WTF", "Account");
            if (accounts == null || !Directory.Exists(accounts)) return list;
            foreach (var acc in Directory.GetDirectories(accounts))
            {
                foreach (var name in new[] { "LontraxMercado.lua", "LontraxAmigos.lua" })
                {
                    var f = Path.Combine(acc, "SavedVariables", name);
                    if (File.Exists(f)) list.Add(f);
                }
            }
        }
        catch { }
        return list;
    }

    /// <summary>"sem" = Lontrax Mercado not installed, "velho" = installed but before 1.4.0 (no friends list), "ok".</summary>
    public static string AddonState(string? addOnsPath)
    {
        if (string.IsNullOrEmpty(addOnsPath)) return "sem";
        var dir = Path.Combine(addOnsPath, "LontraxMercado");
        if (!File.Exists(Path.Combine(dir, "LontraxMercado.toc"))) return "sem";
        return File.Exists(Path.Combine(dir, "Amigos.lua")) ? "ok" : "velho";
    }

    /// <summary>"Miranajanela Lontrax" → "miranajanela-lontrax" (how the Forever API names characters).</summary>
    public static string Slug(string nome, string? sobrenome) =>
        string.IsNullOrEmpty(sobrenome) ? nome.ToLowerInvariant() : (nome + "-" + sobrenome).ToLowerInvariant();

    /// <summary>"Player-6926-004E61DB" → 5136859.</summary>
    public static long? CharacterId(string? guid)
    {
        if (string.IsNullOrEmpty(guid)) return null;
        var parts = guid.Split('-');
        if (parts.Length < 3 || parts[0] != "Player") return null;
        return long.TryParse(parts[^1], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var id) && id > 0 ? id : null;
    }

    static string Render(long id, string kind) =>
        $"https://render.worldofwarcraft.com/forever-us/character/{id % 256}/{id}-{kind}";

    /// <summary>Everyone in the friends lists of all own characters, merged, newest data wins.</summary>
    public (List<Friend> list, bool found, DateTime? updated) Read(string? addOnsPath)
    {
        var bySlug = new Dictionary<string, Friend>();
        var found = false;
        DateTime? updated = null;
        foreach (var file in Files(addOnsPath))
        {
            Dictionary<object, object?>? db;
            try { db = Lua.ParseAssignment(File.ReadAllText(file, Encoding.UTF8), "LontraxAmigosDB"); }
            catch { continue; }
            if (db?.GetValueOrDefault("chars") is not Dictionary<object, object?> chars) continue;
            found = true;
            try { var w = File.GetLastWriteTime(file); if (updated == null || w > updated) updated = w; } catch { }
            foreach (var (_, cv) in chars)
            {
                if (cv is not Dictionary<object, object?> c) continue;
                var mine = Str(c, "nome") ?? "?";
                // your own character (Lontrax Mercado 1.4.5+ also saves level, class, race, zone)
                if (Str(c, "nome") is string myName)
                {
                    var mySur = Str(c, "sobrenome");
                    var mySlug = Slug(myName, mySur);
                    if (!bySlug.TryGetValue(mySlug, out var me))
                        bySlug[mySlug] = me = new Friend { slug = mySlug, nome = myName, sobrenome = mySur };
                    me.eu = true;
                    var myVisto = (long?)Num(c, "visto") ?? (long?)Num(c, "atualizado");
                    if ((myVisto ?? 0) >= (me.visto ?? 0))
                    {
                        me.visto = myVisto;
                        me.area = Str(c, "area") ?? me.area;
                        me.classe = Str(c, "classe") ?? me.classe;
                    }
                    if ((int)(Num(c, "nivel") ?? 0) is int ml && ml > me.nivel) me.nivel = ml;
                    me.classeEn ??= Str(c, "classeEn");
                    me.raca ??= Str(c, "raca");
                    var myGuid = Str(c, "guid");
                    if (me.boneco == null && CharacterId(myGuid ?? CharKey(chars, c)) is long myId)
                    {
                        me.boneco = Render(myId, "main-raw.png");
                        me.rosto = Render(myId, "avatar.jpg");
                    }
                }
                foreach (var (part, isBnet) in new[] { ("amigos", false), ("bnet", true) })
                {
                    if (c.GetValueOrDefault(part) is not Dictionary<object, object?> fr) continue;
                    foreach (var (_, ev) in fr)
                    {
                        if (ev is not Dictionary<object, object?> e || Str(e, "nome") is not string nome) continue;
                        var sob = Str(e, "sobrenome");
                        var slug = Slug(nome, sob);
                        var visto = (long?)Num(e, "visto");
                        if (!bySlug.TryGetValue(slug, out var f))
                            bySlug[slug] = f = new Friend { slug = slug, nome = nome, sobrenome = sob };
                        // keep the freshest look at this friend
                        var fresher = (visto ?? 0) >= (f.visto ?? 0);
                        int lvl = (int)(Num(e, "nivel") ?? 0);
                        if (lvl > f.nivel) f.nivel = lvl;
                        f.sobrenome ??= sob;
                        if (fresher || f.classe == null) f.classe = Str(e, "classe") ?? f.classe;
                        f.classeEn ??= Str(e, "classeEn");
                        f.raca ??= Str(e, "raca");
                        if (fresher) { f.area = Str(e, "area") ?? f.area; f.online = Bool(e, "online"); }
                        if (visto != null && visto > (f.visto ?? 0)) f.visto = visto;
                        f.nota ??= Str(e, "nota") is string n && n != "" ? n : null;
                        if (isBnet) { f.bnet = true; if (Str(e, "conta") is string cn && !cn.StartsWith("|K")) f.conta ??= cn; }
                        if (!f.amigoDe.Contains(mine)) f.amigoDe.Add(mine);
                        if (f.boneco == null && CharacterId(Str(e, "guid")) is long id)
                        {
                            f.boneco = Render(id, "main-raw.png");
                            f.rosto = Render(id, "avatar.jpg");
                        }
                    }
                }
            }
        }
        if (found) KeepKnown(bySlug);
        var list = bySlug.Values.ToList();
        ApplyApi(list);
        ApplyHistory(list);
        return (list, found, updated);
    }

    // ---------- everyone ever seen ----------
    static string KnownFile => Path.Combine(Dir, "conhecidos.json");

    /// <summary>The list only grows: a friend missing from the game's file (old addon versions dropped people when
    /// the game sent a partial list at login) comes back from the app's own copy, shown as offline.</summary>
    static void KeepKnown(Dictionary<string, Friend> bySlug)
    {
        Dictionary<string, Friend> known;
        try { known = File.Exists(KnownFile) ? JsonSerializer.Deserialize<Dictionary<string, Friend>>(File.ReadAllText(KnownFile)) ?? new() : new(); }
        catch { known = new(); }
        foreach (var (slug, old) in known)
        {
            if (bySlug.TryGetValue(slug, out var now))
            {
                // fill what the new copy lacks (e.g. level or picture from an older save)
                if (old.nivel > now.nivel) now.nivel = old.nivel;
                now.classe ??= old.classe; now.classeEn ??= old.classeEn; now.raca ??= old.raca;
                now.boneco ??= old.boneco; now.rosto ??= old.rosto; now.conta ??= old.conta; now.nota ??= old.nota;
                if ((old.visto ?? 0) > (now.visto ?? 0)) now.visto = old.visto;
                now.bnet |= old.bnet; now.eu |= old.eu;
                continue;
            }
            old.online = false;
            old.historico = new();
            bySlug[slug] = old;
        }
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(KnownFile, JsonSerializer.Serialize(bySlug));
        }
        catch (Exception ex) { MainForm.LogError("amigos", ex); }
    }

    // ---------- level history ----------
    void ApplyHistory(List<Friend> list)
    {
        History h;
        try { h = File.Exists(HistoryFile) ? JsonSerializer.Deserialize<History>(File.ReadAllText(HistoryFile)) ?? new() : new(); }
        catch { h = new(); }
        var today = (int)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 86400);
        var changed = false;
        foreach (var f in list)
        {
            if (f.nivel <= 0) continue;
            if (!h.niveis.TryGetValue(f.slug, out var pts)) h.niveis[f.slug] = pts = new();
            // every level change is a point (several on the same day are fine: it is a few bytes)
            if (pts.Count == 0 || pts[^1][1] != f.nivel)
            {
                pts.Add(new[] { today, f.nivel });
                changed = true;
            }
            f.historico = pts.Where(p => p[0] >= today - 90).ToList();
            f.ganhou7 = Gained(pts, today - 7, f.nivel);
            f.ganhou30 = Gained(pts, today - 30, f.nivel);
        }
        if (!changed) return;
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(HistoryFile, JsonSerializer.Serialize(h));
        }
        catch (Exception ex) { MainForm.LogError("amigos", ex); }
    }

    /// <summary>Levels gained since <paramref name="fromDay"/> (0 when the history starts after it).</summary>
    static int Gained(List<int[]> pts, int fromDay, int now)
    {
        if (pts.Count == 0 || pts[0][0] > fromDay) return pts.Count > 1 ? now - pts[0][1] : 0;
        var before = pts.LastOrDefault(p => p[0] <= fromDay);
        return before == null ? 0 : Math.Max(0, now - before[1]);
    }

    // ---------- Blizzard API (own key only) ----------
    void ApplyApi(List<Friend> list)
    {
        apiCache ??= LoadApiCache();
        foreach (var f in list)
        {
            if (!apiCache.TryGetValue(f.slug, out var a) || !a.achou) continue;
            if (a.nivel is int n && n > f.nivel) f.nivel = n;
            f.guilda = a.guilda;
            f.ilvl = a.ilvl;
            f.ultimoLogin = a.ultimoLogin;
            f.classeEn ??= a.classeEn;
            f.raca ??= a.raca;
        }
    }

    static Dictionary<string, ApiInfo> LoadApiCache()
    {
        try { return File.Exists(ApiFile) ? JsonSerializer.Deserialize<Dictionary<string, ApiInfo>>(File.ReadAllText(ApiFile)) ?? new() : new(); }
        catch { return new(); }
    }

    /// <summary>Refreshes API data older than 30 min. True when something new came in.</summary>
    public async Task<bool> RefreshApi(BlizzardClient api, IEnumerable<string> slugs)
    {
        if (!api.HasKeys || apiBusy) return false;
        apiBusy = true;
        var any = false;
        try
        {
            apiCache ??= LoadApiCache();
            foreach (var slug in slugs.Distinct())
            {
                if (apiCache.TryGetValue(slug, out var old) && DateTime.UtcNow - old.lido < TimeSpan.FromMinutes(30)) continue;
                var info = new ApiInfo { lido = DateTime.UtcNow };
                try
                {
                    using var d = await api.GetJson($"/profile/wow/character/{Uri.EscapeDataString(slug)}", "profile-forever-us");
                    if (d != null)
                    {
                        var e = d.RootElement;
                        info.achou = true;
                        if (e.TryGetProperty("level", out var l)) info.nivel = l.GetInt32();
                        if (e.TryGetProperty("guild", out var g) && g.TryGetProperty("name", out var gn)) info.guilda = gn.GetString();
                        if (e.TryGetProperty("equipped_item_level", out var il)) info.ilvl = il.GetInt32();
                        if (e.TryGetProperty("last_login_timestamp", out var ll)) info.ultimoLogin = ll.GetInt64() / 1000;
                        if (e.TryGetProperty("race", out var r) && r.TryGetProperty("name", out var rn)) info.raca = rn.GetString();
                        if (e.TryGetProperty("character_class", out var cc) && cc.TryGetProperty("id", out var cid))
                            info.classeEn = ClassFile(cid.GetInt32());
                    }
                }
                catch (MarketException) { return any; } // bad key / no connection: try again later
                catch (Exception ex) { MainForm.LogError("amigos-api", ex); }
                apiCache[slug] = info;
                any = true;
            }
            if (any)
            {
                Directory.CreateDirectory(Dir);
                File.WriteAllText(ApiFile, JsonSerializer.Serialize(apiCache));
            }
        }
        finally { apiBusy = false; }
        return any;
    }

    static string? ClassFile(int id) => id switch
    {
        1 => "WARRIOR", 2 => "PALADIN", 3 => "HUNTER", 4 => "ROGUE", 5 => "PRIEST", 6 => "DEATHKNIGHT",
        7 => "SHAMAN", 8 => "MAGE", 9 => "WARLOCK", 10 => "MONK", 11 => "DRUID", 12 => "DEMONHUNTER", 13 => "EVOKER",
        _ => null,
    };

    /// <summary>The ["Player-..."] key of a character block (older files have no "guid" field inside).</summary>
    static string? CharKey(Dictionary<object, object?> chars, Dictionary<object, object?> c) =>
        chars.FirstOrDefault(kv => ReferenceEquals(kv.Value, c)).Key as string;

    static string? Str(Dictionary<object, object?> d, string k) => d.GetValueOrDefault(k) as string;
    static double? Num(Dictionary<object, object?> d, string k) => d.GetValueOrDefault(k) is double v ? v : null;
    static bool Bool(Dictionary<object, object?> d, string k) => d.GetValueOrDefault(k) is true;
}

/// <summary>Tiny reader for SavedVariables files (tables, strings, numbers, booleans, nil).</summary>
static class Lua
{
    public static Dictionary<object, object?>? ParseAssignment(string text, string name)
    {
        var i = text.IndexOf(name + " =", StringComparison.Ordinal);
        if (i < 0) return null;
        var p = new Parser(text, i + name.Length + 2);
        return p.Value() as Dictionary<object, object?>;
    }

    sealed class Parser(string s, int pos)
    {
        int i = pos;

        void Ws()
        {
            while (i < s.Length)
            {
                if (char.IsWhiteSpace(s[i])) { i++; continue; }
                if (s[i] == '-' && i + 1 < s.Length && s[i + 1] == '-') { while (i < s.Length && s[i] != '\n') i++; continue; }
                break;
            }
        }

        public object? Value()
        {
            Ws();
            if (i >= s.Length) return null;
            var c = s[i];
            if (c == '{') return Table();
            if (c == '"') return Str();
            if (s.AsSpan(i).StartsWith("true")) { i += 4; return true; }
            if (s.AsSpan(i).StartsWith("false")) { i += 5; return false; }
            if (s.AsSpan(i).StartsWith("nil")) { i += 3; return null; }
            var start = i;
            while (i < s.Length && "+-0123456789.eExX".IndexOf(s[i]) >= 0) i++;
            return double.TryParse(s[start..i], NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
        }

        string Str()
        {
            i++;
            var sb = new StringBuilder();
            while (i < s.Length && s[i] != '"')
            {
                if (s[i] == '\\' && i + 1 < s.Length)
                {
                    i++;
                    var e = s[i];
                    if (char.IsDigit(e))
                    {
                        var st = i;
                        while (i < s.Length && i - st < 3 && char.IsDigit(s[i])) i++;
                        sb.Append((char)int.Parse(s[st..i], CultureInfo.InvariantCulture));
                        continue;
                    }
                    sb.Append(e switch { 'n' => '\n', 't' => '\t', 'r' => '\r', _ => e });
                    i++;
                    continue;
                }
                sb.Append(s[i++]);
            }
            i++;
            return sb.ToString();
        }

        Dictionary<object, object?> Table()
        {
            i++;
            var t = new Dictionary<object, object?>();
            var n = 1;
            while (true)
            {
                Ws();
                if (i >= s.Length) break;
                if (s[i] == '}') { i++; break; }
                if (s[i] == ',' || s[i] == ';') { i++; continue; }
                object? key = null;
                if (s[i] == '[')
                {
                    i++;
                    key = Value();
                    Ws();
                    if (i < s.Length && s[i] == ']') i++;
                    Ws();
                    if (i < s.Length && s[i] == '=') i++;
                }
                var v = Value();
                key ??= (double)n++;
                if (key != null) t[key] = v;
            }
            return t;
        }
    }
}
