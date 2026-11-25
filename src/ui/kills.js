// Aba Kills: o que o addon Lontrax Dog Tags salvou no jogo. Uma aba por personagem seu, com o feed de kills,
// a coleção de dog tags (uma por inimigo morto) e os rivais (quem mais te matou).
// O formato dos dados é o contrato do PROMPT-DOGTAGS.md (pasta Insta addon).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const LS = (k, v) => {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  };
  const CLASS_COLOR = {
    WARRIOR: "#c69b6d", PALADIN: "#f48cba", HUNTER: "#aad372", ROGUE: "#fff468", PRIEST: "#ffffff",
    DEATHKNIGHT: "#c41e3a", SHAMAN: "#0070dd", MAGE: "#3fc7eb", WARLOCK: "#8788ee", MONK: "#00ff98",
    DRUID: "#ff7c0a", DEMONHUNTER: "#a330c9", EVOKER: "#33937f",
  };
  const RARITY = {
    comum: { n: 0, nome: "Comum" }, incomum: { n: 1, nome: "Incomum" }, rara: { n: 2, nome: "Rara" },
    epica: { n: 3, nome: "Épica" }, lendaria: { n: 4, nome: "Lendária" },
  };
  const TIPO = { kill: { ic: "⚔", txt: "matou" }, morte: { ic: "☠", txt: "foi morto por" } };
  const MULTI = { 2: "Double kill", 3: "Triple kill", 4: "Quadra kill", 5: "Penta kill" };
  const multiName = (n) => MULTI[Math.min(n, 5)] || "";

  let data = null;
  let timer = null;
  let charSel = LS("lontrax.kl.char") || "";
  let view = LS("lontrax.kl.view") || "feed";
  let sort = LS("lontrax.kl.sort") || "recente";
  let search = "";

  // tabelas vazias do Lua chegam como {} em vez de []
  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const fullName = (p) => [p.nome, p.sobrenome].filter(Boolean).join(" ");
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const color = (p) => CLASS_COLOR[p.classeEn] || "#d9b45a";
  const clsIcon = (p) => (CLASS_COLOR[p.classeEn] ? `<img class="kl-cls" alt="${esc(p.classe || "")}" title="${esc(p.classe || "")}" src="classe-${p.classeEn}.png">` : "");
  const rar = (t) => RARITY[norm(t.raridade)] ? norm(t.raridade) : "comum";

  function when(unix) {
    if (!unix) return "";
    const d = new Date(unix * 1000), now = new Date();
    const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const day = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
    if (day === 0) return "hoje " + hm;
    if (day === 1) return "ontem " + hm;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + hm;
  }
  const date = (unix) => (unix ? new Date(unix * 1000).toLocaleDateString("pt-BR") : "");

  function chars() {
    return arr(data && data.chars).slice().sort((a, b) => (b.atualizado || 0) - (a.atualizado || 0));
  }

  function renderChars(list, cur) {
    $("kl-chars").innerHTML = list.map((c) => {
      const tot = obj(c.totais);
      return `<button type="button" role="tab" class="kl-char${c.guid === cur.guid ? " on" : ""}" data-guid="${esc(c.guid)}" style="--cls:${color(c)}">
        ${clsIcon(c)}<span class="kl-char-name">${esc(fullName(c))}</span>
        <span class="kl-char-sub">nível ${esc(c.nivel ?? "?")} · ${tot.kills || 0} kills · ${Object.keys(obj(c.tags)).length} tags</span>
      </button>`;
    }).join("");
  }

  function renderStats(c) {
    const tot = obj(c.totais), tags = Object.values(obj(c.tags));
    const kd = (tot.mortes || 0) > 0 ? ((tot.kills || 0) / tot.mortes).toFixed(2).replace(".", ",") : (tot.kills ? "∞" : "0");
    const best = tags.reduce((m, t) => Math.max(m, RARITY[rar(t)].n), -1);
    const stat = (n, label, cls = "") => `<div class="kl-stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    $("kl-stats").innerHTML =
      stat(tot.kills || 0, "kills", "k") + stat(tot.mortes || 0, "mortes", "d") +
      stat(kd, "K/D") + stat(tags.length, tags.length === 1 ? "dog tag" : "dog tags", "t") +
      stat(tot.melhorSequencia || 0, "melhor sequência") +
      (c.melhorMulti >= 2 ? stat(multiName(c.melhorMulti).replace(" kill", ""), "melhor kill múltiplo", "m") : "") +
      (best >= 0 ? stat(Object.values(RARITY).find((r) => r.n === best).nome, "tag mais rara", "r r-" + Object.keys(RARITY)[best]) : "");
  }

  function feedHtml(c) {
    let feed = arr(c.feed).slice().reverse();
    if (search) feed = feed.filter((e) => norm(fullName(e)).includes(norm(search)));
    if (!feed.length) return none(search ? "Ninguém com esse nome no feed." : "Nenhuma kill ainda. Vá caçar!");
    return `<ol class="kl-feed">${feed.slice(0, 300).map((e) => {
      const t = TIPO[e.tipo] || TIPO.kill;
      return `<li class="kl-row ${esc(e.tipo || "kill")}" style="--cls:${color(e)}">
        <span class="kl-ic" title="${esc(t.txt)}">${t.ic}</span>
        <span class="kl-when-row">${esc(when(e.t))}</span>
        <span class="kl-verb">${esc(e.tipo === "morte" ? "Morto por" : "Matou")}</span>
        ${clsIcon(e)}
        <b class="kl-name">${esc(fullName(e))}${e.multi >= 2 ? ` <span class="kl-multi">${esc(multiName(e.multi))}</span>` : ""}</b>
        <span class="kl-meta">${[e.nivel ? "nível " + e.nivel : "", e.raca, e.faccao === "Horde" ? "Horda" : e.faccao === "Alliance" ? "Aliança" : ""].filter(Boolean).map(esc).join(" · ")}</span>
        <span class="kl-where">${esc([e.subzona, e.zona].filter(Boolean).join(", "))}${e.habilidade ? ` · <i>${esc(e.habilidade)}</i>` : ""}</span>
      </li>`;
    }).join("")}</ol>`;
  }

  function tagsHtml(c) {
    let tags = Object.entries(obj(c.tags)).map(([guid, t]) => ({ guid, ...t }));
    if (search) tags = tags.filter((t) => norm(fullName(t)).includes(norm(search)));
    const by = {
      recente: (a, b) => (b.ultima || 0) - (a.ultima || 0),
      kills: (a, b) => (b.kills || 0) - (a.kills || 0) || (b.ultima || 0) - (a.ultima || 0),
      raridade: (a, b) => RARITY[rar(b)].n - RARITY[rar(a)].n || (b.kills || 0) - (a.kills || 0),
      nome: (a, b) => fullName(a).localeCompare(fullName(b), "pt-BR"),
    };
    tags.sort(by[sort] || by.recente);
    if (!tags.length) return none(search ? "Nenhuma dog tag com esse nome." : "Sua coleção está vazia. Cada inimigo que você matar vira uma dog tag aqui.");
    return `<div class="kl-tags">${tags.map((t) => {
      const r = rar(t);
      return `<div class="kl-tag r-${r}" style="--cls:${color(t)}" title="${esc(RARITY[r].nome)}">
        <span class="kl-hole"></span>
        <div class="kl-tag-top">${clsIcon(t)}<span class="kl-rar">${esc(RARITY[r].nome)}</span></div>
        <div class="kl-tag-name">${esc(t.nome || "?")}</div>
        <div class="kl-tag-sur">${esc(t.sobrenome || "")}</div>
        <div class="kl-tag-info">${[t.nivel ? "Nv " + t.nivel : "", t.raca, t.classe].filter(Boolean).map(esc).join(" · ")}</div>
        <div class="kl-tag-count"><span title="kills">⚔ ${t.kills || 0}</span>${t.mortes ? `<span class="d" title="vezes que ele te matou">☠ ${t.mortes}</span>` : ""}</div>
        <div class="kl-tag-foot">${esc(date(t.primeira))}${t.zona ? " · " + esc(t.zona) : ""}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function rivaisHtml(c) {
    // quem mais te matou e quem você mais matou, juntando o feed com a coleção
    const map = new Map();
    const get = (p) => {
      const k = norm(fullName(p));
      if (!map.has(k)) map.set(k, { ...p, k: 0, m: 0 });
      return map.get(k);
    };
    Object.values(obj(c.tags)).forEach((t) => { const r = get(t); r.k = t.kills || 0; r.m = Math.max(r.m, t.mortes || 0); });
    const fromFeed = new Map();
    arr(c.feed).forEach((e) => { if (e.tipo === "morte") { const k = norm(fullName(e)); fromFeed.set(k, (fromFeed.get(k) || 0) + 1); get(e); } });
    fromFeed.forEach((n, k) => { const r = map.get(k); r.m = Math.max(r.m, n); });
    let list = [...map.values()].filter((r) => r.m > 0);
    if (search) list = list.filter((r) => norm(fullName(r)).includes(norm(search)));
    list.sort((a, b) => b.m - a.m || b.k - a.k);
    if (!list.length) return none("Ninguém te matou ainda. Por enquanto, você é o pesadelo deles.");
    return `<ol class="kl-rivals">${list.slice(0, 50).map((r, i) => `
      <li style="--cls:${color(r)}"><span class="kl-pos">${i + 1}</span>${clsIcon(r)}<b class="kl-name">${esc(fullName(r))}</b>
        <span class="kl-score"><span class="d">☠ te matou ${r.m}×</span><span>⚔ você matou ${r.k}×</span></span></li>`).join("")}</ol>`;
  }

  // O addon (1.5.0+) não tem mais assistência: era kill. Save antigo ainda pode trazer "assist" até o jogo abrir.
  function semAssist(d) {
    arr(d && d.chars).forEach((c) => {
      arr(c.feed).forEach((e) => { if (e.tipo === "assist") e.tipo = "kill"; });
      Object.values(obj(c.tags)).forEach((t) => { t.kills = (t.kills || 0) + (t.assists || 0); t.assists = 0; });
      const tot = obj(c.totais);
      tot.kills = (tot.kills || 0) + (tot.assists || 0); tot.assists = 0;
    });
    return d;
  }

  const none = (msg) => `<div class="fr-none">${msg}</div>`;

  function render() {
    if (!data) return;
    const empty = $("kl-empty"), body = $("kl-body");
    const list = chars();
    if (!list.length) {
      $("kl-chars").innerHTML = ""; $("kl-stats").innerHTML = ""; body.innerHTML = ""; $("kl-when").textContent = "";
      empty.hidden = false;
      empty.innerHTML = data.addon !== "ok"
        ? `<b>Falta o addon Lontrax Dog Tags.</b><br>Instale ele na aba <b>Addons</b>, depois feche e abra o jogo.<br>Cada inimigo que você matar vira uma dog tag na sua coleção.`
        : `<b>Quase lá!</b><br>Entre no jogo e digite <code>/reload</code> uma vez (ou saia do jogo).<br>Aí as suas kills aparecem aqui.`;
      return;
    }
    empty.hidden = true;
    const cur = list.find((c) => c.guid === charSel) || list[0];
    renderChars(list, cur);
    renderStats(cur);
    $("kl-sort").hidden = view !== "tags";
    body.innerHTML = view === "tags" ? tagsHtml(cur) : view === "rivais" ? rivaisHtml(cur) : feedHtml(cur);
    $("kl-when").textContent = data.atualizado ? `Dados do jogo de ${data.atualizado} (atualiza com /reload ou ao sair do jogo)` : "";
  }

  $("kl-chars").addEventListener("click", (e) => {
    const b = e.target.closest(".kl-char");
    if (!b) return;
    charSel = b.dataset.guid;
    LS("lontrax.kl.char", charSel);
    render();
  });
  function setView(v) {
    view = v;
    LS("lontrax.kl.view", v);
    document.querySelectorAll("#kl-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    render();
  }
  document.querySelectorAll("#kl-view button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.v)));
  setView(view);
  $("kl-sort").value = sort;
  $("kl-sort").addEventListener("change", (e) => { sort = e.target.value; LS("lontrax.kl.sort", sort); render(); });
  $("kl-search").addEventListener("input", (e) => { search = e.target.value.trim(); render(); });

  function onTab(name) {
    clearInterval(timer);
    if (name !== "kills") return;
    send("kills");
    timer = setInterval(() => { if (!document.hidden) send("kills"); }, 60000);
  }
  document.addEventListener("lontrax-tab", (e) => onTab(e.detail));
  if (!$("tab-kills").hidden) onTab("kills");

  host && host.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.type !== "kills") return;
    data = semAssist(m);
    render();
  });

  // Prévia no navegador (sem o app): dados de exemplo no formato do addon
  if (!host) {
    const now = Math.floor(Date.now() / 1000);
    const foe = (nome, sobrenome, classe, classeEn, raca, nivel) => ({ nome, sobrenome, classe, classeEn, raca, faccao: "Horde", nivel });
    const g = foe("Grommash", "Ferrolho", "Guerreiro", "WARRIOR", "Orc", 34);
    const z = foe("Zul'jin", "Presaverde", "Caçador", "HUNTER", "Troll", 31);
    const v = foe("Vexa", "Sombraluz", "Bruxo", "WARLOCK", "Morta-viva", 36);
    const k = foe("Krag", "Pedramarga", "Xamã", "SHAMAN", "Tauren", 29);
    data = {
      addon: "ok", achou: true, atualizado: "24/11 21:40",
      chars: [
        {
          guid: "Player-1-A", nome: "Miranajanela", sobrenome: "Lontrax", classe: "Ladino", classeEn: "ROGUE", raca: "Elfo Noturno", faccao: "Alliance", nivel: 33, atualizado: now - 600,
          totais: { kills: 9, assists: 0, mortes: 3, melhorSequencia: 4 }, melhorMulti: 2,
          feed: [
            { t: now - 86400 * 3, tipo: "kill", ...k, zona: "Serra Alterac", habilidade: "Eviscerar" },
            { t: now - 86400 * 2, tipo: "morte", ...v, zona: "Vale Gurubashi", subzona: "Arena Gurubashi", habilidade: "Seta Sombria" },
            { t: now - 86400, tipo: "kill", ...g, zona: "Vale Gurubashi", habilidade: "Golpe Baixo" },
            { t: now - 7200, tipo: "kill", ...z, zona: "Vale Gurubashi" },
            { t: now - 7170, tipo: "kill", ...v, zona: "Vale Gurubashi", subzona: "Arena Gurubashi", habilidade: "Eviscerar", multi: 2 },
            { t: now - 1800, tipo: "morte", ...v, zona: "Vale Gurubashi", habilidade: "Corrupção" },
            { t: now - 900, tipo: "kill", ...g, zona: "Montanhas de Arathi", habilidade: "Apunhalar" },
          ],
          tags: {
            "Player-1-G": { ...g, kills: 2, assists: 0, mortes: 0, primeira: now - 86400, ultima: now - 900, zona: "Vale Gurubashi", raridade: "incomum" },
            "Player-1-Z": { ...z, kills: 1, assists: 0, mortes: 0, primeira: now - 7200, ultima: now - 7200, zona: "Vale Gurubashi", raridade: "comum" },
            "Player-1-V": { ...v, kills: 1, assists: 0, mortes: 2, primeira: now - 3600, ultima: now - 3600, zona: "Vale Gurubashi", raridade: "epica" },
            "Player-1-K": { ...k, kills: 1, assists: 0, mortes: 0, primeira: now - 86400 * 3, ultima: now - 86400 * 3, zona: "Serra Alterac", raridade: "lendaria" },
          },
        },
        { guid: "Player-1-B", nome: "Brasa", sobrenome: "Lontrax", classe: "Mago", classeEn: "MAGE", raca: "Humano", faccao: "Alliance", nivel: 12, atualizado: now - 86400 * 5, totais: { kills: 0, assists: 0, mortes: 0, melhorSequencia: 0 }, feed: {}, tags: {} },
      ],
    };
    document.addEventListener("lontrax-tab", () => render());
    render();
  }
})();
