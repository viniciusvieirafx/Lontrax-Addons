using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LontraxAddons;

sealed class MainForm : Form
{
    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(7, 13, 31) };
    readonly Settings settings = Settings.Load();
    readonly GitHubClient gh = new();
    CatalogFile? catalog;
    readonly Dictionary<string, GitHubClient.CommitInfo> latest = new();
    CancellationTokenSource? loginCts;
    bool busy;

    // ---------- tray: the app keeps running next to the clock and checks for updates ----------
    readonly NotifyIcon tray = new();
    readonly System.Windows.Forms.Timer checkTimer = new() { Interval = 30 * 60 * 1000 };
    readonly bool startHidden;
    bool exiting;
    bool trayHintShown;

    public MainForm(bool startHidden, EventWaitHandle showEvt, EventWaitHandle quitEvt)
    {
        this.startHidden = startHidden;
        // Another copy asked us to show the window (shortcut clicked) or to quit (new version taking over).
        var listener = new Thread(() =>
        {
            while (true)
            {
                var which = WaitHandle.WaitAny(new WaitHandle[] { showEvt, quitEvt });
                try
                {
                    if (which == 0) BeginInvoke(ShowWindow);
                    else { BeginInvoke(() => { exiting = true; Close(); }); return; }
                }
                catch { return; }
            }
        }) { IsBackground = true };
        // HandleCreated fires again when Windows recreates the window (e.g. ShowInTaskbar changes when
        // starting in the tray): start the listener only once.
        HandleCreated += (_, _) => { if (listener.ThreadState.HasFlag(System.Threading.ThreadState.Unstarted)) listener.Start(); };
        Text = "Lontrax — Addons da Aliança";
        BackColor = Color.FromArgb(7, 13, 31);
        MinimumSize = new Size(940, 640);
        Size = new Size(1180, 780);
        StartPosition = FormStartPosition.CenterScreen;
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ui.brasao.ico"))
            if (s != null) Icon = new Icon(s);
        Controls.Add(web);
        // Pause every animation while the window is not in focus (saves GPU while you play).
        Activated += (_, _) => Post(new { type = "focus", on = true });
        Deactivate += (_, _) => Post(new { type = "focus", on = false });
        Load += async (_, _) => await InitWeb();
        gh.Token = settings.GetToken();

        tray.Icon = Icon;
        tray.Text = "Lontrax Addons";
        tray.Visible = true;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Abrir Lontrax Addons", null, (_, _) => ShowWindow());
        menu.Items.Add("Verificar atualizações agora", null, async (_, _) => await BackgroundCheck(true));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sair", null, (_, _) => { exiting = true; Close(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (_, _) => ShowWindow();
        tray.BalloonTipClicked += (_, _) => ShowWindow();
        checkTimer.Tick += async (_, _) => await BackgroundCheck(false);
        checkTimer.Start();
        market.LoadKeys(settings);
        marketTimer.Tick += async (_, _) => await MarketTick(manual: false);
        marketTimer.Start();

        if (startHidden)
        {
            // Started with Windows: load quietly, stay in the tray.
            Opacity = 0;
            ShowInTaskbar = false;
            Shown += (_, _) => { Hide(); Opacity = 1; ShowInTaskbar = true; };
        }
        ApplyAutostart();
    }

    // ---------- dark title bar (instead of the default white one) ----------
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            int on = 1;
            // Windows 10 (20H1+) and 11: dark title bar.
            if (DwmSetWindowAttribute(Handle, 20, ref on, sizeof(int)) != 0)
                DwmSetWindowAttribute(Handle, 19, ref on, sizeof(int)); // older Windows 10 builds
            // Windows 11: exact colors (COLORREF = 0x00BBGGRR). Same near-black navy as the app.
            int caption = 0x001F0D07;   // #070D1F
            int text = 0x00D2E3E9;      // #E9E3D2
            int border = 0x00231A0D;    // #0D1A23
            DwmSetWindowAttribute(Handle, 35, ref caption, sizeof(int));
            DwmSetWindowAttribute(Handle, 36, ref text, sizeof(int));
            DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
        }
        catch { }
    }

    void ShowWindow()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
        SendState();
        SendAddons();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!exiting && settings.KeepInTray && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            if (!trayHintShown)
            {
                trayHintShown = true;
                tray.ShowBalloonTip(4000, "Lontrax Addons continua de olho",
                    "Fico aqui perto do relógio e aviso quando sair atualização. Para fechar de vez: botão direito no brasão > Sair.", ToolTipIcon.Info);
            }
            return;
        }
        tray.Visible = false;
        base.OnFormClosing(e);
    }

    void ApplyAutostart()
    {
        try
        {
            using var run = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (run == null) return;
            if (settings.StartWithWindows) run.SetValue("LontraxAddons", $"\"{Environment.ProcessPath}\" --tray");
            else run.DeleteValue("LontraxAddons", false);
        }
        catch { }
    }

    GitHubClient.ReleaseInfo? appUpdate;

    /// <summary>Is there a newer Lontrax Addons? Hidden in the tray: update right away, quietly.
    /// Window open: show the "update the app" bar and let the person click.</summary>
    async Task CheckAppUpdate()
    {
        if (gh.Token == null) return;
        GitHubClient.ReleaseInfo? rel;
        try { rel = await gh.GetLatestAppRelease(Config.CatalogRepo); }
        catch (Exception ex) { LogError("appUpdate", ex); return; }
        if (rel == null || rel.Version <= SelfInstall.CurrentVersion) return;
        appUpdate = rel;
        if (!Visible && !busy) await UpdateApp(quiet: true);
        else Post(new { type = "appUpdate", version = rel.Tag });
    }

    async Task UpdateApp(bool quiet)
    {
        var rel = appUpdate;
        if (rel == null || busy) return;
        busy = true;
        try
        {
            var dir = Path.Combine(Config.DataDir, "tmp");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, "LontraxAddons-" + rel.Tag + ".exe");
            if (!quiet) Post(new { type = "appUpdateProgress", value = 0.02 });
            await gh.DownloadAsset(Config.CatalogRepo, rel.AssetId, file,
                new SyncProgress(p => { if (!quiet) Post(new { type = "appUpdateProgress", value = p }); }));
            if (SelfInstall.FileVersion(file) is not { } v || v < rel.Version)
                throw new GitHubException("O arquivo baixado não é a versão nova. Tente de novo mais tarde.");
            SelfInstall.ApplyUpdate(file, startHidden: !Visible);
            exiting = true;
            Close();
        }
        catch (Exception ex)
        {
            LogError("updateApp", ex);
            if (!quiet) { Toast("erro", "Não deu para atualizar o app: " + ex.Message); Post(new { type = "appUpdate", version = rel.Tag }); }
        }
        finally { busy = false; }
    }

    /// <summary>Checks GitHub for new versions; shows a Windows notification for news not told yet.</summary>
    async Task BackgroundCheck(bool manual)
    {
        if (gh.Token == null || busy) { if (manual) ShowWindow(); return; }
        await CheckAppUpdate();
        if (exiting) return;
        try
        {
            await RefreshCatalog(quiet: !Visible);
            if (catalog == null || settings.AddOnsPath == null) return;
            var news = new List<string>();
            foreach (var e in catalog.Addons)
            {
                if (!latest.TryGetValue(e.Id, out var c)) continue;
                var inst = InstalledInfo.Read(settings.AddOnsPath, e);
                var pending = inst != null ? inst.Sha != c.Sha : e.Obrigatorio;
                if (!pending) continue;
                if (!manual && settings.Notified.TryGetValue(e.Id, out var told) && told == c.Sha) continue;
                settings.Notified[e.Id] = c.Sha;
                news.Add(e.Nome);
            }
            settings.Save();
            if (news.Count > 0)
                tray.ShowBalloonTip(8000, "Atualização para a Lontrax!",
                    (news.Count == 1 ? news[0] + " tem versão nova." : string.Join(", ", news) + " têm versões novas.") + " Clique para atualizar.",
                    ToolTipIcon.Info);
            else if (manual)
                tray.ShowBalloonTip(3000, "Lontrax Addons", "Tudo em dia. Pela Aliança!", ToolTipIcon.Info);
        }
        catch (Exception ex) when (manual)
        {
            tray.ShowBalloonTip(5000, "Lontrax Addons", ex.Message, ToolTipIcon.Warning);
        }
        catch { }
    }

    async Task InitWeb()
    {
        try
        {
            var uiDir = ExtractUi();
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Config.DataDir, "webview"));
            await web.EnsureCoreWebView2Async(env);
            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = Debugger.IsAttached;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("app.lontrax", uiDir, CoreWebView2HostResourceAccessKind.Allow);
            core.WebMessageReceived += async (_, e) => await OnMessage(e.WebMessageAsJson);
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenUrl(e.Uri); };
            core.Navigate("https://app.lontrax/index.html");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show("Falta um componente do Windows (Microsoft Edge WebView2).\n\nQuer abrir a página para instalar? Depois é só abrir o Lontrax Addons de novo.",
                    Text, MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                OpenUrl("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Close();
        }
    }

    static string ExtractUi()
    {
        var dir = Path.Combine(Config.DataDir, "ui");
        Directory.CreateDirectory(dir);
        // Start clean: files from older versions (e.g. the old opening sound) don't stay behind.
        foreach (var old in Directory.GetFiles(dir)) try { File.Delete(old); } catch { }
        var asm = Assembly.GetExecutingAssembly();
        foreach (var name in asm.GetManifestResourceNames().Where(n => n.StartsWith("ui.")))
        {
            using var s = asm.GetManifestResourceStream(name)!;
            using var f = File.Create(Path.Combine(dir, name[3..]));
            s.CopyTo(f);
        }
        return dir;
    }

    // ---------- messages from the page ----------
    async Task OnMessage(string json)
    {
        JsonNode? m;
        try { m = JsonNode.Parse(json); } catch { return; }
        var cmd = (string?)m?["cmd"];
        try
        {
            switch (cmd)
            {
                case "ready":
                    SendState();
                    if (gh.Token != null)
                    {
                        if (startHidden) await BackgroundCheck(false); // started with Windows: just notify
                        else { await RefreshCatalog(); await CheckAppUpdate(); }
                    }
                    break;
                case "login": await Login(); break;
                case "cancelLogin": loginCts?.Cancel(); break;
                case "logout": Logout(); break;
                case "refresh": await RefreshCatalog(); await CheckAppUpdate(); break;
                case "install": await InstallOne((string)m!["id"]!); break;
                case "updateAll": await UpdateAll(); break;
                case "updateApp": await UpdateApp(quiet: false); break;
                case "uninstall": Uninstall((string)m!["id"]!); break;
                case "pickFolder": PickFolder(); break;
                case "setOption":
                    var opt = (string?)m!["name"];
                    var on = (bool?)m["value"] ?? false;
                    if (opt == "autostart") { settings.StartWithWindows = on; ApplyAutostart(); }
                    if (opt == "tray") settings.KeepInTray = on;
                    settings.Save();
                    SendState();
                    break;
                case "openFolder": if (settings.AddOnsPath != null) Process.Start("explorer.exe", settings.AddOnsPath); break;
                case "openUrl": OpenUrl((string?)m!["url"]); break;
                case "copy": SafeCopy((string?)m!["text"] ?? ""); break;

                // ---------- Mercado ----------
                case "ahInit": await MarketInit(); break;
                case "ahSaveKeys":
                    market.SaveKeys(settings, (string?)m!["id"], (string?)m["secret"]);
                    try { await market.LoadHouses(); }
                    catch (MarketException ex) when (ex.BadKeys) { market.SaveKeys(settings, null, null); throw; }
                    Toast("ok", "Chave da Blizzard salva!");
                    await MarketInit();
                    break;
                case "ahForgetKeys": market.SaveKeys(settings, null, null); SendMarketState(); break;
                case "ahSetHouse":
                    settings.AhHouse = (int?)m!["id"];
                    settings.Save();
                    await MarketTick(manual: true);
                    break;
                case "ahSetProfs":
                    settings.AhProfessions = m!["ids"]!.AsArray().Select(x => (int)x!).ToList();
                    settings.Save();
                    SendMarketRows();
                    break;
                case "ahSetAlert":
                    settings.AhAlertGold = Math.Max(0, (int?)m!["gold"] ?? 0);
                    settings.Save();
                    break;
                case "ahRefresh": await MarketTick(manual: true); break;
                case "ahRecipes":
                    await RunMarket("receitas", () => market.LoadRecipes(MarketProgress("receitas"), force: true));
                    SendMarketState(); SendMarketRows();
                    break;
                case "ahCompare":
                    var fac = (string?)m!["faction"] ?? "Aliança";
                    List<object>? cmp = null;
                    await RunMarket("comparar", async () => cmp = await market.CompareHouses(fac, MarketProgress("comparar")));
                    if (cmp != null) Post(new { type = "ahCompare", faction = fac, casas = cmp });
                    break;
                case "ahHistory":
                    if (settings.AhHouse is int hh)
                        Post(new { type = "ahHistory", item = (int)m!["item"]!, pontos = market.ItemHistory(hh, (int)m["item"]!) });
                    break;
            }
        }
        catch (Exception ex)
        {
            LogError(cmd ?? "?", ex);
            Toast("erro", ex is GitHubException or MarketException ? ex.Message : "Algo deu errado: " + ex.Message);
            if (ex is GitHubException { Status: System.Net.HttpStatusCode.Unauthorized }) Logout();
        }
    }

    /// <summary>Sends a message to the page. Safe from any thread (the Mercado download reports progress
    /// from worker threads; WebView2 only accepts calls on the window's thread).</summary>
    void Post(object payload)
    {
        var json = JsonSerializer.Serialize(payload);
        if (InvokeRequired)
        {
            try { BeginInvoke(() => web.CoreWebView2?.PostWebMessageAsJson(json)); } catch { }
            return;
        }
        web.CoreWebView2?.PostWebMessageAsJson(json);
    }
    void Toast(string kind, string text) => Post(new { type = "toast", kind, text });

    void SendState()
    {
        if (settings.AddOnsPath == null || !Directory.Exists(settings.AddOnsPath))
        {
            settings.AddOnsPath = WowLocator.Find();
            settings.Save();
        }
        Post(new
        {
            type = "state",
            loggedIn = gh.Token != null,
            login = settings.Login,
            avatar = settings.AvatarUrl,
            addonsPath = settings.AddOnsPath,
            wowRunning = WowLocator.WowIsRunning(),
            configured = !Config.GitHubClientId.StartsWith("COLOQUE") || Environment.GetEnvironmentVariable("LONTRAX_TOKEN") != null,
            version = Application.ProductVersion.Split('+')[0],
            autostart = settings.StartWithWindows,
            keepInTray = settings.KeepInTray,
        });
    }

    // ---------- login ----------
    /// <summary>The clipboard can be busy (another program holding it): retry, and never let it break the login.</summary>
    static void SafeCopy(string text)
    {
        try { Clipboard.SetDataObject(text, true, 10, 100); } catch (Exception ex) { LogError("clipboard", ex); }
    }

    static void LogError(string where, Exception ex)
    {
        try
        {
            File.AppendAllText(Path.Combine(Config.DataDir, "erros.log"),
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} [{where}] {ex.GetType().Name}: {ex.Message}{Environment.NewLine}");
        }
        catch { }
    }

    async Task Login()
    {
        loginCts?.Cancel();
        loginCts = new CancellationTokenSource();
        string token;
        try
        {
            var dc = await GitHubClient.StartDeviceLogin();
            Post(new { type = "deviceCode", code = dc.UserCode, uri = dc.VerificationUri });
            SafeCopy(dc.UserCode);
            token = await GitHubClient.WaitDeviceLogin(dc, loginCts.Token);
        }
        catch (TaskCanceledException) { Post(new { type = "loginCancelled" }); return; }
        catch (Exception ex)
        {
            LogError("login", ex);
            Post(new { type = "loginCancelled" });
            Toast("erro", ex is GitHubException ? ex.Message : "Não deu para entrar: " + ex.Message);
            return;
        }
        gh.Token = token;
        settings.SetToken(token);
        try
        {
            var (login, avatar) = await gh.GetUser();
            settings.Login = login;
            settings.AvatarUrl = avatar;
            settings.Save();
        }
        catch (Exception ex) { LogError("user", ex); }
        Toast("ok", $"Bem-vindo, {settings.Login ?? "herói"}! Pela Aliança!");
        SendState();
        await RefreshCatalog();
        await CheckAppUpdate();
    }

    void Logout()
    {
        gh.Token = null;
        settings.Login = null;
        settings.AvatarUrl = null;
        settings.SetToken(null);
        catalog = null;
        SendState();
    }

    // ---------- catalog ----------
    async Task RefreshCatalog(bool quiet = false)
    {
        if (gh.Token == null || busy) return;
        if (!quiet) Post(new { type = "loading" });
        var raw = await gh.GetRawFile(Config.CatalogRepo, Config.CatalogFile, Config.CatalogRef);
        catalog = JsonSerializer.Deserialize<CatalogFile>(raw, GitHubClient.JsonOptions) ?? new CatalogFile();
        latest.Clear();
        var errors = new Dictionary<string, string>();
        await Task.WhenAll(catalog.Addons.Select(async e =>
        {
            try { var c = await gh.GetLatestCommit(e.Repo, e.Ref); lock (latest) latest[e.Id] = c; }
            catch (GitHubException ex) { lock (errors) errors[e.Id] = ex.Message; }
        }));
        SendAddons(errors);
    }

    void SendAddons(Dictionary<string, string>? errors = null)
    {
        if (catalog == null) return;
        var path = settings.AddOnsPath;
        var items = catalog.Addons.Select(e =>
        {
            latest.TryGetValue(e.Id, out var c);
            var inst = path != null ? InstalledInfo.Read(path, e) : null;
            var exists = path != null && InstalledInfo.FolderExists(path, e);
            string status;
            string? err = null;
            if (errors != null && errors.TryGetValue(e.Id, out var x)) { status = "erro"; err = x; }
            else if (!exists) status = "nao_instalado";
            else if (inst == null) status = "externo";
            else if (c != null && inst.Sha == c.Sha) status = "atualizado";
            else status = "atualizar";
            return new
            {
                id = e.Id, nome = e.Nome, descricao = e.Descricao, autor = e.Autor, tags = e.Tags ?? new List<string>(),
                repo = e.Repo, status, erro = err, obrigatorio = e.Obrigatorio,
                instalado = inst == null ? null : new { sha = inst.Sha[..7], data = inst.Instalado.ToString("dd/MM/yyyy HH:mm") },
                novo = c == null ? null : new { sha = c.Sha[..7], data = c.Date.ToLocalTime().ToString("dd/MM/yyyy HH:mm"), msg = c.Message },
            };
        }).ToList();
        Post(new { type = "addons", titulo = catalog.Titulo, mensagem = catalog.Mensagem, items, wowRunning = WowLocator.WowIsRunning() });
    }

    // ---------- install ----------
    bool CheckPath()
    {
        if (settings.AddOnsPath != null && Directory.Exists(settings.AddOnsPath)) return true;
        Toast("erro", "Não achei a pasta do WoW. Clique em \"Alterar\" e escolha a pasta AddOns.");
        return false;
    }

    async Task InstallOne(string id, bool refresh = true)
    {
        if (busy || catalog == null || !CheckPath()) return;
        var e = catalog.Addons.FirstOrDefault(a => a.Id == id);
        if (e == null) return;
        busy = true;
        try
        {
            if (!latest.TryGetValue(id, out var c)) { c = await gh.GetLatestCommit(e.Repo, e.Ref); latest[id] = c; }
            Post(new { type = "progress", id, value = 0.02 });
            await Installer.Install(gh, settings.AddOnsPath!, e, c, new SyncProgress(p => Post(new { type = "progress", id, value = p })));
            Toast("ok", $"{e.Nome} instalado!" + (WowLocator.WowIsRunning() ? " No jogo, digite /reload." : ""));
        }
        catch (Exception ex)
        {
            Toast("erro", $"{e.Nome}: " + (ex is GitHubException ? ex.Message : ex.Message));
        }
        finally
        {
            busy = false;
            Post(new { type = "progressEnd", id });
            if (refresh) SendAddons();
        }
    }

    async Task UpdateAll()
    {
        if (catalog == null || !CheckPath()) return;
        var path = settings.AddOnsPath!;
        var todo = catalog.Addons.Where(e =>
        {
            if (!latest.TryGetValue(e.Id, out var c)) return false;
            var inst = InstalledInfo.Read(path, e);
            return inst == null || inst.Sha != c.Sha;
        }).ToList();
        if (todo.Count == 0) { Toast("ok", "Tudo em dia. Nada para atualizar!"); return; }
        foreach (var e in todo) await InstallOne(e.Id, refresh: false);
        SendAddons();
    }

    void Uninstall(string id)
    {
        if (catalog == null || !CheckPath()) return;
        var e = catalog.Addons.FirstOrDefault(a => a.Id == id);
        if (e == null) return;
        Installer.Uninstall(settings.AddOnsPath!, e);
        Toast("ok", $"{e.Nome} removido (uma cópia ficou guardada nos backups).");
        SendAddons();
    }

    void PickFolder()
    {
        using var dlg = new FolderBrowserDialog
        {
            Description = "Escolha a pasta AddOns do WoW (World of Warcraft\\_forever_\\Interface\\AddOns)",
            UseDescriptionForTitle = true,
            InitialDirectory = settings.AddOnsPath ?? "",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var p = dlg.SelectedPath;
        // Accept the WoW folder or _forever_ too, and walk down to AddOns.
        foreach (var guess in new[] { p, Path.Combine(p, "AddOns"), Path.Combine(p, "Interface", "AddOns"), Path.Combine(p, Config.WowFlavor, "Interface", "AddOns") })
        {
            if (WowLocator.LooksLikeAddOns(guess)) { p = guess; break; }
        }
        if (!WowLocator.LooksLikeAddOns(p))
        {
            Toast("erro", "Essa não parece ser a pasta AddOns do WoW.");
            return;
        }
        settings.AddOnsPath = p;
        settings.Save();
        SendState();
        SendAddons();
    }

    // ---------- Mercado: auction house prices and craft profit ----------
    readonly Market market = new();
    readonly System.Windows.Forms.Timer marketTimer = new() { Interval = 15 * 60 * 1000 };
    bool marketBusy;

    IProgress<double> MarketProgress(string what) => new SyncProgress(p => Post(new { type = "ahProgress", what, value = p }));

    /// <summary>Runs one market job at a time and turns its errors into a message on screen.</summary>
    async Task<bool> RunMarket(string what, Func<Task> job)
    {
        if (marketBusy) return false;
        marketBusy = true;
        Post(new { type = "ahProgress", what, value = 0.01 });
        try { await job(); return true; }
        catch (MarketException ex)
        {
            LogError("market", ex);
            Post(new { type = "ahError", text = ex.Message, badKeys = ex.BadKeys });
            return false;
        }
        catch (Exception ex)
        {
            LogError("market", ex);
            Post(new { type = "ahError", text = "Algo deu errado no Mercado: " + ex.Message });
            return false;
        }
        finally { marketBusy = false; Post(new { type = "ahProgressEnd", what }); }
    }

    void SendMarketState()
    {
        var snap = settings.AhHouse is int h ? market.GetSnapshot(h) : null;
        Post(new
        {
            type = "ahState",
            hasKeys = market.Api.HasKeys,
            casas = market.Houses.Select(x => new { id = x.Id, nome = x.Name, faccao = x.Faction }),
            casa = settings.AhHouse,
            profissoes = market.Book?.Professions.Select(p => new { id = p.Id, nome = p.Name, receitas = p.Recipes.Count }),
            escolhidas = settings.AhProfessions,
            alerta = settings.AhAlertGold,
            atualizado = snap?.LastModified.ToLocalTime().ToString("dd/MM HH:mm"),
            checado = snap?.Fetched.ToLocalTime().ToString("HH:mm"),
            taxa = Market.AhCut,
        });
    }

    void SendMarketRows()
    {
        if (settings.AhHouse is not int h || market.Book == null) return;
        Post(new { type = "ahRows", rows = market.Compute(h, settings.AhProfessions) });
    }

    async Task MarketInit()
    {
        if (!market.Api.HasKeys) { SendMarketState(); return; }
        await RunMarket("receitas", async () =>
        {
            await market.LoadHouses();
            await market.LoadRecipes(MarketProgress("receitas"));
        });
        SendMarketState();
        SendMarketRows();
        if (settings.AhHouse is int h && (market.GetSnapshot(h) is not { } s || DateTime.UtcNow - s.Fetched > TimeSpan.FromMinutes(20)))
            await MarketTick(manual: false);
    }

    /// <summary>Every 15 minutes: asks Blizzard whether the house has a newer dump (cheap when nothing changed).</summary>
    async Task MarketTick(bool manual)
    {
        if (!market.Api.HasKeys || settings.AhHouse is not int h) { if (manual) SendMarketState(); return; }
        var fresh = false;
        var ok = await RunMarket("precos", async () =>
        {
            if (market.Book == null) { await market.LoadHouses(); await market.LoadRecipes(MarketProgress("receitas")); }
            fresh = await market.RefreshHouse(h);
        });
        if (!ok) return;
        SendMarketState();
        if (fresh || manual) SendMarketRows();
        if (manual && !fresh) Post(new { type = "ahInfo", text = "Os preços já estão em dia. A Blizzard atualiza mais ou menos de hora em hora." });
        if (fresh) MarketAlert(h);
    }

    void MarketAlert(int house)
    {
        if (settings.AhAlertGold <= 0) return;
        var nowHour = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / 3600;
        var best = market.Compute(house, settings.AhProfessions)
            .Where(r => r.lucro >= settings.AhAlertGold * 10000L && r.aVenda > 0)
            .Where(r => !settings.AhAlerted.TryGetValue(r.receita, out var at) || nowHour - at >= 6)
            .OrderByDescending(r => r.lucro).Take(3).ToList();
        if (best.Count == 0) return;
        foreach (var r in best) settings.AhAlerted[r.receita] = nowHour;
        foreach (var k in settings.AhAlerted.Where(k => nowHour - k.Value > 48).Select(k => k.Key).ToList()) settings.AhAlerted.Remove(k);
        settings.Save();
        static string G(long c) => c >= 10000 ? $"{c / 10000}g {c / 100 % 100}s" : $"{c / 100}s {c % 100}c";
        tray.ShowBalloonTip(8000, "Mercado: craft com lucro!",
            string.Join("\n", best.Select(r => $"{r.nome}: +{G(r.lucro!.Value)}")), ToolTipIcon.Info);
    }

    static void OpenUrl(string? url)
    {
        if (url == null) return;
        if (!(url.StartsWith("https://github.com/") || url.StartsWith("https://git-scm.com/") || url.StartsWith("https://go.microsoft.com/")
              || url.StartsWith("https://develop.battle.net/"))) return;
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
