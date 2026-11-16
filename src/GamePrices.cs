using System.Globalization;
using System.Text;

namespace LontraxAddons;

/// <summary>Sends the auction house prices INTO the game: writes AddOns\LontraxMercado\Precos.lua, which the
/// in-game addon "Lontrax Mercado" reads (on login or /reload) to show the AH price on item tooltips.
/// The game cannot reach the internet, so this file is the only way prices get there.</summary>
static class GamePrices
{
    public const string AddonFolder = "LontraxMercado";
    public const string FileName = "Precos.lua";
    const int Format = 1;
    const int ChunkSize = 2000; // items per Lua function (keeps each function far below Lua's constant limit)

    public static string? PricesFile(string? addOnsPath) =>
        addOnsPath == null ? null : Path.Combine(addOnsPath, AddonFolder, FileName);

    /// <summary>Lontrax Mercado is installed (its .toc is there).</summary>
    public static bool AddonInstalled(string? addOnsPath) =>
        addOnsPath != null && File.Exists(Path.Combine(addOnsPath, AddonFolder, AddonFolder + ".toc"));

    /// <summary>What was last written, read back from the file header (null = nothing written yet).</summary>
    public sealed record Written(int House, DateTimeOffset PricesFrom, DateTime WrittenAt);

    public static Written? ReadHeader(string? addOnsPath)
    {
        var file = PricesFile(addOnsPath);
        if (file == null || !File.Exists(file)) return null;
        try
        {
            using var r = new StreamReader(file);
            for (var i = 0; i < 4 && r.ReadLine() is string line; i++)
            {
                // -- lontrax: casa=110 hora=1763075867 gravado=1763076000
                if (!line.StartsWith("-- lontrax:")) continue;
                int house = 0; long hora = 0, gravado = 0;
                foreach (var part in line[11..].Split(' ', StringSplitOptions.RemoveEmptyEntries))
                {
                    var kv = part.Split('=');
                    if (kv.Length != 2) continue;
                    if (kv[0] == "casa") int.TryParse(kv[1], out house);
                    if (kv[0] == "hora") long.TryParse(kv[1], out hora);
                    if (kv[0] == "gravado") long.TryParse(kv[1], out gravado);
                }
                if (house == 0) return null;
                return new Written(house, DateTimeOffset.FromUnixTimeSeconds(hora),
                    DateTimeOffset.FromUnixTimeSeconds(gravado).LocalDateTime);
            }
        }
        catch { }
        return null;
    }

    /// <summary>Builds the Lua text (separate so the self test can check it).</summary>
    public static string BuildLua(Snapshot snap, string houseName, DateTimeOffset now)
    {
        var inv = CultureInfo.InvariantCulture;
        var sb = new StringBuilder(snap.Prices.Count * 24 + 512);
        var hora = snap.LastModified.ToUnixTimeSeconds();
        var gravado = now.ToUnixTimeSeconds();
        sb.Append("-- lontrax: casa=").Append(snap.House.ToString(inv))
          .Append(" hora=").Append(hora.ToString(inv)).Append(" gravado=").Append(gravado.ToString(inv)).Append('\n');
        sb.Append("-- Gerado pelo app Lontrax Addons (não edite). Preços da Casa de Leilões para o addon Lontrax Mercado.\n");
        sb.Append("LontraxMercadoPrecos = { versao = ").Append(Format.ToString(inv))
          .Append(", casa = ").Append(snap.House.ToString(inv))
          .Append(", casaNome = \"").Append(LuaEscape(houseName)).Append('"')
          .Append(", hora = ").Append(hora.ToString(inv))
          .Append(", gravado = ").Append(gravado.ToString(inv))
          .Append(", itens = ").Append(snap.Prices.Count.ToString(inv))
          .Append(", min = {}, qtd = {} }\n");
        sb.Append("local m, q = LontraxMercadoPrecos.min, LontraxMercadoPrecos.qtd\n");
        var n = 0;
        foreach (var (id, p) in snap.Prices.OrderBy(kv => kv.Key))
        {
            if (p.Min <= 0) continue;
            if (n % ChunkSize == 0)
            {
                if (n > 0) sb.Append("end f() end\n");
                sb.Append("do local function f()\n");
            }
            sb.Append("m[").Append(id.ToString(inv)).Append("]=").Append(p.Min.ToString(inv))
              .Append(" q[").Append(id.ToString(inv)).Append("]=").Append(p.Qty.ToString(inv)).Append('\n');
            n++;
        }
        if (n > 0) sb.Append("end f() end\n");
        return sb.ToString();
    }

    /// <summary>Writes the prices file if Lontrax Mercado is installed. Returns true when written.</summary>
    public static bool Write(string? addOnsPath, Snapshot? snap, string houseName)
    {
        if (snap == null || snap.Prices.Count == 0 || !AddonInstalled(addOnsPath)) return false;
        var file = PricesFile(addOnsPath)!;
        var tmp = file + ".tmp";
        File.WriteAllText(tmp, BuildLua(snap, houseName, DateTimeOffset.UtcNow), new UTF8Encoding(false));
        File.Move(tmp, file, overwrite: true);
        return true;
    }

    static string LuaEscape(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", " ");
}
