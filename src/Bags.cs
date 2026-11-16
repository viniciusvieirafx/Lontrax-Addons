using System.Text;
using System.Text.RegularExpressions;

namespace LontraxAddons;

/// <summary>Reads what the in-game addon "Lontrax Mercado" wrote (WTF\Account\*\SavedVariables\LontraxMercado.lua)
/// and says, per item, whether it is worth selling on the AH, to an NPC, or keeping for a craft.</summary>
static class Bags
{
    public sealed record Item(int id, int qtd, long npc, bool vinc, string nome, bool unico = false, int qualidade = -1);

    public sealed class Character
    {
        public string guid { get; set; } = "";
        public string nome { get; set; } = "";
        public int nivel { get; set; }
        public long dinheiro { get; set; }
        public DateTime? atualizado { get; set; }
        public DateTime? bancoAtualizado { get; set; }
        public List<Item> bolsas { get; set; } = new();
        public List<Item> banco { get; set; } = new();
    }

    /// <summary>All SavedVariables files of the addon (one per WoW account folder).</summary>
    public static List<string> Files(string? addOnsPath)
    {
        var list = new List<string>();
        if (string.IsNullOrEmpty(addOnsPath)) return list;
        try
        {
            // ...\_forever_\Interface\AddOns → ...\_forever_\WTF\Account
            var flavor = Directory.GetParent(addOnsPath)?.Parent?.FullName;
            var accounts = flavor == null ? null : Path.Combine(flavor, "WTF", "Account");
            if (accounts == null || !Directory.Exists(accounts)) return list;
            foreach (var acc in Directory.GetDirectories(accounts))
            {
                var f = Path.Combine(acc, "SavedVariables", "LontraxMercado.lua");
                if (File.Exists(f)) list.Add(f);
            }
        }
        catch { }
        return list;
    }

    // One character block: ["Player-..."] = { ...only plain values inside... },
    static readonly Regex CharBlock = new(@"\[""(Player-[^""]+)""\]\s*=\s*\{([^{}]*)\}", RegexOptions.Compiled);
    static readonly Regex Field = new(@"\[""(\w+)""\]\s*=\s*(""(?:[^""\\]|\\.)*""|-?[\d.]+|true|false)", RegexOptions.Compiled);

    public static List<Character> Read(string? addOnsPath)
    {
        var chars = new List<Character>();
        foreach (var file in Files(addOnsPath))
        {
            string text;
            try { text = File.ReadAllText(file, Encoding.UTF8); } catch { continue; }
            foreach (Match b in CharBlock.Matches(text))
            {
                var c = new Character { guid = b.Groups[1].Value };
                foreach (Match f in Field.Matches(b.Groups[2].Value))
                {
                    var key = f.Groups[1].Value;
                    var raw = f.Groups[2].Value;
                    var str = raw.StartsWith('"') ? LuaString(raw) : null;
                    long.TryParse(raw.Split('.')[0], out var num);
                    switch (key)
                    {
                        case "nome": c.nome = str ?? ""; break;
                        case "nivel": c.nivel = (int)num; break;
                        case "dinheiro": c.dinheiro = num; break;
                        case "atualizado": c.atualizado = num > 0 ? DateTimeOffset.FromUnixTimeSeconds(num).LocalDateTime : null; break;
                        case "bancoAtualizado": c.bancoAtualizado = num > 0 ? DateTimeOffset.FromUnixTimeSeconds(num).LocalDateTime : null; break;
                        case "bolsas": c.bolsas = Items(str); break;
                        case "banco": c.banco = Items(str); break;
                    }
                }
                if (c.nome.Length > 0) chars.Add(c);
            }
        }
        return chars.OrderByDescending(c => c.atualizado ?? DateTime.MinValue).ToList();
    }

    /// <summary>"id^qtd^npc^vinc^nome~id^..." (format written by the addon).</summary>
    static List<Item> Items(string? s)
    {
        var list = new List<Item>();
        if (string.IsNullOrEmpty(s)) return list;
        foreach (var part in s.Split('~'))
        {
            var f = part.Split('^');
            if (f.Length < 4 || !int.TryParse(f[0], out var id) || !int.TryParse(f[1], out var qtd)) continue;
            long.TryParse(f[2], out var npc);
            // Fields 6 and 7 (unique, quality) exist since addon 1.1.0; older saves simply lack them.
            var q = -1;
            if (f.Length > 6) int.TryParse(f[6], out q);
            list.Add(new Item(id, qtd, npc, f[3] == "1", f.Length > 4 ? f[4] : "", f.Length > 5 && f[5] == "1", q));
        }
        return list;
    }

    /// <summary>Lua string literal as WoW writes it: "...", with \" \\ \n and \ddd escapes.</summary>
    static string LuaString(string lit)
    {
        var s = lit[1..^1];
        var sb = new StringBuilder();
        var bytes = new List<byte>();
        void Flush() { if (bytes.Count > 0) { sb.Append(Encoding.UTF8.GetString(bytes.ToArray())); bytes.Clear(); } }
        for (var i = 0; i < s.Length; i++)
        {
            var ch = s[i];
            if (ch == '\\' && i + 1 < s.Length)
            {
                var n = s[++i];
                if (char.IsDigit(n))
                {
                    var j = i; var v = 0;
                    while (j < s.Length && j < i + 3 && char.IsDigit(s[j])) v = v * 10 + (s[j++] - '0');
                    bytes.Add((byte)v); i = j - 1; continue;
                }
                Flush();
                sb.Append(n switch { 'n' => '\n', 't' => '\t', 'r' => '\r', _ => n });
                continue;
            }
            Flush();
            sb.Append(ch);
        }
        Flush();
        return sb.ToString();
    }

    // ---------- advice ----------
    public sealed record Advice(int id, string nome, int qtd, string onde, long? ahUnidade, long npcUnidade, long ganho,
        int aVenda, bool vinculado, string? craft, int? craftItem, long? craftLucro, bool craftConhecida, bool unico, int qualidade);

    /// <summary>Per item: AH (already minus the 5% cut) vs NPC, plus "keep it: it's a reagent of a profitable craft".</summary>
    public static List<Advice> Advise(Market market, int house, IEnumerable<Item> items, HashSet<int>? known)
    {
        var snap = market.GetSnapshot(house);
        // Best profitable craft that uses each item as a reagent (prefer recipes the character knows).
        var craftByReagent = new Dictionary<int, (string nome, int item, long lucro, bool conhecida)>();
        foreach (var r in market.Compute(house, Array.Empty<int>()).Where(r => r.lucro > 0 && r.aVenda >= 2))
        {
            var isKnown = known != null && known.Contains(r.receita);
            foreach (var m in r.materiais)
            {
                if (craftByReagent.TryGetValue(m.id, out var cur) && (cur.conhecida && !isKnown || cur.conhecida == isKnown && cur.lucro >= r.lucro!.Value)) continue;
                craftByReagent[m.id] = (r.nome, r.item, r.lucro!.Value, isKnown);
            }
        }

        var list = new List<Advice>();
        foreach (var g in items.GroupBy(i => (i.id, i.vinc)))
        {
            var it = g.First();
            var qtd = g.Sum(x => x.qtd);
            Price? p = null;
            snap?.Prices.TryGetValue(it.id, out p);
            long? ahUnit = p?.Min;
            var net = ahUnit == null ? 0 : (long)(ahUnit.Value * (1 - Market.AhCut));
            string onde;
            long ganho;
            if (it.vinc) { onde = it.npc > 0 ? "npc" : "nada"; ganho = it.npc * qtd; }
            else if (ahUnit == null) { onde = it.npc > 0 ? "npc" : "sem"; ganho = it.npc * qtd; }
            else if (net > it.npc * 1.15 && net - it.npc >= 5) { onde = "ah"; ganho = net * qtd; }
            else { onde = it.npc > 0 ? "npc" : "ah"; ganho = Math.Max(net, it.npc) * qtd; }
            craftByReagent.TryGetValue(it.id, out var craft);
            list.Add(new Advice(it.id, it.nome, qtd, onde, ahUnit, it.npc, ganho, p?.Qty ?? 0, it.vinc,
                craft.nome, craft.nome == null ? null : craft.item, craft.nome == null ? null : craft.lucro, craft.conhecida, g.Any(x => x.unico), g.Max(x => x.qualidade)));
        }
        return list.OrderByDescending(a => a.ganho).ToList();
    }
}
