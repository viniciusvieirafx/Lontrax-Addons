using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LontraxAddons;

sealed class GitHubException(string message, HttpStatusCode? status = null) : Exception(message)
{
    public HttpStatusCode? Status { get; } = status;
}

/// <summary>Talks to GitHub: device login (no password typed in the app), catalog, commits and downloads.</summary>
sealed class GitHubClient
{
    static readonly HttpClient Http = CreateHttp();
    public string? Token { get; set; }

    static HttpClient CreateHttp()
    {
        var h = new HttpClient(new HttpClientHandler { AllowAutoRedirect = true }) { Timeout = TimeSpan.FromMinutes(5) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("LontraxAddons/1.0");
        return h;
    }

    // ---------- Device login ----------
    public sealed record DeviceCode(string UserCode, string VerificationUri, string Code, int Interval, int ExpiresIn);

    public static async Task<DeviceCode> StartDeviceLogin()
    {
        if (Config.GitHubClientId.StartsWith("COLOQUE"))
            throw new GitHubException("O app ainda não foi configurado (falta o Client ID do GitHub App).");
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/device/code")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["client_id"] = Config.GitHubClientId }),
        };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var res = await Http.SendAsync(req);
        var j = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;
        if (j["error"] != null) throw new GitHubException("GitHub recusou o login: " + (string?)j["error_description"]);
        return new DeviceCode((string)j["user_code"]!, (string)j["verification_uri"]!, (string)j["device_code"]!,
            (int?)j["interval"] ?? 5, (int?)j["expires_in"] ?? 900);
    }

    /// <summary>Waits until the person approves the code in the browser. Returns the token.</summary>
    public static async Task<string> WaitDeviceLogin(DeviceCode dc, CancellationToken ct)
    {
        var interval = Math.Max(dc.Interval, 5);
        var until = DateTime.UtcNow.AddSeconds(dc.ExpiresIn);
        while (DateTime.UtcNow < until)
        {
            await Task.Delay(TimeSpan.FromSeconds(interval), ct);
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = Config.GitHubClientId,
                    ["device_code"] = dc.Code,
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                }),
            };
            req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var res = await Http.SendAsync(req, ct);
            var j = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct))!;
            var token = (string?)j["access_token"];
            if (!string.IsNullOrEmpty(token)) return token;
            switch ((string?)j["error"])
            {
                case "authorization_pending": break;
                case "slow_down": interval += 5; break;
                case "expired_token": throw new GitHubException("O código expirou. Tente entrar de novo.");
                case "access_denied": throw new GitHubException("O login foi cancelado no GitHub.");
                default: throw new GitHubException("Erro no login: " + ((string?)j["error_description"] ?? (string?)j["error"]));
            }
        }
        throw new GitHubException("O código expirou. Tente entrar de novo.");
    }

    // ---------- API ----------
    HttpRequestMessage Api(string pathAndQuery, string accept = "application/vnd.github+json")
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "https://api.github.com" + pathAndQuery);
        req.Headers.Accept.ParseAdd(accept);
        req.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        if (!string.IsNullOrEmpty(Token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        return req;
    }

    async Task<HttpResponseMessage> Send(HttpRequestMessage req)
    {
        HttpResponseMessage res;
        try { res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead); }
        catch (HttpRequestException e) { throw new GitHubException("Sem conexão com o GitHub (" + e.Message + ")."); }
        if (res.IsSuccessStatusCode) return res;
        var code = res.StatusCode;
        res.Dispose();
        throw code switch
        {
            HttpStatusCode.Unauthorized => new GitHubException("Seu login do GitHub expirou. Entre de novo.", code),
            HttpStatusCode.NotFound => new GitHubException("Sem acesso (aceitou o convite do repositório?).", code),
            HttpStatusCode.Forbidden => new GitHubException("O GitHub bloqueou por um tempo (muitos pedidos). Tente daqui a pouco.", code),
            _ => new GitHubException("GitHub respondeu " + (int)code + ".", code),
        };
    }

    public async Task<(string Login, string Avatar)> GetUser()
    {
        using var res = await Send(Api("/user"));
        var j = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;
        return ((string)j["login"]!, (string?)j["avatar_url"] ?? "");
    }

    public async Task<string> GetRawFile(string repo, string path, string gitRef)
    {
        using var res = await Send(Api($"/repos/{repo}/contents/{Uri.EscapeDataString(path)}?ref={Uri.EscapeDataString(gitRef)}",
            "application/vnd.github.raw+json"));
        return await res.Content.ReadAsStringAsync();
    }

    public sealed record CommitInfo(string Sha, string Message, DateTimeOffset Date);

    public async Task<CommitInfo> GetLatestCommit(string repo, string gitRef)
    {
        using var res = await Send(Api($"/repos/{repo}/commits/{Uri.EscapeDataString(gitRef)}"));
        var j = JsonNode.Parse(await res.Content.ReadAsStringAsync())!;
        var msg = ((string?)j["commit"]?["message"] ?? "").Split('\n')[0];
        var date = DateTimeOffset.TryParse((string?)j["commit"]?["committer"]?["date"], out var d) ? d : DateTimeOffset.MinValue;
        return new CommitInfo((string)j["sha"]!, msg, date);
    }

    public async Task DownloadZip(string repo, string sha, string destFile, IProgress<double>? progress)
    {
        using var res = await Send(Api($"/repos/{repo}/zipball/{sha}"));
        var total = res.Content.Headers.ContentLength;
        await using var src = await res.Content.ReadAsStreamAsync();
        await using var dst = File.Create(destFile);
        var buf = new byte[81920];
        long done = 0;
        int n;
        while ((n = await src.ReadAsync(buf)) > 0)
        {
            await dst.WriteAsync(buf.AsMemory(0, n));
            done += n;
            if (total > 0) progress?.Report((double)done / total.Value);
        }
    }

    public static JsonSerializerOptions JsonOptions { get; } = new() { PropertyNameCaseInsensitive = true };
}
