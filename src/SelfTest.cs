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
            var t = System.Diagnostics.Stopwatch.StartNew();
            await m.LoadHouses();
            W($"houses: {m.Houses.Count} ({string.Join(", ", m.Houses.Select(h => h.Faction + " " + h.Id))})");
            await m.LoadRecipes(new Progress<double>(_ => { }));
            W($"recipes: {t.Elapsed.TotalSeconds:0}s, " + string.Join(", ", m.Book!.Professions.Select(p => $"{p.Name} {p.Recipes.Count}")));
            W("vendor prices: " + string.Join(", ", m.Book.Vendor.Select(v => $"{v.Key}={v.Value}")));
            t.Restart();
            var fresh = await m.RefreshHouse(house);
            W($"house {house}: fresh={fresh} {t.Elapsed.TotalSeconds:0}s items={m.GetSnapshot(house)!.Prices.Count} lm={m.GetSnapshot(house)!.LastModified}");
            W($"second refresh (should be not-modified): fresh={await m.RefreshHouse(house)}");
            var rows = m.Compute(house, Array.Empty<int>());
            W($"rows: {rows.Count}, complete {rows.Count(r => r.completo)}, priced {rows.Count(r => r.lucro != null)}, profitable {rows.Count(r => r.lucro > 0)}");
            foreach (var r in rows.Where(r => r.lucro > 0 && r.aVenda >= 5).OrderByDescending(r => r.lucro).Take(15))
                W($"  +{r.lucro / 10000.0:0.00}g  {r.profissao,-18} {r.nome}  (custo {r.custo / 10000.0:0.00}g, vende {r.venda / 10000.0:0.00}g, {r.aVenda} a venda)");
            // Same JSON the window receives, for checking the screen in a browser preview.
            File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(logPath))!, "ah-rows.json"), JsonSerializer.Serialize(new
            {
                rows,
                profissoes = m.Book.Professions.Select(p => new { id = p.Id, nome = p.Name, receitas = p.Recipes.Count }),
            }));
            W("MARKET OK");
            return 0;
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
