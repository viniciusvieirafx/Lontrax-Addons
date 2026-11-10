using System.IO.Compression;
using System.Text.Json;

namespace LontraxAddons;

/// <summary>One copy step: a folder inside the repo goes to a folder inside AddOns.</summary>
sealed class FolderMap
{
    public string Origem { get; set; } = "";   // folder inside the repo ("" = repo root)
    public string Destino { get; set; } = "";  // folder name inside AddOns
}

/// <summary>One entry of catalogo.json.</summary>
sealed class CatalogEntry
{
    public string Id { get; set; } = "";
    public string Nome { get; set; } = "";
    public string Descricao { get; set; } = "";
    public string Repo { get; set; } = "";
    public string Ref { get; set; } = "main";
    public string? Pasta { get; set; }
    public string? Subpasta { get; set; }
    public List<FolderMap>? Pastas { get; set; }
    public string? Autor { get; set; }
    public List<string>? Tags { get; set; }
    public bool Obrigatorio { get; set; }

    public List<FolderMap> Folders() => Pastas is { Count: > 0 }
        ? Pastas
        : new List<FolderMap> { new() { Origem = Subpasta ?? "", Destino = Pasta ?? Id } };
}

sealed class CatalogFile
{
    public string? Titulo { get; set; }
    public string? Mensagem { get; set; }
    public List<CatalogEntry> Addons { get; set; } = new();
}

/// <summary>What is installed, written next to each addon so the app knows its version.</summary>
sealed class InstalledInfo
{
    public string Repo { get; set; } = "";
    public string Ref { get; set; } = "";
    public string Sha { get; set; } = "";
    public DateTimeOffset Instalado { get; set; }
    public string? Mensagem { get; set; }

    public const string FileName = ".lontrax.json";

    public static InstalledInfo? Read(string addonsPath, CatalogEntry e)
    {
        var first = e.Folders()[0].Destino;
        var f = Path.Combine(addonsPath, first, FileName);
        try { return File.Exists(f) ? JsonSerializer.Deserialize<InstalledInfo>(File.ReadAllText(f)) : null; }
        catch { return null; }
    }

    public static bool FolderExists(string addonsPath, CatalogEntry e) =>
        Directory.Exists(Path.Combine(addonsPath, e.Folders()[0].Destino));
}

static class Installer
{
    /// <summary>Downloads the repo at <paramref name="sha"/> and puts its folders in AddOns.
    /// The old folders are kept in a backup (last 2 per addon), never just deleted.</summary>
    public static async Task Install(GitHubClient gh, string addonsPath, CatalogEntry e, GitHubClient.CommitInfo commit,
        IProgress<double>? progress)
    {
        var work = Path.Combine(Config.DataDir, "tmp", e.Id + "-" + DateTime.Now.Ticks);
        Directory.CreateDirectory(work);
        try
        {
            var zip = Path.Combine(work, "addon.zip");
            await gh.DownloadZip(e.Repo, commit.Sha, zip, new Progress<double>(p => progress?.Report(p * 0.8)));
            var unzip = Path.Combine(work, "x");
            ZipFile.ExtractToDirectory(zip, unzip);
            var top = Directory.GetDirectories(unzip).Single(); // GitHub zips have one "owner-repo-sha" folder
            progress?.Report(0.85);

            var maps = e.Folders();
            foreach (var m in maps)
            {
                var src = string.IsNullOrEmpty(m.Origem) ? top : Path.Combine(top, m.Origem.Replace('/', Path.DirectorySeparatorChar));
                if (!Directory.Exists(src)) throw new GitHubException($"A pasta \"{m.Origem}\" não existe no repositório {e.Repo}.");
                if (string.IsNullOrWhiteSpace(m.Destino) || m.Destino.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new GitHubException($"Nome de pasta inválido no catálogo: \"{m.Destino}\".");
            }

            foreach (var m in maps)
            {
                var src = string.IsNullOrEmpty(m.Origem) ? top : Path.Combine(top, m.Origem.Replace('/', Path.DirectorySeparatorChar));
                var dest = Path.Combine(addonsPath, m.Destino);
                if (Directory.Exists(dest)) Backup(dest, m.Destino);
                CopyDir(src, dest);
            }

            var info = new InstalledInfo { Repo = e.Repo, Ref = e.Ref, Sha = commit.Sha, Instalado = DateTimeOffset.Now, Mensagem = commit.Message };
            foreach (var m in maps)
                File.WriteAllText(Path.Combine(addonsPath, m.Destino, InstalledInfo.FileName), JsonSerializer.Serialize(info));
            progress?.Report(1);
        }
        finally
        {
            try { Directory.Delete(work, true); } catch { }
        }
    }

    public static void Uninstall(string addonsPath, CatalogEntry e)
    {
        foreach (var m in e.Folders())
        {
            var dest = Path.Combine(addonsPath, m.Destino);
            if (Directory.Exists(dest)) Backup(dest, m.Destino);
        }
    }

    static void Backup(string dir, string name)
    {
        var root = Path.Combine(Config.DataDir, "backups");
        Directory.CreateDirectory(root);
        var target = Path.Combine(root, name + "_" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
        try { Directory.Move(dir, target); }
        catch (IOException)
        {
            // Different drive: copy then delete.
            CopyDir(dir, target);
            Directory.Delete(dir, true);
        }
        foreach (var old in Directory.GetDirectories(root, name + "_*").OrderByDescending(d => d).Skip(2))
            try { Directory.Delete(old, true); } catch { }
    }

    static void CopyDir(string src, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var f in Directory.GetFiles(src))
        {
            var n = Path.GetFileName(f);
            if (n.StartsWith(".git")) continue; // .gitattributes, .gitignore...
            File.Copy(f, Path.Combine(dest, n), true);
        }
        foreach (var d in Directory.GetDirectories(src))
        {
            var n = Path.GetFileName(d);
            if (n is ".git" or ".github") continue;
            CopyDir(d, Path.Combine(dest, n));
        }
    }
}
