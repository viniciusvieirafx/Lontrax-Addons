using System.Text;

namespace LontraxAddons;

/// <summary>Kills tab: reads what the in-game addon Lontrax Dog Tags saved
/// (WTF\Account\*\SavedVariables\LontraxDogTags.lua, table LontraxDogTagsDB) and hands it to the page as plain JSON.
/// The format is the contract written in "Insta addon\PROMPT-DOGTAGS.md".</summary>
static class DogTags
{
    const string AddonFolder = "LontraxDogTags";
    const string DbName = "LontraxDogTagsDB";

    /// <summary>"sem" = addon not installed, "ok" = installed.</summary>
    public static string AddonState(string? addOnsPath) =>
        !string.IsNullOrEmpty(addOnsPath) && File.Exists(Path.Combine(addOnsPath, AddonFolder, AddonFolder + ".toc")) ? "ok" : "sem";

    static List<string> Files(string? addOnsPath)
    {
        var list = new List<string>();
        if (string.IsNullOrEmpty(addOnsPath)) return list;
        try
        {
            var flavor = Directory.GetParent(addOnsPath)?.Parent?.FullName;
            var accounts = flavor == null ? null : Path.Combine(flavor, "WTF", "Account");
            if (accounts == null || !Directory.Exists(accounts)) return list;
            foreach (var acc in Directory.GetDirectories(accounts))
            {
                var f = Path.Combine(acc, "SavedVariables", AddonFolder + ".lua");
                if (File.Exists(f)) list.Add(f);
            }
        }
        catch { }
        return list;
    }

    /// <summary>Every own character from every WoW account folder (newest save wins), feed oldest → newest.</summary>
    public static (List<object?> chars, bool found, DateTime? updated) Read(string? addOnsPath)
    {
        var byGuid = new Dictionary<string, Dictionary<string, object?>>();
        var found = false;
        DateTime? updated = null;
        foreach (var file in Files(addOnsPath))
        {
            Dictionary<object, object?>? db;
            try { db = Lua.ParseAssignment(File.ReadAllText(file, Encoding.UTF8), DbName); }
            catch { continue; }
            if (db?.GetValueOrDefault("chars") is not Dictionary<object, object?> chars) continue;
            found = true;
            try { var w = File.GetLastWriteTime(file); if (updated == null || w > updated) updated = w; } catch { }
            foreach (var (key, cv) in chars)
            {
                if (Plain(cv) is not Dictionary<string, object?> c) continue;
                var guid = c.GetValueOrDefault("guid") as string ?? key.ToString() ?? "";
                c["guid"] = guid;
                if (byGuid.TryGetValue(guid, out var old) && Num(old, "atualizado") > Num(c, "atualizado")) continue;
                byGuid[guid] = c;
            }
        }
        return (byGuid.Values.Cast<object?>().ToList(), found, updated);
    }

    static double Num(Dictionary<string, object?> d, string k) => d.GetValueOrDefault(k) is double v ? v : 0;

    /// <summary>Lua table → JSON-friendly value: 1..n keys become a list, anything else an object with string keys.</summary>
    static object? Plain(object? v)
    {
        if (v is not Dictionary<object, object?> t) return v;
        var isList = t.Count > 0 && t.Keys.All(k => k is double);
        if (isList)
        {
            var keys = t.Keys.Cast<double>().OrderBy(k => k).ToList();
            if (keys[0] == 1 && keys[^1] == keys.Count) return keys.Select(k => Plain(t[k])).ToList();
        }
        var o = new Dictionary<string, object?>();
        foreach (var (k, val) in t) o[Convert.ToString(k, System.Globalization.CultureInfo.InvariantCulture) ?? ""] = Plain(val);
        return o;
    }
}
