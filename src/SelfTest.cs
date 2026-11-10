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
