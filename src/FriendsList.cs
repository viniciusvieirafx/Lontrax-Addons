using System.Diagnostics;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LontraxAddons;

/// <summary>Owner's PC only: sends the names in the owner's in-game friends list (plus their own characters)
/// to the "amigos" branch of the catalog repo. The hourly GitHub job (tools/precos.py) reads that file and
/// publishes the professions of those characters, so friends without a Blizzard key can pick them in the Mercado.
/// The app's own GitHub login is read-only, so this uses the GitHub CLI login (gh) when it exists on this PC;
/// on friends' PCs there is no gh login with write access and nothing happens.</summary>
static class FriendsList
{
    public const string Branch = "amigos";
    const string FileName = "amigos.json";
    static string SentFile => Path.Combine(Config.DataDir, "amigos", "enviado.txt");
    static bool gaveUp;
    static readonly SemaphoreSlim Gate = new(1, 1);

    /// <summary>One send at a time (start-up, the Friends tab and the market timer may ask together).</summary>
    public static async Task Sync(IEnumerable<Friends.Friend> friends)
    {
        await Gate.WaitAsync();
        try { await SyncOnce(friends); }
        finally { Gate.Release(); }
    }

    static async Task SyncOnce(IEnumerable<Friends.Friend> friends)
    {
        if (gaveUp) return;
        var names = friends
            .Where(f => !string.IsNullOrEmpty(f.slug) && !string.IsNullOrEmpty(f.sobrenome))
            .GroupBy(f => f.slug).Select(g => g.First())
            .OrderBy(f => f.slug, StringComparer.Ordinal)
            .ToDictionary(f => f.slug, f => $"{f.nome} {f.sobrenome}".Trim());
        if (names.Count == 0) return;
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(names))));
        try { if (File.Exists(SentFile) && File.ReadAllText(SentFile).Trim() == hash) return; } catch { }

        var token = await GhToken();
        if (token == null) { gaveUp = true; return; }

        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("LontraxAddons/1.0");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var repo = "https://api.github.com/repos/" + Config.CatalogRepo;

        // The branch holds only this file; create it from main the first time.
        using (var b = await http.GetAsync($"{repo}/git/ref/heads/{Branch}"))
        {
            if ((int)b.StatusCode == 404)
            {
                using var main = await http.GetAsync($"{repo}/git/ref/heads/main");
                if (!main.IsSuccessStatusCode) { gaveUp = true; return; }
                var sha = (string?)JsonNode.Parse(await main.Content.ReadAsStringAsync())?["object"]?["sha"];
                using var mk = await http.PostAsync($"{repo}/git/refs", Json(new { @ref = "refs/heads/" + Branch, sha }));
                if (!mk.IsSuccessStatusCode) { gaveUp = true; return; }
            }
            else if (!b.IsSuccessStatusCode) { gaveUp = true; return; }
        }

        string? fileSha = null;
        using (var cur = await http.GetAsync($"{repo}/contents/{FileName}?ref={Branch}"))
            if (cur.IsSuccessStatusCode)
                fileSha = (string?)JsonNode.Parse(await cur.Content.ReadAsStringAsync())?["sha"];

        var body = JsonSerializer.Serialize(new { gerado = DateTime.UtcNow.ToString("o"), personagens = names },
            new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        using var put = new HttpRequestMessage(HttpMethod.Put, $"{repo}/contents/{FileName}")
        {
            Content = Json(new
            {
                message = $"Lista de amigos: {names.Count} personagens",
                content = Convert.ToBase64String(Encoding.UTF8.GetBytes(body)),
                branch = Branch,
                sha = fileSha,
            }),
        };
        using var res = await http.SendAsync(put);
        if (!res.IsSuccessStatusCode) { gaveUp = true; throw new Exception("GitHub respondeu " + (int)res.StatusCode + " ao enviar a lista de amigos."); }
        Directory.CreateDirectory(Path.GetDirectoryName(SentFile)!);
        File.WriteAllText(SentFile, hash);
    }

    static StringContent Json(object o) => new(JsonSerializer.Serialize(o), Encoding.UTF8, "application/json");

    /// <summary>The GitHub CLI's token, or null when gh is not installed or not logged in.</summary>
    static async Task<string?> GhToken()
    {
        var exe = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "GitHub CLI", "gh.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "GitHub CLI", "gh.exe"),
        }.FirstOrDefault(File.Exists);
        if (exe == null) return null;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(exe, "auth token")
            {
                RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
            })!;
            var outTask = p.StandardOutput.ReadToEndAsync();
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            await p.WaitForExitAsync(cts.Token);
            var t = (await outTask).Trim();
            return p.ExitCode == 0 && t.Length > 0 ? t : null;
        }
        catch { return null; }
    }
}
