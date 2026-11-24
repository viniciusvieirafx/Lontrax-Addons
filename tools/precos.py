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


def list_characters(tok, path):
    """Professions (level + known recipes) of the characters in the owner's in-game friends list.
    The owner's app sends that list to the "amigos" branch (src/FriendsList.cs); the workflow passes it here."""
    from concurrent.futures import ThreadPoolExecutor
    try:
        names = json.load(open(path, encoding="utf-8")).get("personagens", {})
    except Exception as e:
        print(f"lista de amigos: não li ({e})", flush=True)
        return {}

    def one(slug):
        return slug, professions(get_profile(tok, f"/profile/wow/character/{slug}/professions"))

    chars = {}
    with ThreadPoolExecutor(12) as ex:
        for slug, profs in ex.map(one, names):
            if profs:
                chars[slug] = {"nome": names[slug], "profissoes": profs}
    print(f"lista de amigos: {len(names)} personagens, {len(chars)} com profissão", flush=True)
    return chars


HIST_STEP_H = 3      # one point every 3 hours
HIST_DAYS = 14


def recipe_items():
    """Item ids used by the recipes shipped with the app (crafted items + reagents): only these get history."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "data", "receitas.json")
    try:
        book = json.load(open(path, encoding="utf-8"))
    except Exception:
        return None
    ids = set()
    for p in book.get("Professions", []):
        for r in p.get("Recipes", []):
            ids.add(r["Item"])
            ids.update(g["Id"] for g in r.get("Reagents", []))
    return ids


def history(prev_dir, house, snap, items):
    """Same format as the app's History: {"Items": {id: [[unix hour, min, market, qty], ...]}}.
    Keeps the previous file (from the "precos" branch) and adds this snapshot's point."""
    h = {"Items": {}}
    if prev_dir:
        try:
            h = json.load(open(os.path.join(prev_dir, f"historico-{house}.json"), encoding="utf-8"))
        except Exception:
            pass
    lm = datetime.datetime.fromisoformat(snap["LastModified"])
    hour = int(lm.timestamp() // 3600)
    slot = hour - hour % HIST_STEP_H
    keep = hour - HIST_DAYS * 24
    for item, p in snap["Prices"].items():
        if items is not None and int(item) not in items:
            continue
        lst = h["Items"].setdefault(item, [])
        point = [slot, p["Min"], p["Market"], p["Qty"]]
        if lst and lst[-1][0] == slot:
            lst[-1] = point
        else:
            lst.append(point)
    for item in list(h["Items"]):
        lst = [x for x in h["Items"][item] if x[0] >= keep]
        if lst:
            h["Items"][item] = lst
        else:
            del h["Items"][item]
    return h


def main(out, prev_dir=None):
    os.makedirs(out, exist_ok=True)
    items = recipe_items()
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
        if snap["Prices"]:
            with open(os.path.join(out, f"historico-{h}.json"), "w", encoding="utf-8") as f:
                json.dump(history(prev_dir, h, snap, items), f, separators=(",", ":"))
        resumo.append({"casa": h, "itens": len(snap["Prices"]), "atualizado": snap["LastModified"]})
        print(f"casa {h}: {len(snap['Prices'])} itens, Blizzard {snap['LastModified']}", flush=True)
    # Character sheets (profession level + known recipes) of the owner's friends list, so friends without a
    # key can filter the Mercado by what their character can craft.
    chars = list_characters(tok, os.environ.get("AMIGOS", ""))
    with open(os.path.join(out, "personagens.json"), "w", encoding="utf-8") as f:
        json.dump({"gerado": datetime.datetime.now(datetime.timezone.utc).isoformat(), "lista": "amigos", "personagens": chars},
                  f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out, "resumo.json"), "w", encoding="utf-8") as f:
        json.dump({"gerado": datetime.datetime.now(datetime.timezone.utc).isoformat(), "casas": resumo}, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out", sys.argv[2] if len(sys.argv) > 2 else None)
