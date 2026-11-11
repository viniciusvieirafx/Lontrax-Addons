"""Baixa os preços de todas as Casas de Leilões do WoW Forever (US) e grava um arquivo pequeno por casa.

Roda de hora em hora no GitHub Actions (.github/workflows/precos.yml) com a chave da Blizzard guardada
como segredo do repositório. O app Lontrax Addons lê esses arquivos (ramo "precos") quando a pessoa não
tem chave própria, então a galera não precisa criar chave nenhuma.

Uso: BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... python3 tools/precos.py <pasta de saída>

O formato é o mesmo do Snapshot do app (src/Market.cs): preço mínimo, preço de "mercado" (média dos 15%
mais baratos), unidades e anúncios por item.
"""
import base64, datetime, gzip, json, math, os, sys, time, urllib.error, urllib.request
from email.utils import parsedate_to_datetime

NS = "dynamic-forever-us"
API = "https://us.api.blizzard.com"
RULESET = 2  # todas as rulesets listam as mesmas casas


def token():
    cid, sec = os.environ["BLIZZARD_CLIENT_ID"].strip(), os.environ["BLIZZARD_CLIENT_SECRET"].strip()
    req = urllib.request.Request("https://oauth.battle.net/token", data=b"grant_type=client_credentials",
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode(),
                                          "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]


def get(tok, path):
    """Returns (json, last_modified) with a few retries."""
    url = f"{API}{path}?namespace={NS}&locale=pt_BR"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                lm = r.headers.get("Last-Modified")
                return json.loads(body), (parsedate_to_datetime(lm) if lm else None)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, None
            if attempt == 3:
                raise
        except Exception:
            if attempt == 3:
                raise
        time.sleep(2 * (attempt + 1))


def snapshot(house, com, auc, lm):
    units = {}
    for a in (com or {}).get("auctions", []):
        units.setdefault(a["item"]["id"], []).append((a["unit_price"], a["quantity"]))
    for a in (auc or {}).get("auctions", []):
        if "buyout" not in a:
            continue  # só lance
        q = max(1, a.get("quantity", 1))
        units.setdefault(a["item"]["id"], []).append((a["buyout"] // q, q))
    prices = {}
    for item, lst in units.items():
        lst = [x for x in lst if x[0] > 0 and x[1] > 0]
        if not lst:
            continue
        lst.sort()
        total = sum(q for _, q in lst)
        take = max(1, math.ceil(total * 0.15))
        got = s = 0
        for u, q in lst:
            t = min(q, take - got)
            s += u * t
            got += t
            if got >= take:
                break
        prices[str(item)] = {"Min": lst[0][0], "Market": s // max(1, got), "Qty": total, "Listings": len(lst)}
    now = datetime.datetime.now(datetime.timezone.utc)
    return {"House": house, "LastModified": (lm or now).isoformat(), "Fetched": now.isoformat().replace("+00:00", "Z"),
            "Prices": prices}


def get_profile(tok, path):
    """Same as get() but in the character namespace."""
    url = f"{API}{path}?namespace=profile-forever-us&locale=pt_BR"
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                return json.loads(body)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code != 429 and e.code < 500:
                return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def professions(p):
    """{profession id: {"nivel", "max", "receitas": [recipe ids]}} from a /professions answer."""
    out = {}
    for group in ("primaries", "secondaries"):
        for pr in (p or {}).get(group, []):
            pid = pr["profession"]["id"]
            for t in pr.get("tiers", []):
                cur = out.setdefault(str(pid), {"nivel": 0, "max": 0, "receitas": []})
                cur["nivel"] = max(cur["nivel"], t.get("skill_points", 0))
                cur["max"] = max(cur["max"], t.get("max_skill_points", 0))
                cur["receitas"] += [r["id"] for r in t.get("known_recipes", [])]
    return out


def guild_characters(tok, guild):
    """Professions (level + known recipes) of every guild member from level 10 up."""
    from concurrent.futures import ThreadPoolExecutor
    roster = get_profile(tok, f"/data/wow/guild/{guild}/roster")
    if not roster:
        print(f"guilda {guild}: lista não encontrada", flush=True)
        return {}
    members = [m["character"] for m in roster.get("members", []) if m["character"].get("level", 0) >= 10]

    def one(c):
        return c, professions(get_profile(tok, f"/profile/wow/character/{c['slug']}/professions"))

    chars = {}
    with ThreadPoolExecutor(12) as ex:
        for c, profs in ex.map(one, members):
            if profs:
                chars[c["slug"]] = {"nome": f"{c['name']} {c.get('surname', '')}".strip(), "nivel": c.get("level", 0), "profissoes": profs}
    print(f"guilda {guild}: {len(members)} membros nível 10+, {len(chars)} com profissão", flush=True)
    return chars


def main(out):
    os.makedirs(out, exist_ok=True)
    tok = token()
    idx, _ = get(tok, f"/data/wow/ruleset/{RULESET}/auctions/")
    houses = [h["id"] for h in idx["auctions"]]
    resumo = []
    for h in houses:
        base = f"/data/wow/ruleset/{RULESET}/auctions/{h}"
        com, lm = get(tok, base + "/commodities")
        auc, _ = get(tok, base)
        snap = snapshot(h, com, auc, lm)
        with open(os.path.join(out, f"casa-{h}.json"), "w", encoding="utf-8") as f:
            json.dump(snap, f, separators=(",", ":"))
        resumo.append({"casa": h, "itens": len(snap["Prices"]), "atualizado": snap["LastModified"]})
        print(f"casa {h}: {len(snap['Prices'])} itens, Blizzard {snap['LastModified']}", flush=True)
    # Character sheets of the guild (profession level + known recipes), so friends without a key can
    # filter the Mercado by what their character can craft.
    guild = os.environ.get("GUILDA", "made-in-brazil")
    chars = guild_characters(tok, guild)
    with open(os.path.join(out, "personagens.json"), "w", encoding="utf-8") as f:
        json.dump({"gerado": datetime.datetime.now(datetime.timezone.utc).isoformat(), "guilda": guild, "personagens": chars},
                  f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out, "resumo.json"), "w", encoding="utf-8") as f:
        json.dump({"gerado": datetime.datetime.now(datetime.timezone.utc).isoformat(), "casas": resumo}, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
