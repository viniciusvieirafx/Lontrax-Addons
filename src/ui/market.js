// Aba "Mercado": preços da Casa de Leilões (API da Blizzard) e lucro de cada receita.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });

  let st = {};          // ahState from the app
  let known = null;     // Set of recipe ids the chosen character knows
  let charsAsked = false;
  let craftQty = 1;     // "Para fazer N×" in the detail panel

  // ---------- PT | EN item names ----------
  let EN = null;        // {profissoes, categorias, receitas, itens} from src/data/nomes-en.json
  let lang = null;
  const nameEn = (r) => EN && (EN.itens[r.item] || EN.receitas[r.receita]);
  const tName = (r) => (lang === "en" && nameEn(r)) || r.nome;
  const tMat = (m) => (lang === "en" && EN && EN.itens[m.id]) || m.nome;
  const tCat = (r) => (lang === "en" && EN && EN.categorias[r.receita]) || r.categoria;
  const tProfId = (id, pt) => (lang === "en" && EN && EN.profissoes[id]) || pt;
  const tProf = (pt) => {
    if (lang !== "en" || !EN) return pt;
    const p = (st.profissoes || []).find((x) => x.nome === pt);
    return (p && EN.profissoes[p.id]) || pt;
  };
  let rawRows = [];     // rows exactly as the app computed them
  let rows = [];        // every recipe of the chosen professions (after the "ignore material cost" toggle)
  // "Ignorar custo do material": materials count as free (already farmed), so profit = sale − AH cut.
  const noCost = () => $("ah-no-cost").checked;
  function deriveRows() {
    if (!noCost()) { rows = rawRows; return; }
    const cut = 1 - (st.taxa || 0.05);
    rows = rawRows.map((r) => ({ ...r, custo: 0, completo: true, margem: null, lucro: r.venda == null ? null : Math.round(r.venda * cut) }));
  }
  const setRows = (list) => { rawRows = list || []; deriveRows(); };
  let sortKey = "lucro", sortDir = -1;
  let selected = null;  // recipe id shown on the right
  let started = false;
  let compareOpen = false;
  let lastCompare = null;

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

    const fonte = st.chavePropria ? "sua chave" : "preços da galera";
    $("ah-status").innerHTML = (st.atualizado
      ? `Preços de <b>${esc(st.atualizado)}</b> · ${fonte}`
      : st.casa == null ? "Escolha a sua Casa de Leilões." : "") +
      ` · <button class="link small" id="ah-key-toggle" type="button">${st.chavePropria ? "usar preços da galera" : "usar minha chave"}</button>`;
    $("ah-key-toggle").addEventListener("click", () => {
      if (st.chavePropria) { if (confirm("Parar de usar a sua chave da Blizzard e usar os preços da galera?")) send("ahForgetKeys"); }
      else { $("ah-main").hidden = true; $("ah-setup").hidden = false; $("ah-setup-back").hidden = false; }
    });

    // Character: level per profession and the recipes it knows.
    const pj = st.personagem;
    if (document.activeElement !== $("ah-char")) $("ah-char").value = pj ? pj.nome : "";
    const levels = {};
    (pj ? pj.profissoes : []).forEach((p) => (levels[p.id] = p));
    $("ah-charinfo").innerHTML = pj
      ? pj.profissoes.filter((p) => p.max > 0).map((p) => `<span class="lvl">${esc(tProfId(p.id, p.nome))} <b>${p.nivel}</b>/${p.max}</span>`).join("") +
        `<span class="flat" title="A Blizzard atualiza a ficha quando você desloga">· ficha de ${esc(pj.lido)}</span>`
      : "Escolha seu personagem para ver só o que você sabe fazer.";
    known = pj ? new Set(pj.conhecidas || []) : null;
    $("ah-only-known").checked = !!pj && st.soConhecidas !== false;
    $("ah-only-known").disabled = !pj;
    $("ah-only-known-wrap").classList.toggle("disabled", !pj);

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
      b.innerHTML = `${esc(tProfId(p.id, p.nome))}` + (levels[p.id] ? `<span class="lv" title="Seu nível">${levels[p.id].nivel}</span>` : `<span class="n">${p.receitas}</span>`);
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
    const onlyKnown = known && $("ah-only-known").checked;
    const list = rows.filter((r) => {
      if (onlyKnown && !known.has(r.receita)) return false;
      if (r.venda == null) return false; // nobody sells it: no price to compare
      if (onlyComplete && !r.completo) return false;
      if (onlyProfit && !(r.lucro > 0)) return false;
      if (r.aVenda < minQty) return false;
      if (q && !([r.nome, nameEn(r)].some((x) => x && x.toLowerCase().includes(q)) ||
        r.materiais.some((m) => [m.nome, EN && EN.itens[m.id]].some((x) => x && x.toLowerCase().includes(q))))) return false;
      return true;
    });
    const val = (r) => (sortKey === "tendencia" ? trend(r) : sortKey === "nome" ? tName(r) : sortKey === "profissao" ? tProf(r.profissao) : r[sortKey]);
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

  // ---------- "Melhor do dia": one gold medal per player ----------
  // Not just the biggest profit: what will really SELL today. Score = profit per craft
  // × little competition (few on sale) × selling (stock went down in the last 24 h) × price not falling.
  const sold24 = (r) => (r.estoquePico && r.estoquePico > r.aVenda ? (r.estoquePico - r.aVenda) / r.estoquePico : 0);
  function bestScore(r) {
    if (!(r.lucro > 0) || !r.completo || r.aVenda < 3) return 0; // < 3 on sale: the price can't be trusted
    const competition = 1 / (1 + r.aVenda / 50);
    const selling = 0.5 + sold24(r);
    const t = trend(r);
    const price = t == null ? 1 : t < -0.15 ? 0.6 : t < -0.05 ? 0.85 : t > 0.05 ? 1.1 : 1;
    return r.lucro * competition * selling * price;
  }
  function pickBest(list) {
    let best = null, bs = 0;
    for (const r of list) { const s = bestScore(r); if (s > bs) { bs = s; best = r; } }
    return best;
  }
  function renderBest(best) {
    const box = $("ah-best");
    if (!best) { box.hidden = true; return; }
    const why = [];
    why.push(`dá <b>${money(best.lucro)}</b> por craft`);
    why.push(best.aVenda <= 60 ? `pouca concorrência (<b>${best.aVenda}</b> à venda)` : `${best.aVenda} à venda`);
    const s = sold24(best);
    if (s >= 0.15) why.push(`está vendendo: o estoque caiu <b>${Math.round(s * 100)}%</b> em 24 h`);
    const t = trend(best);
    if (t != null && t > 0.05) why.push(`preço subindo (▲ ${Math.round(t * 100)}%)`);
    const pj = st.personagem;
    box.innerHTML = `<span class="medal big" aria-hidden="true"><span>1</span></span>
      <div class="best-txt"><div class="best-k">Melhor do dia${pj ? " para " + esc(pj.nome.split(" ")[0]) : ""}</div>
      <div class="best-n">${esc(tName(best))} <span class="flat">· ${esc(tProf(best.profissao))}</span></div>
      <div class="best-why">${why.join(" · ")}</div></div>
      <button class="best-go" type="button">Ver receita</button>`;
    box.querySelector(".best-go").addEventListener("click", () => { selected = best.receita; renderRows(); renderDetail(); });
    box.hidden = false;
  }

  function renderRows() {
    const list = visibleRows();
    const best = pickBest(list);
    renderBest(best);
    const body = $("ah-rows");
    body.innerHTML = "";
    const frag = document.createDocumentFragment();
    // Top 3 among what the filters show: most gold per craft, and best margin (needs a real cost).
    const top3 = (key) => new Map(list.filter((r) => r[key] != null && r[key] > 0)
      .sort((a, b) => b[key] - a[key]).slice(0, 3).map((r, i) => [r.receita, i + 1]));
    const topL = top3("lucro"), topM = noCost() ? new Map() : top3("margem");
    list.slice(0, 400).forEach((r) => {
      const tr = document.createElement("tr");
      const l = topL.get(r.receita), mg = topM.get(r.receita);
      const isBest = best && r.receita === best.receita;
      tr.className = [r.receita === selected && "sel", isBest && "best", l && "top-lucro", mg && "top-margem", (l === 1 || (!l && mg === 1)) && "r1"].filter(Boolean).join(" ");
      const tags = (isBest ? `<span class="medal" title="Melhor do dia: lucro, pouca concorrência e vendendo bem"><span>1</span></span>` : "") + (l ?`<span class="top-tag lucro" title="${l}º que mais dá ouro">${l}º lucro</span>` : "") +
        (mg ? `<span class="top-tag margem" title="${mg}º melhor margem (lucro ÷ custo)">${mg}º margem</span>` : "");
      const t = trend(r);
      const tCls = t == null ? "flat" : t > 0.02 ? "up" : t < -0.02 ? "down" : "flat";
      const tTxt = t == null ? "—" : (t > 0 ? "▲ " : t < 0 ? "▼ " : "") + Math.abs(Math.round(t * 100)) + "%";
      const qtd = r.qtdFeita > 1 ? ` <span class="flat">x${r.qtdFeita}</span>` : "";
      tr.innerHTML =
        `<td class="item" title="${esc(tName(r))}">${tags}${esc(tName(r))}${qtd}</td>` +
        `<td class="prof">${esc(tProf(r.profissao))}</td>` +
        `<td class="num">${noCost() ? '<span class="flat">ignorado</span>' : r.completo ? money(r.custo) : '<span class="neg">falta material</span>'}</td>` +
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
        : known && $("ah-only-known").checked
          ? "Nenhuma receita que seu personagem sabe passa nesses filtros. Tente desmarcar \"Só com lucro\", baixar o mínimo à venda, ou desmarcar \"Só o que meu personagem sabe fazer\" para ver o que vale a pena aprender."
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
    let h = `<button class="ah-close" id="ah-close" type="button" title="Fechar">×</button><h4>${esc(tName(r))}</h4><div class="sub">${esc(tProf(r.profissao))} · ${esc(tCat(r))}${r.qtdFeita > 1 ? ` · faz ${r.qtdFeita} por vez` : ""}</div>`;
    // "To craft N× item you need": the shopping list, multiplied by how many you want to craft.
    const n = craftQty;
    const sabe = known ? (known.has(r.receita) ? '<span class="know yes">✓ Você já sabe essa receita</span>' : '<span class="know no">Você ainda não aprendeu essa receita</span>') : "";
    // Plain sentence: "Para fazer 5 X você precisa de 50 A, 5 B e 5 C."
    const parts = r.materiais.map((m) => `<b>${m.qtd * n} ${esc(tMat(m))}</b>`);
    const joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " e " + parts[parts.length - 1] : parts.join("");
    const made = n * r.qtdFeita;
    h += `<div class="need">
      <p class="need-s">Para fazer <b>${made} ${esc(tName(r))}</b> você precisa de ${joined}.</p>
      <div class="need-h">Quantas vezes craftar: <input type="number" id="ah-qty" class="ah-qty" min="1" max="999" value="${n}"></div>
      <ul class="need-list">`;
    r.materiais.forEach((m) => {
      const where = m.fonte === "npc" ? '<span class="src npc">NPC</span>' : m.fonte === "ah" ? '<span class="src ah">AH</span>' : '<span class="src falta">SEM OFERTA</span>';
      const each = m.preco == null ? "" : ` <span class="flat">(${money(m.preco)} cada${m.fonte === "ah" ? ` · ${m.aVenda} à venda` : ""})</span>`;
      const short = m.fonte === "ah" && m.aVenda < m.qtd * n ? ' <span class="thin">não tem tudo na AH</span>' : "";
      h += `<li><b class="q">${m.qtd * n}×</b> ${esc(tMat(m))} ${where}${each}${short}<span class="tot">${m.preco == null ? "—" : money(m.preco * m.qtd * n)}</span></li>`;
    });
    h += `</ul>
      <div class="need-f"><span>Total dos materiais</span><b>${noCost() ? '<span class="flat">ignorado</span>' : r.completo ? money(r.custo * n) : "incompleto"}</b></div>
      ${r.lucro != null ? `<div class="need-f"><span>Lucro vendendo ${n * r.qtdFeita}</span><b class="${r.lucro > 0 ? "pos" : "neg"}">${money(r.lucro * n)}</b></div>` : ""}
      ${sabe ? `<div class="need-a">${sabe}</div>` : ""}
    </div>`;
    h += `<h5>Conta</h5><div class="kv">
      <span class="k">Custo dos materiais</span><span>${noCost() ? '<span class="flat">ignorado (já tenho)</span>' : r.completo ? money(r.custo) : "incompleto"}</span>
      <span class="k">Vende por (mais barato na AH)</span><span>${money(r.venda)}</span>
      <span class="k">Preço de mercado</span><span>${money(r.vendaMercado)}</span>
      <span class="k">Taxa da AH (5%)</span><span>${money(fee == null ? null : -fee)}</span>
      <span class="k total">Lucro por craft</span><span class="total ${r.lucro > 0 ? "pos" : "neg"}">${money(r.lucro)}</span>
    </div>`;
    h += `<p class="note">${r.aVenda} à venda em ${r.anuncios} anúncio(s).${r.aVenda < 3 ? " Pouca oferta: o preço pode ser de uma pessoa só, venda com cuidado." : ""}</p>`;
    h += `<h5>Preço nos últimos dias</h5><div id="ah-chart">${chart(history.item === r.item ? history.pontos : null)}</div>`;
    h += `<p class="note">"Mercado" é a média dos 15% mais baratos (ignora um anúncio isolado muito barato). Materiais de NPC usam o preço do vendedor.</p>`;
    d.innerHTML = h;
    $("ah-close").addEventListener("click", () => { selected = null; renderRows(); renderDetail(); });
    $("ah-qty").addEventListener("change", (e) => {
      craftQty = Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1));
      renderDetail();
      $("ah-qty").focus();
    });
    if (history.item !== r.item) send("ahHistory", { item: r.item });
  }

  function chart(pts) {
    if (pts == null) return '<p class="note">Carregando…</p>';
    if (pts.length < 2) return '<p class="note">Ainda sem histórico deste item. A Lontrax guarda o preço de 3 em 3 horas (mesmo com o seu app fechado); o gráfico vai enchendo com os dias.</p>';
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
    lastCompare = m;
    const names = casas[0].itens.map((i) => (lang === "en" && EN && EN.itens[i.id]) || i.nome);
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
    setRows([]);
    selected = null;
    renderState(); renderRows(); renderDetail();
    send("ahSetHouse", { id });
  }

  // ---------- my bags: what is worth selling ----------
  let bags = null, bagsChar = 0, bagsTab = "bolsas", bagsOpen = false;
  let bagsSort = "ganho", bagsDir = -1, bagsShow = "todos";   // sorting and "show only" filter in the backpack window
  const WHERE = { ah: "Vender na AH", npc: "Vender no NPC", sem: "Ninguém vende na AH", nada: "Sem valor" };

  function openBags() {
    bagsOpen = true;
    $("ah-bags").hidden = false;
    $("ah-bags-body").innerHTML = '<p class="waiting"><span class="spinner"></span> Lendo suas bolsas…</p>';
    send("ahBags");
    // Browser preview: sample made by --selftest-bags.
    if (!host) fetch("ah-bags.json").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { bags = d; renderBags(); } }).catch(() => {});
  }
  function closeBags() { bagsOpen = false; $("ah-bags").hidden = true; }

  function renderBags() {
    const body = $("ah-bags-body");
    if (!bags) return;
    if (bags.semPrecos) { body.innerHTML = '<p class="note">Escolha a sua Casa de Leilões no Mercado primeiro (precisa dos preços).</p>'; return; }
    if (!bags.personagens || !bags.personagens.length) {
      body.innerHTML = `<p>${bags.achou ? "O addon ainda não anotou nenhuma bolsa." : "Ainda não achei as suas bolsas."}</p>
        <ol class="steps">
          <li>Na aba <b>Addons</b>, instale o <b>Lontrax Mercado</b>.</li>
          <li>Entre no jogo com o personagem.</li>
          <li>Digite <b>/reload</b> (ou deslogue). Para incluir o banco, abra o banco uma vez antes.</li>
          <li>Volte aqui e clique em <b>Minha mochila</b> de novo.</li>
        </ol>`;
      return;
    }
    const c = bags.personagens[Math.min(bagsChar, bags.personagens.length - 1)];
    const list = (bagsTab === "banco" ? c.banco : c.bolsas) || [];
    const sum = (w) => list.filter((a) => a.onde === w).reduce((s, a) => s + a.ganho, 0);
    let h = `<div class="bags-top">`;
    if (bags.personagens.length > 1) {
      h += `<select id="bags-char">${bags.personagens.map((p, i) => `<option value="${i}"${i === bagsChar ? " selected" : ""}>${esc(p.nome)} (nível ${p.nivel})</option>`).join("")}</select>`;
    } else h += `<b>${esc(c.nome)}</b>`;
    h += `<div class="tabs-mini"><button type="button" data-t="bolsas" class="${bagsTab === "bolsas" ? "on" : ""}">Bolsas</button><button type="button" data-t="banco" class="${bagsTab === "banco" ? "on" : ""}">Banco</button></div>`;
    h += `<span class="flat">${bagsTab === "banco"
      ? (c.bancoAtualizado ? `banco anotado em ${esc(c.bancoAtualizado)}` : "abra o banco no jogo uma vez e dê /reload")
      : (c.atualizado ? `bolsas anotadas em ${esc(c.atualizado)} (atualiza no /reload ou ao deslogar)` : "")}</span></div>`;
    h += `<div class="bags-sum">
      <div>Vender na AH<b>${money(sum("ah"))}</b></div>
      <div>Vender no NPC<b>${money(sum("npc"))}</b></div>
      <div>Ouro no personagem<b>${money(c.dinheiro)}</b></div>
    </div>`;
    // Filters: sort by value / name / quantity, show only one kind of sale.
    const itemName = (a) => (lang === "en" && EN && EN.itens[a.id]) || a.nome;
    const counts = { todos: list.length, ah: 0, npc: 0, outros: 0 };
    list.forEach((a) => (a.onde === "ah" ? counts.ah++ : a.onde === "npc" ? counts.npc++ : counts.outros++));
    const shown = list
      .filter((a) => bagsShow === "todos" || (bagsShow === "outros" ? a.onde !== "ah" && a.onde !== "npc" : a.onde === bagsShow))
      .slice()
      .sort((x, y) => {
        if (bagsSort === "nome") return bagsDir * itemName(x).localeCompare(itemName(y), "pt-BR");
        const v = (a) => (bagsSort === "qtd" ? a.qtd : bagsSort === "ah" ? a.ahUnidade ?? -1 : bagsSort === "npc" ? a.npcUnidade : bagsSort === "aVenda" ? a.aVenda : a.ganho);
        return bagsDir * (v(x) - v(y));
      });
    if (list.length) {
      const chip = (k, label) => `<button type="button" class="chip${bagsShow === k ? " on" : ""}" data-show="${k}">${label}<span class="n">${counts[k]}</span></button>`;
      h += `<div class="bags-filters">
        <label class="opt">Ordenar por
          <select id="bags-sort">
            <option value="ganho"${bagsSort === "ganho" ? " selected" : ""}>Mais ouro primeiro</option>
            <option value="nome"${bagsSort === "nome" ? " selected" : ""}>Nome (A a Z)</option>
            <option value="qtd"${bagsSort === "qtd" ? " selected" : ""}>Quantidade</option>
          </select></label>
        <span class="chips-inline">${chip("todos", "Todos")}${chip("ah", "Vender na AH")}${chip("npc", "Vender no NPC")}${chip("outros", "Sem valor / ninguém vende")}</span>
      </div>`;
    }
    const th = (key, label, num) => `<th data-sort="${key}" class="${num ? "num " : ""}${bagsSort === key ? "sorted " + (bagsDir < 0 ? "desc" : "asc") : ""}">${label}</th>`;
    if (!list.length) {
      h += `<p class="note">${bagsTab === "banco" ? "Nada anotado do banco ainda." : "Bolsas vazias."}</p>`;
    } else if (!shown.length) {
      h += `<p class="note">Nenhum item nesse filtro.</p>`;
    } else {
      h += `<div class="bags-wrap"><table class="bags-table"><thead><tr>
        ${th("nome", "Item")}${th("qtd", "Qtd", 1)}<th>O que fazer</th>${th("ganho", "Você ganha", 1)}
        ${th("ah", "AH (cada)", 1)}${th("npc", "NPC (cada)", 1)}${th("aVenda", "À venda", 1)}<th>Dica</th></tr></thead><tbody>`;
      shown.forEach((a) => {
        const nome = itemName(a);
        const dica = a.craft
          ? `<span class="tip${a.craftConhecida ? " known" : ""}">Serve para ${esc((lang === "en" && EN && a.craftItem && EN.itens[a.craftItem]) || a.craft)} (+${money(a.craftLucro)} por craft)${a.craftConhecida ? " · você sabe" : ""}</span>`
          : a.vinculado ? '<span class="flat">vinculado: só NPC</span>'
          : a.onde === "sem" ? '<span class="flat">ninguém vendendo: você escolhe o preço</span>'
          : a.onde === "ah" && a.aVenda > 200 ? '<span class="flat">muita gente vendendo: venda um pouco abaixo</span>' : "";
        h += `<tr><td>${esc(nome)}</td><td class="num">${a.qtd}</td><td><span class="where ${a.onde}">${WHERE[a.onde] || a.onde}</span></td>
          <td class="num">${money(a.ganho)}</td><td class="num">${a.ahUnidade == null ? "—" : money(a.ahUnidade)}</td>
          <td class="num">${a.npcUnidade ? money(a.npcUnidade) : "—"}</td><td class="num">${a.ahUnidade == null ? "—" : a.aVenda}</td><td>${dica}</td></tr>`;
      });
      h += `</tbody></table></div>`;
      h += `<p class="note">"Você ganha" na AH já tira os 5% da taxa e usa o anúncio mais barato de agora. Itens vinculados só dá para vender no NPC.</p>`;
    }
    body.innerHTML = h;
    const sel = $("bags-char");
    if (sel) sel.addEventListener("change", (e) => { bagsChar = +e.target.value; renderBags(); });
    body.querySelectorAll(".tabs-mini button").forEach((b) => b.addEventListener("click", () => { bagsTab = b.dataset.t; renderBags(); }));
    const so = $("bags-sort");
    if (so) so.addEventListener("change", (e) => { bagsSort = e.target.value; bagsDir = bagsSort === "nome" ? 1 : -1; renderBags(); });
    body.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { bagsShow = b.dataset.show; renderBags(); }));
    body.querySelectorAll(".bags-table th[data-sort]").forEach((t) => t.addEventListener("click", () => {
      const k = t.dataset.sort;
      if (bagsSort === k) bagsDir = -bagsDir; else { bagsSort = k; bagsDir = k === "nome" ? 1 : -1; }
      renderBags();
    }));
  }

  // ---------- events ----------
  $("ah-bags-open").addEventListener("click", openBags);
  $("ah-bags-close").addEventListener("click", closeBags);
  $("ah-open-bnet").addEventListener("click", () => send("openUrl", { url: "https://develop.battle.net/access/clients" }));
  $("ah-save-keys").addEventListener("click", () => {
    const id = $("ah-id").value.trim(), secret = $("ah-secret").value.trim();
    if (!id || !secret) return toast("erro", "Cole o Client ID e o Client Secret.");
    $("ah-save-keys").disabled = true;
    send("ahSaveKeys", { id, secret });
  });
  // PT | EN: only item, material and profession names change; the rest of the screen stays in Portuguese.
  function setLang(l) {
    lang = l === "en" ? "en" : "pt";
    LS("lontrax.lang", lang);
    document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
    if (st.hasKeys !== undefined) { renderState(); renderRows(); renderDetail(); }
    if (compareOpen && lastCompare) renderCompare(lastCompare);
    if (bagsOpen) renderBags();
  }
  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  setLang(LS("lontrax.lang"));

  // Character picker: the guild list fills the suggestions the first time the box is used.
  $("ah-char").addEventListener("focus", () => { if (!charsAsked) { charsAsked = true; send("ahChars"); } });
  const loadChar = () => send("ahSetChar", { nome: $("ah-char").value.trim() });
  $("ah-char-go").addEventListener("click", loadChar);
  $("ah-char").addEventListener("keydown", (e) => { if (e.key === "Enter") loadChar(); });
  $("ah-only-known").addEventListener("change", (e) => { st.soConhecidas = e.target.checked; send("ahSetOnlyKnown", { on: e.target.checked }); renderRows(); });
  $("ah-setup-back").addEventListener("click", () => { $("ah-setup-back").hidden = true; renderState(); });
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
  // Ignore material cost: changes profit itself, so rebuild rows before drawing.
  $("ah-no-cost").addEventListener("change", (e) => {
    LS("lontrax.ah-no-cost", e.target.checked);
    $("ah-only-complete").disabled = e.target.checked; // every recipe counts as complete
    deriveRows(); renderRows(); renderDetail();
  });
  ["ah-only-complete", "ah-only-profit", "ah-min-qty", "ah-no-cost"].forEach((id) => {
    const v = LS("lontrax." + id);
    if (v == null) return;
    if ($(id).type === "checkbox") $(id).checked = v === "true"; else $(id).value = v;
  });
  $("ah-only-complete").disabled = noCost();

  const PROG_TEXT = { receitas: "Baixando receitas (só na primeira vez)…", precos: "Baixando preços…", comparar: "Comparando casas…" };
  host && host.addEventListener("message", (ev) => {
    const m = ev.data;
    switch (m.type) {
      case "ahState": st = m; $("ah-save-keys").disabled = false; renderState(); if (!rows.length) renderRows(); break;
      case "ahRows": setRows(m.rows); renderRows(); renderDetail(); break;
      case "ahBags": bags = m; if (bagsOpen) renderBags(); break;
      case "ahNames":
        try { EN = JSON.parse(m.json); } catch (e) { EN = null; }
        if (st.hasKeys !== undefined) { renderState(); renderRows(); renderDetail(); }
        break;
      case "ahChars": {
        const dl = $("ah-char-list");
        dl.innerHTML = "";
        (m.lista || []).forEach((c) => { const o = document.createElement("option"); o.value = c.nome; dl.appendChild(o); });
        break;
      }
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
    const mk = (receita, nome, custo, venda, aVenda, ontem, mats, estoquePico) => ({ estoquePico,
      receita, nome, profissao: "Couraria", categoria: "Braçadeiras", item: receita, qtdFeita: 1, custo, venda, vendaMercado: Math.round(venda * 1.08),
      lucro: Math.round(venda * 0.95) - custo, margem: (Math.round(venda * 0.95) - custo) / custo, aVenda, anuncios: aVenda, ontem, completo: true,
      materiais: mats || [{ id: 1, nome: "Couro Médio", qtd: 6, preco: 12000, fonte: "ah", aVenda: 300 }, { id: 2, nome: "Linha Fina", qtd: 2, preco: 100, fonte: "npc", aVenda: 0 }],
    });
    setRows([
      mk(1, "Braçadeiras de Camurça Azul", 15165, 105200, 5, 98000),
      mk(2, "Luvas de Camurça Azul", 13343, 80600, 5, 90000),
      mk(3, "Colete de Couro Silvestre", 10403, 200000, 1, null),
      mk(4, "Braçadeiras Barbarescas", 7025, 29600, 60, 29000, null, 140),
      mk(5, "Perneiras Escorpídeas Resistentes", 19470, 44000, 6, 40000),
    ]);
    showTab("mercado");
    renderState(); renderRows();
    selected = 1; renderDetail();
    history = { item: 1, pontos: Array.from({ length: 30 }, (_, i) => [489000 + i * 4, 0, 100000 + Math.round(Math.sin(i / 3) * 9000 + i * 300), 5]) };
    renderDetail();
    // Developer preview: market.js?real → loads ah-rows.json made by --selftest-market.
    fetch("ah-rows.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setRows(d.rows); st.profissoes = d.profissoes; st.escolhidas = [165];
      if (d.personagem) st.personagem = d.personagem;
      fetch("nomes-en.json").then((r) => (r.ok ? r.json() : null)).then((n) => { if (n) { EN = n; renderState(); renderRows(); renderDetail(); } }).catch(() => {});
      selected = null; renderState(); renderRows(); renderDetail();
    }).catch(() => {});
  }
})();
