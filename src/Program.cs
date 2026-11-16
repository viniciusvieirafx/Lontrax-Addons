namespace LontraxAddons;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "--selftest")
            return SelfTest.Run(args[1]).GetAwaiter().GetResult();
        if (args.Length >= 4 && args[0] == "--selftest-market")
            return SelfTest.RunMarket(args[1], args[2], int.Parse(args[3])).GetAwaiter().GetResult();
        if (args.Length >= 4 && args[0] == "--selftest-bags")
            return SelfTest.RunBags(args[1], args[2], int.Parse(args[3])).GetAwaiter().GetResult();
        if (args.Length >= 2 && args[0] == "--selftest-update")
            return SelfTest.RunUpdate(args[1]).GetAwaiter().GetResult();

        // First run of a downloaded copy: install to the fixed folder (+ shortcuts) and start from there.
        if (SelfInstall.EnsureInstalled(args)) return 0;

        // Talk to an already running copy: "show your window" or "quit, a new version is taking over".
        using var showEvt = new EventWaitHandle(false, EventResetMode.AutoReset, "LontraxAddons.Show");
        using var quitEvt = new EventWaitHandle(false, EventResetMode.AutoReset, "LontraxAddons.Quit");
        using var mutex = new Mutex(false, "LontraxAddons.SingleInstance");
        var takingOver = args.Contains("--updated") || args.Contains("--installed");
        if (!Acquire(mutex, 0))
        {
            if (!takingOver) { showEvt.Set(); return 0; }
            quitEvt.Set();
            if (!Acquire(mutex, 20000)) return 0;
        }
        try
        {
            ApplicationConfiguration.Initialize();
            // Never show the .NET crash box to friends: log it and keep going.
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, e) => MainForm.LogError("unhandled", e.Exception);
            Application.Run(new MainForm(startHidden: args.Contains("--tray"), showEvt, quitEvt));
        }
        finally
        {
            try { mutex.ReleaseMutex(); } catch { }
        }
        return 0;
    }

    static bool Acquire(Mutex m, int ms)
    {
        try { return m.WaitOne(ms); }
        catch (AbandonedMutexException) { return true; } // the old copy was killed: we own it now
    }
}
