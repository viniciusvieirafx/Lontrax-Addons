using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LontraxAddons;

/// <summary>Per-PC settings: where the AddOns folder is and the GitHub login (encrypted for this Windows user).</summary>
sealed class Settings
{
    public string? AddOnsPath { get; set; }
    public string? TokenProtected { get; set; }
    public string? Login { get; set; }
    public string? AvatarUrl { get; set; }
    /// <summary>Closing the window keeps the app next to the clock, checking for updates.</summary>
    public bool KeepInTray { get; set; } = true;
    public bool StartWithWindows { get; set; } = true;
    /// <summary>Last version (commit) we already told the person about, per addon id.</summary>
    public Dictionary<string, string> Notified { get; set; } = new();

    static string FilePath => Path.Combine(Config.DataDir, "config.json");
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath)) ?? new Settings();
        }
        catch { }
        return new Settings();
    }

    public void Save() => File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Json));

    public string? GetToken()
    {
        var env = Environment.GetEnvironmentVariable("LONTRAX_TOKEN");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        if (string.IsNullOrEmpty(TokenProtected)) return null;
        try
        {
            var raw = ProtectedData.Unprotect(Convert.FromBase64String(TokenProtected), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(raw);
        }
        catch { return null; }
    }

    public void SetToken(string? token)
    {
        TokenProtected = token == null ? null : Convert.ToBase64String(
            ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser));
        Save();
    }
}
