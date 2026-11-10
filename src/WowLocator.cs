using Microsoft.Win32;

namespace LontraxAddons;

/// <summary>Finds "World of Warcraft\_forever_\Interface\AddOns" on this PC.</summary>
static class WowLocator
{
    public static string? Find()
    {
        foreach (var root in CandidateRoots())
        {
            try
            {
                var flavor = Path.Combine(root, Config.WowFlavor);
                if (!Directory.Exists(flavor)) continue;
                var addons = Path.Combine(flavor, "Interface", "AddOns");
                Directory.CreateDirectory(addons);
                return addons;
            }
            catch { }
        }
        return null;
    }

    public static bool LooksLikeAddOns(string path) =>
        Directory.Exists(path) && string.Equals(Path.GetFileName(path.TrimEnd('\\', '/')), "AddOns", StringComparison.OrdinalIgnoreCase);

    static IEnumerable<string> CandidateRoots()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in FromRegistry())
            if (seen.Add(r)) yield return r;
        string[] subdirs =
        {
            "World of Warcraft", @"Program Files (x86)\World of Warcraft", @"Program Files\World of Warcraft",
            @"Games\World of Warcraft", @"Jogos\World of Warcraft", @"Blizzard\World of Warcraft",
            @"Battle.net\World of Warcraft", @"Program Files (x86)\Battle.net\World of Warcraft",
        };
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType is not (DriveType.Fixed or DriveType.Removable)) continue;
            foreach (var s in subdirs)
            {
                var p = Path.Combine(drive.RootDirectory.FullName, s);
                if (seen.Add(p)) yield return p;
            }
        }
    }

    static IEnumerable<string> FromRegistry()
    {
        var keys = new[]
        {
            @"SOFTWARE\WOW6432Node\Blizzard Entertainment\World of Warcraft",
            @"SOFTWARE\Blizzard Entertainment\World of Warcraft",
        };
        foreach (var k in keys)
        {
            string? path = null;
            try { path = Registry.LocalMachine.OpenSubKey(k)?.GetValue("InstallPath") as string; } catch { }
            if (string.IsNullOrWhiteSpace(path)) continue;
            var dir = new DirectoryInfo(path.TrimEnd('\\', '/'));
            // InstallPath usually points at ...\World of Warcraft\_retail_
            if (dir.Name.StartsWith('_') && dir.Parent != null) yield return dir.Parent.FullName;
            yield return dir.FullName;
        }
    }

    public static bool WowIsRunning()
    {
        try { return System.Diagnostics.Process.GetProcessesByName("Wow").Length > 0; }
        catch { return false; }
    }
}
