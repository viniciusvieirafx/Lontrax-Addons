using System.Diagnostics;

namespace LontraxAddons;

/// <summary>Puts the app in a fixed place (%LOCALAPPDATA%\Programs\Lontrax Addons) with Desktop and
/// Start Menu shortcuts, so friends never need to know where the downloaded .exe went.
/// Also replaces itself with a newer version (Updater downloads it).</summary>
static class SelfInstall
{
    public const string ExeName = "Lontrax Addons.exe";

    public static string InstallDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Lontrax Addons");

    public static string InstalledExe => Path.Combine(InstallDir, ExeName);

    static string CurrentExe => Environment.ProcessPath ?? "";

    public static bool IsInstalledCopy =>
        string.Equals(Path.GetFullPath(CurrentExe), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase);

    /// <summary>Called at start. Returns true if this process should exit (a copy was started from the install folder).</summary>
    public static bool EnsureInstalled(string[] args)
    {
        CleanupOld();
        if (IsInstalledCopy || args.Contains("--no-install") || Debugger.IsAttached) return false;
        try
        {
            Directory.CreateDirectory(InstallDir);
            var installedVersion = File.Exists(InstalledExe) ? FileVersion(InstalledExe) : null;
            var mine = FileVersion(CurrentExe);
            // Copy when missing or when the downloaded one is newer (never downgrade).
            if (installedVersion == null || (mine != null && mine > installedVersion))
            {
                if (File.Exists(InstalledExe))
                {
                    var old = InstalledExe + ".old";
                    try { File.Delete(old); } catch { }
                    File.Move(InstalledExe, old); // works even if that copy is running
                }
                File.Copy(CurrentExe, InstalledExe, true);
            }
            CreateShortcuts();
            Process.Start(new ProcessStartInfo(InstalledExe, "--installed") { UseShellExecute = false, WorkingDirectory = InstallDir });
            return true;
        }
        catch
        {
            return false; // could not install: just run from where it is
        }
    }

    public static Version? FileVersion(string path)
    {
        try
        {
            var v = FileVersionInfo.GetVersionInfo(path);
            return new Version(v.FileMajorPart, v.FileMinorPart, v.FileBuildPart);
        }
        catch { return null; }
    }

    public static Version CurrentVersion
    {
        get
        {
            var s = Application.ProductVersion.Split('+')[0];
            return Version.TryParse(s, out var v) ? new Version(v.Major, v.Minor, Math.Max(v.Build, 0)) : new Version(0, 0, 0);
        }
    }

    /// <summary>Deletes the previous version left by an update. Right after an update the old copy may
    /// still be closing, so keep trying for a while in the background.</summary>
    static void CleanupOld()
    {
        var old = (Environment.ProcessPath ?? "") + ".old";
        if (!File.Exists(old)) return;
        Task.Run(async () =>
        {
            for (var i = 0; i < 30 && File.Exists(old); i++)
            {
                try { File.Delete(old); } catch { await Task.Delay(1000); }
            }
        });
    }

    static void CreateShortcuts()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var startMenu = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
        foreach (var dir in new[] { desktop, startMenu })
        {
            try { MakeShortcut(Path.Combine(dir, "Lontrax Addons.lnk"), InstalledExe); } catch { }
        }
    }

    static void MakeShortcut(string lnk, string target)
    {
        var type = Type.GetTypeFromProgID("WScript.Shell");
        if (type == null) return;
        dynamic shell = Activator.CreateInstance(type)!;
        dynamic sc = shell.CreateShortcut(lnk);
        sc.TargetPath = target;
        sc.WorkingDirectory = Path.GetDirectoryName(target);
        sc.IconLocation = target + ",0";
        sc.Description = "Lontrax Addons — os addons da galera";
        sc.Save();
    }

    /// <summary>Swaps the running exe for <paramref name="newExe"/> and starts it. The caller then exits.</summary>
    public static void ApplyUpdate(string newExe, bool startHidden, string? targetOverride = null, bool start = true)
    {
        var target = targetOverride ?? (IsInstalledCopy ? InstalledExe : CurrentExe);
        var old = target + ".old";
        try { File.Delete(old); } catch { }
        File.Move(target, old);          // a running .exe can be renamed
        File.Move(newExe, target);
        if (!start) return;
        Process.Start(new ProcessStartInfo(target, startHidden ? "--tray --updated" : "--updated")
        { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(target)! });
    }
}
