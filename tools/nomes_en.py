"""Gera src/data/nomes-en.json: nomes em inglês das receitas, itens, materiais, profissões e categorias,
para o botão PT | EN do Mercado. Rodar quando as receitas mudarem (junto com src/data/receitas.json).

Uso: BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... python3 tools/nomes_en.py
"""
import base64, json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
NS = "static-forever-us"


def token():
    cid, sec = os.environ["BLIZZARD_CLIENT_ID"].strip(), os.environ["BLIZZARD_CLIENT_SECRET"].strip()
    req = urllib.request.Request("https://oauth.battle.net/token", data=b"grant_type=client_credentials",
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode(),
                                          "Content-Type": "application/x-www-form-urlencoded"})
    return json.load(urllib.request.urlopen(req, timeout=30))["access_token"]


TOK = token()


def get(path):
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"https://us.api.blizzard.com{path}?namespace={NS}&locale=en_US",
                                         headers={"Authorization": "Bearer " + TOK})
            return json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


book = json.load(open(os.path.join(ROOT, "src", "data", "receitas.json"), encoding="utf-8"))
out = {"profissoes": {}, "categorias": {}, "receitas": {}, "itens": {}}

for p in book["Professions"]:
    d = get(f"/data/wow/profession/{p['Id']}")
    if d:
        out["profissoes"][str(p["Id"])] = d.get("name", "")
        for t in d.get("skill_tiers", []):
            td = get(f"/data/wow/profession/{p['Id']}/skill-tier/{t['id']}")
            # Categories come in the same order in both languages: map by recipe id to be safe.
            for c in (td or {}).get("categories", []):
                for r in c.get("recipes", []):
                    out["categorias"][str(r["id"])] = c.get("name", "")

ids = [r["Id"] for p in book["Professions"] for r in p["Recipes"]]


def one(rid):
    return rid, get(f"/data/wow/recipe/{rid}")


done = 0
with ThreadPoolExecutor(16) as ex:
    for rid, d in ex.map(one, ids):
        done += 1
        if not d:
            continue
        out["receitas"][str(rid)] = d.get("name", "")
        ci = d.get("crafted_item")
        if ci:
            out["itens"][str(ci["id"])] = ci.get("name", "")
        for g in d.get("reagents", []):
            out["itens"][str(g["reagent"]["id"])] = g["reagent"].get("name", "")

path = os.path.join(ROOT, "src", "data", "nomes-en.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(out['profissoes'])} profissões, {len(out['receitas'])} receitas, {len(out['itens'])} itens -> {path} ({os.path.getsize(path)} bytes)")
