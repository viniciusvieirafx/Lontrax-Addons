// Aba "Mercado": preços da Casa de Leilões (API da Blizzard) e lucro de cada receita.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });

  let st = {};          // ahState from the app
  let rows = [];        // every recipe of the chosen professions
  let sortKey = "lucro", sortDir = -1;
  let selected = null;  // recipe id shown on the right
  let started = false;
  let compareOpen = false;

  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };

  function toast(kind, text) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = text;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "erro" ? 9000 : 5000);
  }

  // ---------- money ----------
  function money(c, opts = {}) {
    if (c === null || c === undefined) return '<span class="flat">—</span>';
    const neg = c < 0; c = Math.abs(Math.round(c));
    const g = Math.floor(c / 10000), s = Math.floor(c / 100) % 100, k = c % 100;
    let h = "";
    if (g) h += `<span class="g">${g.toLocaleString("pt-BR")}</span>`;
    if (g || s) h += `<span class="s">${s}</span>`;
    if (!g || opts.full) h += `<span class="c">${k}</span>`;
    return `<span class="money${neg ? " neg" : ""}">${neg ? "−" : ""}${h}</span>`;
  }
  const pct = (m) => (m === null || m === undefined ? "—" : Math.round(m * 100) + "%");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  // ---------- tabs ----------
  function showTab(name) {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $("tab-addons").hidden = name !== "addons";
    $("tab-mercado").hidden = name !== "mercado";
    LS("lontrax.tab", name);
    if (name === "mercado" && !started) { started = true; send("ahInit"); }
  }
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------- state ----------
  function renderState() {
    $("ah-loading").hidden = true;
    $("ah-setup").hidden = !!st.hasKeys;
    $("ah-main").hidden = !st.hasKeys;
    if (!st.hasKeys) return;

    const sel = $("ah-house");
    const casas = st.casas || [];
    sel.innerHTML = "";
    if (st.casa == null) sel.add(new Option("Escolha a sua…", ""));
    const groups = {};
    casas.forEach((c) => { (groups[c.faccao] = groups[c.faccao] || []).push(c); });
    Object.entries(groups).forEach(([fac, list]) => {
      const og = document.createElement("optgroup");
      og.label = fac;
      list.forEach((c, i) => og.appendChild(new Option(`${fac} ${i + 1}  (casa ${c.id})`, c.id)));
      sel.appendChild(og);
    });
    sel.value = st.casa == null ? "" : String(st.casa);

    $("ah-status").innerHTML = st.atualizado
      ? `Preços da Blizzard de <b>${esc(st.atualizado)}</b> · checado às ${esc(st.checado)}`
      : st.casa == null ? "Escolha a sua Casa de Leilões." : "";

    const chips = $("ah-profs");
    chips.innerHTML = "";
    const chosen = new Set(st.escolhidas || []);
    const all = document.createElement("button");
    all.type = "button";
    all.className = "chip" + (chosen.size === 0 ? " on" : "");
    all.textContent = "Todas";
    all.addEventListener("click", () => setProfs([]));
    chips.appendChild(all);
    (st.profissoes || []).slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (chosen.has(p.id) ? " on" : "");
      b.innerHTML = `${esc(p.nome)}<span class="n">${p.receitas}</span>`;
      b.addEventListener("click", () => {
        const s = new Set(st.escolhidas || []);
        s.has(p.id) ? s.delete(p.id) : s.add(p.id);
        setProfs([...s]);
      });
      chips.appendChild(b);
    });
    if (document.activeElement !== $("ah-alert")) $("ah-alert").value = st.alerta || "";
  }

  function setProfs(ids) {
    st.escolhidas = ids;
    renderState();
    send("ahSetProfs", { ids });
  }

  // ---------- table ----------
  function trend(r) {
    if (r.ontem == null || r.vendaMercado == null || !r.ontem) return null;
    return (r.vendaMercado - r.ontem) / r.ontem;
  }

  function visibleRows() {
    const q = $("ah-search").value.trim().toLowerCase();
    const onlyComplete = $("ah-only-complete").checked;
    const onlyProfit = $("ah-only-profit").checked;
    const minQty = +$("ah-min-qty").value;
    const list = rows.filter((r) => {
      if (r.venda == null) return false; // nobody sells it: no price to compare
      if (onlyComplete && !r.completo) return false;
      if (onlyProfit && !(r.lucro > 0)) return false;
      if (r.aVenda < minQty) return false;
      if (q && !(r.nome.toLowerCase().includes(q) || r.materiais.some((m) => m.nome.toLowerCase().includes(q)))) return false;
      return true;
    });
    const val = (r) => (sortKey === "tendencia" ? trend(r) : r[sortKey]);
    list.sort((a, b) => {
      let x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string") return sortDir * x.localeCompare(y, "pt-BR");
      return sortDir * (x - y);
    });
    return list;
  }

  function renderRows() {
    const list = visibleRows();
    const body = $("ah-rows");
    body.innerHTML = "";
    const frag = document.createDocumentFragment();
    list.slice(0, 400).forEach((r) => {
      const tr = document.createElement("tr");
      if (r.receita === selected) tr.className = "sel";
      const t = trend(r);
      const tCls = t == null ? "flat" : t > 0.02 ? "up" : t < -0.02 ? "down" : "flat";
      const tTxt = t == null ? "—" : (t > 0 ? "▲ " : t < 0 ? "▼ " : "") + Math.abs(Math.round(t * 100)) + "%";
      const qtd = r.qtdFeita > 1 ? ` <span class="flat">x${r.qtdFeita}</span>` : "";
      tr.innerHTML =
        `<td class="item" title="${esc(r.nome)}">${esc(r.nome)}${qtd}</td>` +
        `<td class="prof">${esc(r.profissao)}</td>` +
        `<td class="num">${r.completo ? money(r.custo) : '<span class="neg">falta material</span>'}</td>` +
        `<td class="num">${money(r.venda)}</td>` +
        `<td class="num ${r.lucro > 0 ? "pos" : "neg"}">${money(r.lucro)}</td>` +
        `<td class="num">${pct(r.margem)}</td>` +
        `<td class="num">${r.aVenda}${r.aVenda < 3 ? '<span class="thin" title="Pouca gente vendendo: o preço pode enganar">pouco</span>' : ""}</td>` +
        `<td class="num ${tCls}">${tTxt}</td>`;
      tr.addEventListener("click", () => { selected = r.receita; renderRows(); renderDetail(); });
      frag.appendChild(tr);
    });
    body.appendChild(frag);
    const empty = $("ah-empty");
    if (!list.length) {
      empty.hidden = false;
      empty.textContent = st.casa == null ? "Escolha a sua Casa de Leilões lá em cima."
        : !rows.length ? "Carregando receitas e preços…"
        : "Nenhuma receita com esses filtros. Tente desmarcar \"Só com lucro\" ou baixar o mínimo à venda.";
    } else empty.hidden = true;
    document.querySelectorAll(".ah-table th").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === sortKey);
      th.classList.toggle("desc", th.dataset.sort === sortKey && sortDir < 0);
      th.classList.toggle("asc", th.dataset.sort === sortKey && sortDir > 0);
    });
  }

  document.querySelectorAll(".ah-table th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === "nome" || k === "profissao" ? 1 : -1; }
      renderRows();
    }));

  // ---------- detail ----------
  let history = { item: null, pontos: [] };

  function renderDetail() {
    const d = $("ah-detail");
    const r = rows.find((x) => x.receita === selected);
    if (!r) { d.hidden = true; return; }
    d.hidden = false;
    const fee = r.venda == null ? null : Math.round(r.venda * (st.taxa || 0.05));
    let h = `<h4>${esc(r.nome)}</h4><div class="sub">${esc(r.profissao)} · ${esc(r.categoria)}${r.qtdFeita > 1 ? ` · faz ${r.qtdFeita} por vez` : ""}</div>`;
    h += `<h5>Materiais</h5><table class="mats">`;
    r.materiais.forEach((m) => {
      const tag = m.fonte === "npc" ? '<span class="src npc">NPC</span>' : m.fonte === "ah" ? '<span class="src ah">AH</span>' : '<span class="src falta">SEM OFERTA</span>';
      h += `<tr><td>${m.qtd}x ${esc(m.nome)}${tag}</td><td>${m.preco == null ? "—" : money(m.preco * m.qtd)}</td></tr>`;
    });
    h += `</table>`;
    h += `<h5>Conta</h5><div class="kv">
      <span class="k">Custo dos materiais</span><span>${r.completo ? money(r.custo) : "incompleto"}</span>
      <span class="k">Vende por (mais barato na AH)</span><span>${money(r.venda)}</span>
      <span class="k">Preço de mercado</span><span>${money(r.vendaMercado)}</span>
      <span class="k">Taxa da AH (5%)</span><span>${money(fee == null ? null : -fee)}</span>
      <span class="k total">Lucro por craft</span><span class="total ${r.lucro > 0 ? "pos" : "neg"}">${money(r.lucro)}</span>
    </div>`;
    h += `<p class="note">${r.aVenda} à venda em ${r.anuncios} anúncio(s).${r.aVenda < 3 ? " Pouca oferta: o preço pode ser de uma pessoa só, venda com cuidado." : ""}</p>`;
    h += `<h5>Preço nos últimos dias</h5><div id="ah-chart">${chart(history.item === r.item ? history.pontos : null)}</div>`;
    h += `<p class="note">"Mercado" é a média dos 15% mais baratos (ignora um anúncio isolado muito barato). Materiais de NPC usam o preço do vendedor.</p>`;
    d.innerHTML = h;
    if (history.item !== r.item) send("ahHistory", { item: r.item });
  }

  function chart(pts) {
    if (pts == null) return '<p class="note">Carregando…</p>';
    if (pts.length < 2) return '<p class="note">O gráfico aparece depois de algumas horas com o app aberto (ele guarda um ponto por hora).</p>';
    const W = 320, H = 130, P = 6;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const X = (x) => P + ((x - x0) / Math.max(1, x1 - x0)) * (W - 2 * P);
    const Y = (y) => H - 18 - ((y - y0) / Math.max(1, y1 - y0)) * (H - 34);
    const line = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[2]).toFixed(1)).join(" ");
    const area = line + ` L${X(x1).toFixed(1)} ${H - 18} L${X(x0).toFixed(1)} ${H - 18} Z`;
    const day = (x) => { const d = new Date(x * 3600 * 1000); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.getHours() + "h"; };
    const fmt = (c) => (c >= 10000 ? (c / 10000).toFixed(1) + "g" : c >= 100 ? (c / 100).toFixed(0) + "s" : c + "c");
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line class="ax" x1="0" x2="${W}" y1="${H - 18}" y2="${H - 18}"/>
      <path class="ar" d="${area}"/><path class="ln" d="${line}"/>
      <text x="${P}" y="${H - 4}">${day(x0)}</text><text x="${W - P}" y="${H - 4}" text-anchor="end">${day(x1)}</text>
      <text x="${P}" y="11">${fmt(y1)}</text><text x="${P}" y="${H - 22}">${fmt(y0)}</text>
    </svg>`;
  }

  // ---------- compare houses ----------
  function renderCompare(m) {
    const casas = m.casas || [];
    if (!casas.length) { $("ah-compare-body").innerHTML = '<p class="note">Não consegui baixar os preços agora.</p>'; return; }
    const names = casas[0].itens.map((i) => i.nome);
    let h = `<table class="cmp"><thead><tr><th>Casa</th>${names.map((n) => `<th>${esc(n)}</th>`).join("")}<th>Anúncios</th><th></th></tr></thead><tbody>`;
    casas.forEach((c, i) => {
      h += `<tr class="${c.id === st.casa ? "mine" : ""}"><td>${esc(m.faction)} ${i + 1} (casa ${c.id})</td>` +
        c.itens.map((it) => `<td>${money(it.preco)}</td>`).join("") +
        `<td>${c.anuncios.toLocaleString("pt-BR")}</td>` +
        `<td><button class="btn ${c.id === st.casa ? "ghost" : "gold"} sm" data-id="${c.id}" type="button">${c.id === st.casa ? "É a minha" : "Usar esta"}</button></td></tr>`;
    });
    h += `</tbody></table><p class="note">Os preços mudam o tempo todo; compare o mais barato de cada item. Itens vazios: ninguém vendendo naquela casa.</p>`;
    $("ah-compare-body").innerHTML = h;
    $("ah-compare-body").querySelectorAll("button[data-id]").forEach((b) =>
      b.addEventListener("click", () => { pickHouse(+b.dataset.id); closeCompare(); }));
  }
  function openCompare() {
    compareOpen = true;
    $("ah-compare").hidden = false;
    $("ah-compare-body").innerHTML = '<p class="waiting"><span class="spinner"></span> Baixando os preços de cada casa… (leva uns 20 segundos)</p>';
    send("ahCompare", { faction: "Aliança" });
  }
  function closeCompare() { compareOpen = false; $("ah-compare").hidden = true; }

  function pickHouse(id) {
    st.casa = id;
    rows = [];
    selected = null;
    renderState(); renderRows(); renderDetail();
    send("ahSetHouse", { id });
  }

  // ---------- events ----------
  $("ah-open-bnet").addEventListener("click", () => send("openUrl", { url: "https://develop.battle.net/access/clients" }));
  $("ah-save-keys").addEventListener("click", () => {
    const id = $("ah-id").value.trim(), secret = $("ah-secret").value.trim();
    if (!id || !secret) return toast("erro", "Cole o Client ID e o Client Secret.");
    $("ah-save-keys").disabled = true;
    send("ahSaveKeys", { id, secret });
  });
  $("ah-house").addEventListener("change", (e) => { if (e.target.value) pickHouse(+e.target.value); });
  $("ah-which").addEventListener("click", openCompare);
  $("ah-compare-close").addEventListener("click", closeCompare);
  $("ah-refresh").addEventListener("click", () => send("ahRefresh"));
  ["ah-search", "ah-only-complete", "ah-only-profit", "ah-min-qty"].forEach((id) =>
    $(id).addEventListener(id === "ah-search" ? "input" : "change", () => {
      if (id !== "ah-search") LS("lontrax." + id, $(id).type === "checkbox" ? $(id).checked : $(id).value);
      renderRows();
    }));
  $("ah-alert").addEventListener("change", (e) => send("ahSetAlert", { gold: Math.max(0, parseInt(e.target.value || "0", 10) || 0) }));
  ["ah-only-complete", "ah-only-profit", "ah-min-qty"].forEach((id) => {
    const v = LS("lontrax." + id);
    if (v == null) return;
    if ($(id).type === "checkbox") $(id).checked = v === "true"; else $(id).value = v;
  });

  const PROG_TEXT = { receitas: "Baixando receitas (só na primeira vez)…", precos: "Baixando preços…", comparar: "Comparando casas…" };
  host && host.addEventListener("message", (ev) => {
    const m = ev.data;
    switch (m.type) {
      case "ahState": st = m; $("ah-save-keys").disabled = false; renderState(); if (!rows.length) renderRows(); break;
      case "ahRows": rows = m.rows || []; renderRows(); renderDetail(); break;
      case "ahHistory": history = { item: m.item, pontos: m.pontos || [] }; renderDetail(); break;
      case "ahCompare": if (compareOpen) renderCompare(m); break;
      case "ahProgress":
        // Before the first state arrives the main area is hidden: show the progress in the middle.
        if (!$("ah-loading").hidden) {
          $("ah-loading-text").textContent = PROG_TEXT[m.what] || "Trabalhando…";
          $("ah-loading-progress").hidden = false;
          $("ah-loading-progress").querySelector(".bar").style.width = Math.max(4, Math.round(m.value * 100)) + "%";
        }
        $("ah-progress").hidden = false;
        $("ah-progress").querySelector(".bar").style.width = Math.max(4, Math.round(m.value * 100)) + "%";
        $("ah-refresh").disabled = true;
        $("ah-status").textContent = PROG_TEXT[m.what] || "Trabalhando…";
        break;
      case "ahProgressEnd": $("ah-progress").hidden = true; $("ah-refresh").disabled = false; renderState(); break;
      case "ahError":
        if (!$("ah-loading").hidden) $("ah-loading-text").textContent = "Não deu para abrir o Mercado: " + m.text;
        $("ah-save-keys").disabled = false;
        toast("erro", m.text);
        if (compareOpen) $("ah-compare-body").innerHTML = `<p class="note">${esc(m.text)}</p>`;
        break;
      case "ahInfo": toast("ok", m.text); break;
    }
  });

  // Remember the last tab (Mercado opens straight away if you were there).
  showTab(LS("lontrax.tab") === "mercado" ? "mercado" : "addons");

  // ---------- preview in a normal browser (no app host): sample data ----------
  if (!host) {
    st = {
      hasKeys: true, casa: 110, taxa: 0.05, alerta: 5, atualizado: "10/11 23:22", checado: "23:40", escolhidas: [165],
      casas: [110, 111, 112, 119, 123].map((id) => ({ id, nome: "Casa de Leilões da Aliança", faccao: "Aliança" }))
        .concat([116, 117].map((id) => ({ id, nome: "Casa de Leilões de Aguanegra", faccao: "Aguanegra" }))),
      profissoes: [[197, "Alfaiataria", 410], [171, "Alquimia", 160], [185, "Culinária", 120], [165, "Couraria", 592], [333, "Encantamento", 290], [202, "Engenharia", 300], [164, "Ferraria", 410], [186, "Mineração", 22], [129, "Primeiros Socorros", 14]].map(([id, nome, receitas]) => ({ id, nome, receitas })),
    };
    const mk = (receita, nome, custo, venda, aVenda, ontem, mats) => ({
      receita, nome, profissao: "Couraria", categoria: "Braçadeiras", item: receita, qtdFeita: 1, custo, venda, vendaMercado: Math.round(venda * 1.08),
      lucro: Math.round(venda * 0.95) - custo, margem: (Math.round(venda * 0.95) - custo) / custo, aVenda, anuncios: aVenda, ontem, completo: true,
      materiais: mats || [{ id: 1, nome: "Couro Médio", qtd: 6, preco: 12000, fonte: "ah", aVenda: 300 }, { id: 2, nome: "Linha Fina", qtd: 2, preco: 100, fonte: "npc", aVenda: 0 }],
    });
    rows = [
      mk(1, "Braçadeiras de Camurça Azul", 15165, 105200, 5, 98000),
      mk(2, "Luvas de Camurça Azul", 13343, 80600, 5, 90000),
      mk(3, "Colete de Couro Silvestre", 10403, 200000, 1, null),
      mk(4, "Braçadeiras Barbarescas", 7025, 29600, 60, 29000),
      mk(5, "Perneiras Escorpídeas Resistentes", 19470, 44000, 6, 40000),
    ];
    showTab("mercado");
    renderState(); renderRows();
    selected = 1; renderDetail();
    history = { item: 1, pontos: Array.from({ length: 30 }, (_, i) => [489000 + i * 4, 0, 100000 + Math.round(Math.sin(i / 3) * 9000 + i * 300), 5]) };
    renderDetail();
    // Developer preview: market.js?real → loads ah-rows.json made by --selftest-market.
    fetch("ah-rows.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      rows = d.rows; st.profissoes = d.profissoes; st.escolhidas = [];
      selected = null; renderState(); renderRows(); renderDetail();
    }).catch(() => {});
  }
})();
