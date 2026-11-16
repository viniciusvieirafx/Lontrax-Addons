using System.Text;
using System.Text.Json;

namespace LontraxAddons;

/// <summary>"Lontrax Addons.exe --selftest &lt;log&gt;": checks login, catalog and install without the window.
/// Uses LONTRAX_TOKEN, LONTRAX_ADDONS (a test AddOns folder) and optionally LONTRAX_CATALOG_LOCAL (a local catalogo.json).</summary>
static class SelfTest
{
    /// <summary>"--selftest-update &lt;log&gt;": finds the latest app release, downloads it and swaps it into
    /// LONTRAX_UPDATE_TARGET (a test copy of the exe), without starting anything.</summary>
    public static async Task<int> RunUpdate(string logPath)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            var gh = new GitHubClient { Token = Settings.Load().GetToken() };
            var target = Environment.GetEnvironmentVariable("LONTRAX_UPDATE_TARGET") ?? throw new Exception("set LONTRAX_UPDATE_TARGET");
            W("running version: " + SelfInstall.CurrentVersion + " | target before: " + SelfInstall.FileVersion(target));
            var rel = await gh.GetLatestAppRelease(Config.CatalogRepo);
            W("latest release: " + (rel == null ? "none" : $"{rel.Tag} ({rel.Version}) asset {rel.AssetName}"));
            if (rel == null) return 1;
            var file = Path.Combine(Path.GetDirectoryName(target)!, "download.exe");
            await gh.DownloadAsset(Config.CatalogRepo, rel.AssetId, file, null);
            W("downloaded: " + new FileInfo(file).Length + " bytes, version " + SelfInstall.FileVersion(file));
            SelfInstall.ApplyUpdate(file, false, target, start: false);
            var after = SelfInstall.FileVersion(target);
            W("target after: " + after + " | old kept: " + File.Exists(target + ".old"));
            var ok = after == rel.Version;
            W(ok ? "UPDATE OK" : "UPDATE FAILED");
            return ok ? 0 : 1;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }

    /// <summary>"--selftest-market &lt;log&gt; &lt;keys file&gt; &lt;house&gt;": recipes + prices + profit, no window.
    /// Use LONTRAX_DATA so the cache goes to a test folder.</summary>
    public static async Task<int> RunMarket(string logPath, string keysFile, int house)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            var m = new Market();
            foreach (var l in File.ReadAllLines(keysFile))
            {
                if (l.StartsWith("CLIENT_ID=")) m.Api.ClientId = l[10..].Trim();
                if (l.StartsWith("CLIENT_SECRET=")) m.Api.ClientSecret = l[14..].Trim();
            }
            if (!m.Api.HasKeys && Environment.GetEnvironmentVariable("LONTRAX_SHARED") == null)
                m.LoadKeys(Settings.Load()); // keys saved (encrypted) in config.json
            m.Shared = new GitHubClient { Token = Settings.Load().GetToken() };
            W("mode: " + (m.UsingShared ? "precos da galera (GitHub)" : "chave propria"));
            var t = System.Diagnostics.Stopwatch.StartNew();
            await m.LoadHouses();
            W($"houses: {m.Houses.Count} ({string.Join(", ", m.Houses.Select(h => h.Faction + " " + h.Id))})");
            await m.LoadRecipes(new Progress<double>(_ => { }));
            W($"recipes: {t.Elapsed.TotalSeconds:0}s, " + string.Join(", ", m.Book!.Professions.Select(p => $"{p.Name} {p.Recipes.Count}")));
            W("vendor prices: " + string.Join(", ", m.Book.Vendor.Select(v => $"{v.Key}={v.Value}")));
            t.Restart();
            var fresh = await m.Refresh(house);
            W($"house {house}: fresh={fresh} {t.Elapsed.TotalSeconds:0}s items={m.GetSnapshot(house)!.Prices.Count} lm={m.GetSnapshot(house)!.LastModified}");
            W($"second refresh (should be not-modified): fresh={await m.Refresh(house)}");
            await m.MergeSharedHistory(house);
            W($"history for Couro Leve (2318): {m.ItemHistory(house, 2318).Count} point(s)");
            var rows = m.Compute(house, Array.Empty<int>());
            W($"rows: {rows.Count}, complete {rows.Count(r => r.completo)}, priced {rows.Count(r => r.lucro != null)}, profitable {rows.Count(r => r.lucro > 0)}");
            foreach (var r in rows.Where(r => r.lucro > 0 && r.aVenda >= 5).OrderByDescending(r => r.lucro).Take(15))
                W($"  +{r.lucro / 10000.0:0.00}g  {r.profissao,-18} {r.nome}  (custo {r.custo / 10000.0:0.00}g, vende {r.venda / 10000.0:0.00}g, {r.aVenda} a venda)");
            // Character sheet (profession level + known recipes).
            var slug = Environment.GetEnvironmentVariable("LONTRAX_CHAR") ?? "miranajanela-lontrax";
            var ch = await m.LoadCharacter(slug);
            if (ch == null) W($"character {slug}: NOT FOUND");
            else
            {
                W($"character {ch.nome}: " + string.Join(", ", ch.profissoes.Select(p => $"{p.Key} {p.Value.nivel}/{p.Value.max} ({p.Value.receitas.Count} receitas)")));
                var knownSet = ch.profissoes.Values.SelectMany(p => p.receitas).ToHashSet();
                var mine = rows.Where(r => knownSet.Contains(r.receita)).ToList();
                W($"  known recipes in the table: {mine.Count}, with profit: {mine.Count(r => r.lucro > 0)}");
                foreach (var r in mine.Where(r => r.lucro > 0).OrderByDescending(r => r.lucro).Take(5))
                    W($"  +{r.lucro / 10000.0:0.00}g  {r.nome} ({r.aVenda} a venda)");
            }
            if (ch == null && !m.UsingShared) return 1;
            // Same JSON the window receives, for checking the screen in a browser preview.
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(logPath))!, "ah-rows.json"), JsonSerializer.Serialize(new
            {
                rows,
                profissoes = m.Book.Professions.Select(p => new { id = p.Id, nome = p.Name, receitas = p.Recipes.Count }),
                personagem = ch == null ? null : new
                {
                    ch.slug, ch.nome, lido = ch.lido.ToLocalTime().ToString("dd/MM HH:mm"),
                    profissoes = ch.profissoes.Select(kv => new { id = int.Parse(kv.Key), nome = m.Book.Professions.FirstOrDefault(p => p.Id.ToString() == kv.Key)?.Name ?? kv.Key, kv.Value.nivel, kv.Value.max }),
                    conhecidas = ch.profissoes.Values.SelectMany(p => p.receitas).Distinct(),
                },
            }));
            W("MARKET OK");
            return 0;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }

    /// <summary>"--selftest-bags &lt;log&gt; &lt;AddOns folder&gt; &lt;house&gt;": reads LontraxMercado.lua and prints the advice.
    /// Needs prices already cached in LONTRAX_DATA (run --selftest-market first).</summary>
    public static async Task<int> RunBags(string logPath, string addOns, int house)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            var m = new Market();
            await m.LoadRecipes(null);
            W("files: " + string.Join(", ", Bags.Files(addOns)));
            var chars = Bags.Read(addOns);
            foreach (var c in chars)
            {
                W($"{c.nome} nivel {c.nivel} ouro {c.dinheiro} atualizado {c.atualizado} banco {c.bancoAtualizado}: {c.bolsas.Count} itens bolsa, {c.banco.Count} banco");
                foreach (var a in Bags.Advise(m, house, c.bolsas.Concat(c.banco), null))
                    W($"  {a.nome,-22} x{a.qtd,-3} {a.onde,-4} ganha {a.ganho,7}c  ah {a.ahUnidade}c npc {a.npcUnidade}c  venda {a.aVenda}  {(a.craft == null ? "" : "craft: " + a.craft + " +" + a.craftLucro)}");
            }
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(logPath))!, "ah-bags.json"),
                JsonSerializer.Serialize(new { type = "ahBags", achou = true, personagens = chars.Select(c => new {
                    c.guid, c.nome, c.nivel, c.dinheiro, atualizado = c.atualizado?.ToString("dd/MM HH:mm"), bancoAtualizado = c.bancoAtualizado?.ToString("dd/MM HH:mm"),
                    bolsas = Bags.Advise(m, house, c.bolsas, null), banco = Bags.Advise(m, house, c.banco, null) }) }));
            W(chars.Count > 0 ? "BAGS OK" : "BAGS: nothing read");
            return chars.Count > 0 ? 0 : 1;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }

    /// <summary>"--selftest-gameprices &lt;log&gt; &lt;AddOns&gt; &lt;house&gt;": writes Precos.lua (prices for the in-game tooltips)
    /// from the cached prices of a house into a test AddOns folder and checks it. Only reads the price cache.</summary>
    /// <summary>"--selftest-gamescan &lt;log&gt; &lt;AddOns&gt; &lt;house&gt;": reads the in-game scan from the test WoW folder's
    /// SavedVariables and applies it as the house prices. Use LONTRAX_DATA (it writes the price cache).</summary>
    public static int RunGameScan(string logPath, string addOns, int house)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            if (Environment.GetEnvironmentVariable("LONTRAX_DATA") == null) { W("FAIL set LONTRAX_DATA"); return 1; }
            var fails = 0;
            var scan = Bags.ReadScan(addOns);
            W(scan == null ? "scan: none  <-- WRONG" : $"scan: {scan.When:u} realm={scan.Realm} listings={scan.Listings} items={scan.Prices.Count}");
            if (scan == null) return 1;
            foreach (var id in scan.Prices.Keys.OrderBy(k => k).Take(5))
                W($"  item {id}: min={scan.Prices[id].Min} qty={scan.Prices[id].Qty} listings={scan.Prices[id].Listings}");
            var m = new Market();
            var used = m.ApplyGameScan(house, scan.When, scan.Prices);
            var snap = m.GetSnapshot(house);
            W($"applied={used} origem={snap?.Origem} items={snap?.Prices.Count}");
            if (!used || snap?.Origem != "jogo") fails++;
            var again = m.ApplyGameScan(house, scan.When.AddMinutes(-5), scan.Prices);
            W("older scan applied=" + again + (again ? "  <-- WRONG" : " (ok)"));
            if (again) fails++;
            var reread = new Market().GetSnapshot(house);
            W($"saved to cache: origem={reread?.Origem} lm={reread?.LastModified:u}");
            if (reread?.Origem != "jogo") fails++;
            W(fails == 0 ? "ALL OK" : $"FAILURES: {fails}");
            return fails == 0 ? 0 : 1;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }

    public static int RunGamePrices(string logPath, string addOns, int house)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            var fails = 0;
            var m = new Market();
            var snap = m.GetSnapshot(house);
            if (snap == null) { W("FAIL no cached prices for house " + house); return 1; }
            W($"house {house}: {snap.Prices.Count} items, prices from {snap.LastModified:u}");
            var folder = Path.Combine(addOns, GamePrices.AddonFolder);
            var toc = Path.Combine(folder, GamePrices.AddonFolder + ".toc");
            // without the addon: must not write anything
            if (Directory.Exists(folder)) Directory.Delete(folder, true);
            var wrote = GamePrices.Write(addOns, snap, "Aliança 1 (casa " + house + ")");
            W("without addon: wrote=" + wrote + (wrote ? "  <-- WRONG" : " (ok)"));
            if (wrote) fails++;
            Directory.CreateDirectory(folder);
            File.WriteAllText(toc, "## Title: test");
            wrote = GamePrices.Write(addOns, snap, "Aliança 1 (casa " + house + ")");
            var file = GamePrices.PricesFile(addOns)!;
            W($"with addon: wrote={wrote} size={new FileInfo(file).Length} bytes");
            if (!wrote) fails++;
            var h = GamePrices.ReadHeader(addOns);
            var headerOk = h != null && h.House == house && h.PricesFrom == snap.LastModified;
            W($"header: house={h?.House} pricesFrom={h?.PricesFrom:u} writtenAt={h?.WrittenAt:dd/MM HH:mm} ok={headerOk}");
            if (!headerOk) fails++;
            var lines = File.ReadAllLines(file).Count(l => l.StartsWith("m["));
            var expected = snap.Prices.Count(p => p.Value.Min > 0);
            W($"items in file: {lines} (expected {expected})");
            if (lines != expected) fails++;
            W(fails == 0 ? "ALL OK" : $"FAILURES: {fails}");
            return fails == 0 ? 0 : 1;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }

    public static async Task<int> Run(string logPath)
    {
        var log = new StringBuilder();
        void W(string s) { log.AppendLine(s); File.WriteAllText(logPath, log.ToString()); }
        try
        {
            var settings = Settings.Load();
            var gh = new GitHubClient { Token = settings.GetToken() };
            if (gh.Token == null) { W("FAIL no token"); return 1; }
            var (login, _) = await gh.GetUser();
            W("login: " + login);

            var local = Environment.GetEnvironmentVariable("LONTRAX_CATALOG_LOCAL");
            var raw = local != null ? File.ReadAllText(local) : await gh.GetRawFile(Config.CatalogRepo, Config.CatalogFile, Config.CatalogRef);
            var cat = JsonSerializer.Deserialize<CatalogFile>(raw, GitHubClient.JsonOptions)!;
            W($"catalog: {cat.Addons.Count} addons ({(local != null ? "local" : "GitHub")})");

            var addons = Environment.GetEnvironmentVariable("LONTRAX_ADDONS") ?? throw new Exception("set LONTRAX_ADDONS");
            Directory.CreateDirectory(addons);
            var fails = 0;
            foreach (var e in cat.Addons)
            {
                try
                {
                    var c = await gh.GetLatestCommit(e.Repo, e.Ref);
                    W($"[{e.Id}] latest {c.Sha[..7]} \"{c.Message}\"");
                    await Installer.Install(gh, addons, e, c, null);
                    var info = InstalledInfo.Read(addons, e);
                    var toc = Directory.GetFiles(Path.Combine(addons, e.Folders()[0].Destino), "*.toc").Length;
                    W($"[{e.Id}] installed sha={info?.Sha[..7]} tocFiles={toc} ok={(info?.Sha == c.Sha && toc > 0)}");
                    if (info?.Sha != c.Sha || toc == 0) fails++;
                    // second install = update path (backup + replace)
                    await Installer.Install(gh, addons, e, c, null);
                    W($"[{e.Id}] reinstall ok, backups: {Directory.GetDirectories(Path.Combine(Config.DataDir, "backups"), e.Folders()[0].Destino + "_*").Length}");
                }
                catch (Exception ex) { fails++; W($"[{e.Id}] FAIL {ex.Message}"); }
            }
            W(fails == 0 ? "ALL OK" : $"FAILURES: {fails}");
            return fails == 0 ? 0 : 1;
        }
        catch (Exception ex) { W("FAIL " + ex); return 1; }
    }
}
