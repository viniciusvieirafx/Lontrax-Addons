namespace LontraxAddons;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--selftest")
            return SelfTest.Run(args[1]).GetAwaiter().GetResult();

        // Only one window at a time.
        using var mutex = new Mutex(true, "LontraxAddons.SingleInstance", out var first);
        if (!first) return 0;
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm(startHidden: args.Contains("--tray")));
        return 0;
    }
}
