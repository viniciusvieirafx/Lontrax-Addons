// Aba Amigos: a lista de amigos do jogo (salva pelo addon Lontrax Amigos), com o boneco de cada um,
// nível, classe e quanto cada um upou nos últimos dias.
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

  // Cores de classe (as mesmas do jogo, só o tom)
  const CLASS_COLOR = {
    WARRIOR: "#c69b6d", PALADIN: "#f48cba", HUNTER: "#aad372", ROGUE: "#fff468", PRIEST: "#ffffff",
    DEATHKNIGHT: "#c41e3a", SHAMAN: "#0070dd", MAGE: "#3fc7eb", WARLOCK: "#8788ee", MONK: "#00ff98",
    DRUID: "#ff7c0a", DEMONHUNTER: "#a330c9", EVOKER: "#33937f",
  };

  let data = null;
  let open = false;
  let timer = null;
  let filter = LS("lontrax.fr.filter") || "todos";
  let sort = LS("lontrax.fr.sort") || "nivel";

  function ago(unix) {
    if (!unix) return "";
    const s = Math.max(0, Date.now() / 1000 - unix);
    if (s < 3600) return "agora há pouco";
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    const d = Math.floor(s / 86400);
    return d === 1 ? "ontem" : `há ${d} dias`;
  }

  function spark(hist, max) {
    if (!hist || hist.length < 2) return "";
    const w = 120, h = 26;
    const d0 = hist[0][0], d1 = hist[hist.length - 1][0];
    const lo = Math.max(1, Math.min(...hist.map((p) => p[1])) - 1);
    const hi = Math.max(lo + 1, Math.max(...hist.map((p) => p[1])));
    // por dia; se tudo foi no mesmo dia, um passo para cada subida
    const x = (p, i) => (d1 > d0 ? ((p[0] - d0) / (d1 - d0)) * w : (i / (hist.length - 1)) * w);
    let pts = hist.map((p, i) => [x(p, i), h - 2 - ((p[1] - lo) / (hi - lo)) * (h - 4)]);
    // degraus: o nível fica igual até o próximo ponto
    const path = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `H${p[0].toFixed(1)}V${p[1].toFixed(1)}`)).join("");
    return `<svg class="fr-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  function card(f, max) {
    const color = CLASS_COLOR[f.classeEn] || "#d9b45a";
    const pct = Math.min(100, Math.round((f.nivel / max) * 100));
    const initial = esc((f.nome || "?").charAt(0).toUpperCase());
    const lvlLine = [f.nivel ? `Nível ${f.nivel}` : "Nível ?", f.classe, f.raca].filter(Boolean).map(esc).join(" · ");
    let status;
    if (f.online) status = `<span class="fr-dot on"></span>Online${f.area ? " em " + esc(f.area) : ""}`;
    else {
      const seen = f.ultimoLogin || f.visto;
      status = `<span class="fr-dot"></span>Offline${seen ? " · visto " + ago(seen) : ""}${f.area ? " · " + esc(f.area) : ""}`;
    }
    const badges = [];
    if (f.nivel >= max) badges.push(`<span class="fr-badge max">Nível máximo!</span>`);
    else if (f.ganhou7 > 0) badges.push(`<span class="fr-badge up">▲ ${f.ganhou7} ${f.ganhou7 === 1 ? "nível" : "níveis"} na semana</span>`);
    else if (f.ganhou30 > 0) badges.push(`<span class="fr-badge up soft">▲ ${f.ganhou30} no mês</span>`);
    // clicar no selo mostra a conta Battle.net dona do personagem (clicar de novo volta)
    if (f.bnet) badges.push(`<button type="button" class="fr-badge bnet" data-conta="${esc(f.conta || "")}" title="Clique para ver a conta Battle.net">Battle.net</button>`);
    const extra = [];
    if (f.guilda) extra.push(`&lt;${esc(f.guilda)}&gt;`);
    if (f.ilvl) extra.push(`item nível ${f.ilvl}`);
    return `
      <article class="fr-card${f.online ? " online" : ""}" style="--cls:${color}">
        <div class="fr-pic">
          <div class="fr-initial">${initial}</div>
          ${f.boneco ? `<img class="fr-boneco" alt="" loading="lazy" src="${esc(f.boneco)}">` : ""}
          <div class="fr-lvl" title="Nível">${f.nivel || "?"}</div>
          <div class="fr-badges">${badges.join("")}</div>
        </div>
        <div class="fr-body">
          <h3 class="fr-name">${esc(f.nome)}${f.sobrenome ? ` <span>${esc(f.sobrenome)}</span>` : ""}</h3>
          <div class="fr-class">${lvlLine}</div>
          ${extra.length ? `<div class="fr-extra">${extra.join(" · ")}</div>` : ""}
          <div class="fr-bar" title="${f.nivel} de ${max}"><div style="width:${pct}%"></div></div>
          <div class="fr-status">${status}</div>
          ${spark(f.historico, max)}
          ${f.nota ? `<div class="fr-note">“${esc(f.nota)}”</div>` : ""}
        </div>
      </article>`;
  }

  function render() {
    if (!data) return;
    const grid = $("fr-grid"), empty = $("fr-empty"), sum = $("fr-summary");
    const max = data.maxNivel || 60;
    let list = (data.lista || []).slice();
    if (data.addon !== "ok" && !data.achou) {
      grid.innerHTML = "";
      sum.textContent = "Amigos";
      empty.hidden = false;
      empty.innerHTML = data.addon === "velho"
        ? `<b>Atualize o Lontrax Mercado.</b><br>Na aba <b>Addons</b>, clique em Atualizar no <b>Lontrax Mercado</b>, depois feche e abra o jogo.<br>A versão nova guarda a sua lista de amigos para aparecer aqui.`
        : `<b>Falta o addon Lontrax Mercado.</b><br>Instale ele na aba <b>Addons</b>, depois feche e abra o jogo.<br>É ele que guarda a sua lista de amigos para aparecer aqui.`;
      return;
    }
    if (!data.achou) {
      grid.innerHTML = "";
      sum.textContent = "Amigos";
      empty.hidden = false;
      empty.innerHTML = `<b>Quase lá!</b><br>Entre no jogo (se o jogo já estava aberto, feche e abra) e digite <code>/reload</code> uma vez.<br>Aí a sua lista de amigos aparece aqui.`;
      return;
    }
    if (list.length === 0) {
      grid.innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = `<b>Sua lista de amigos do jogo está vazia.</b><br>Adicione amigos no jogo (tecla O) e dê <code>/reload</code>.`;
      sum.textContent = "Amigos";
      return;
    }
    empty.hidden = true;
    const online = list.filter((f) => f.online).length;
    const up = list.filter((f) => f.ganhou7 > 0).length;
    sum.innerHTML = `<b>${list.length}</b> ${list.length === 1 ? "amigo" : "amigos"} · <b>${online}</b> online · <b>${up}</b> upando esta semana` +
      (data.atualizado ? `<span class="fr-when">lista do jogo de ${esc(data.atualizado)} (atualiza com /reload ou ao sair do jogo)</span>` : "");
    if (filter === "online") list = list.filter((f) => f.online);
    if (filter === "upando") list = list.filter((f) => f.ganhou7 > 0 || f.ganhou30 > 0);
    const byName = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");
    const sorts = {
      nivel: (a, b) => b.nivel - a.nivel || byName(a, b),
      upou: (a, b) => b.ganhou7 - a.ganhou7 || b.ganhou30 - a.ganhou30 || b.nivel - a.nivel,
      online: (a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || b.nivel - a.nivel,
      nome: byName,
    };
    list.sort(sorts[sort] || sorts.nivel);
    grid.innerHTML = list.length ? list.map((f) => card(f, max)).join("") :
      `<div class="fr-none">Ninguém aqui com esse filtro.</div>`;
    // boneco que não carregar (personagem novo ainda sem foto na Blizzard): fica a inicial
    grid.querySelectorAll(".fr-badge.bnet").forEach((b) => b.addEventListener("click", () => {
      const open = b.classList.toggle("open");
      const conta = b.dataset.conta;
      b.textContent = !open ? "Battle.net" : conta ? "Conta: " + conta : "Conta ainda não informada (dê /reload no jogo)";
    }));
    grid.querySelectorAll(".fr-boneco").forEach((img) => {
      const ok = () => img.closest(".fr-pic").classList.add("has-pic");
      if (img.complete && img.naturalWidth > 0) ok();
      img.addEventListener("load", ok);
      img.addEventListener("error", () => img.remove());
    });
  }

  function setFilter(f) {
    filter = f;
    LS("lontrax.fr.filter", f);
    document.querySelectorAll("#fr-filter button").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
    render();
  }
  document.querySelectorAll("#fr-filter button").forEach((b) => b.addEventListener("click", () => setFilter(b.dataset.f)));
  setFilter(filter);
  $("fr-sort").value = sort;
  $("fr-sort").addEventListener("change", (e) => { sort = e.target.value; LS("lontrax.fr.sort", sort); render(); });

  function onTab(name) {
    open = name === "amigos";
    clearInterval(timer);
    if (!open) return;
    send("amigos");
    timer = setInterval(() => { if (!document.hidden) send("amigos"); }, 60000);
  }
  document.addEventListener("lontrax-tab", (e) => onTab(e.detail));
  // o app pode abrir já nesta aba (lembra a última), antes deste arquivo carregar
  if (!$("tab-amigos").hidden) onTab("amigos");

  host && host.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.type !== "amigos") return;
    data = m;
    render();
  });

  // Prévia no navegador (sem o app): dados de exemplo
  if (!host) {
    data = {
      addon: "ok", achou: true, maxNivel: 60, atualizado: "17/11 21:40",
      lista: [
        { nome: "Miranajanela", sobrenome: "Lontrax", nivel: 33, classe: "Ladino", classeEn: "ROGUE", raca: "Elfo Noturno", area: "Floresta do Elwynn", online: true, ganhou7: 3, ganhou30: 8, guilda: "Made in Brazil", ilvl: 28, boneco: "https://render.worldofwarcraft.com/forever-us/character/219/5136859-main-raw.png", historico: [[20400, 25], [20402, 27], [20405, 30], [20407, 33]] },
        { nome: "Thorgrim", sobrenome: "Pedrabarba", nivel: 60, classe: "Guerreiro", classeEn: "WARRIOR", raca: "Anão", online: false, visto: Date.now() / 1000 - 86400 * 2, ganhou7: 0, ganhou30: 2, historico: [] },
        { nome: "Lunara", nivel: 18, classe: "Sacerdote", classeEn: "PRIEST", raca: "Humano", online: false, visto: Date.now() / 1000 - 3600 * 5, ganhou7: 0, ganhou30: 0, nota: "tank da quarta", bnet: true, historico: [] },
      ],
    };
    document.addEventListener("lontrax-tab", () => render());
    render();
  }
})();
