// Natal: from Nov 19 the otter decorates the app, one decoration per day, until it is all done on Dec 1.
// Each day the app is opened she unpacks a gift box next to her and the new decoration flies out of it to its
// place (a tab the user isn't on gets a little gift until they open it). Missed days: all their boxes, in a row.
// A countdown to Christmas sits in the header; on Dec 25 "Feliz Natal", then a countdown to New Year.
// Everything goes away on Jan 7. Footer checkbox "Enfeites de Natal" turns it all off.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const DIA = 86400000;
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const M = () => window.lontraxMascote;

  // Test date: ?natal=2026-11-25 in the browser preview, or localStorage "lontrax.natal.teste" from the dev tools.
  let offset = 0;
  (() => {
    let t = null;
    if (!host) {
      if (/natalReset/.test(location.search)) {
        try { Object.keys(localStorage).filter((k) => k.startsWith("lontrax.natal")).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
      }
      const m = location.search.match(/natal=([\d-]+(?:T[\d:]+)?)/);
      if (m) t = m[1];
    }
    t = t || get("lontrax.natal.teste");
    if (t) {
      const d = new Date(t.length <= 10 ? t + "T09:00:00" : t);
      if (!isNaN(d)) offset = d - Date.now();
    }
  })();
  const agora = () => new Date(Date.now() + offset);

  const ENFEITES = [
    { id: "luzes", fala: "Pendurei o pisca-pisca!" },
    { id: "neve", fala: "Olha a neve caindo lá no fundo!" },
    { id: "lacos", aba: "addons", fala: "Um laço de presente em cada addon!" },
    { id: "bolas", fala: "Bolinhas de Natal penduradas no teto!" },
    { id: "bengalas", aba: "mercado", fala: "Deixei bengalas doces no Mercado!" },
    { id: "gorro", fala: "Ganhei um gorro de Papai Noel! Ficou bom?" },
    { id: "boneco", aba: "amigos", fala: "Fiz um boneco de neve na aba Amigos!" },
    { id: "guirlanda", fala: "Guirlanda no brasão da Lontrax!" },
    { id: "abas", fala: "Mais pisca-pisca, agora nas abas!" },
    { id: "gorrinhos", aba: "amigos", fala: "Gorrinho de Natal para a galera toda!" },
    { id: "sinos", fala: "Sininhos lá embaixo. Blém, blém!" },
    { id: "presentes", fala: "Deixei uns presentes ali no canto…" },
    { id: "arvore", fala: "E a árvore com a estrela! O app está todo enfeitado!" },
  ];

  function temporada(d) {
    const y = d.getMonth() >= 10 ? d.getFullYear() : d.getFullYear() - 1;
    return { ano: y, inicio: new Date(y, 10, 19), natal: new Date(y, 11, 25), posNatal: new Date(y, 11, 26), anoNovo: new Date(y + 1, 0, 1), fim: new Date(y + 1, 0, 7) };
  }
  const ativa = (d, t) => d >= t.inicio && d < t.fim;
  function liberados(d, t) {
    const meia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.min(ENFEITES.length, Math.round((meia - t.inicio) / DIA) + 1));
  }
  function diasPara(d, alvo) {
    const meia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((alvo - meia) / DIA);
  }

  // per-season progress: how many boxes were opened, and decorations not seen yet in their tab
  let T = temporada(agora());
  const chave = () => "lontrax.natal." + T.ano;
  function estado() {
    try { const s = JSON.parse(get(chave()) || "{}"); return { abertos: s.abertos | 0, novos: Array.isArray(s.novos) ? s.novos : [] }; }
    catch (e) { return { abertos: 0, novos: [] }; }
  }
  const salvar = (s) => put(chave(), JSON.stringify(s));
  const desligado = () => get("lontrax.natal.off") === "1";

  // ---------- building the decorations ----------
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const CORES = ["#ff5a5f", "#ffd75e", "#5fd47a", "#5f9cf0", "#ff9f43", "#d77bff"];
  function luzes(cls, n) {
    const w = el("div", "natal-luzes " + cls + " natal-el");
    w.innerHTML = '<svg viewBox="0 0 100 12" preserveAspectRatio="none"><path d="M0 4 Q 2.5 10 5 4 T 10 4 T 15 4 T 20 4 T 25 4 T 30 4 T 35 4 T 40 4 T 45 4 T 50 4 T 55 4 T 60 4 T 65 4 T 70 4 T 75 4 T 80 4 T 85 4 T 90 4 T 95 4 T 100 4"/></svg>';
    const lamps = el("div", "lamps");
    for (let i = 0; i < n; i++) {
      const b = el("i");
      b.style.setProperty("--c", CORES[i % CORES.length]);
      b.style.setProperty("--d", (-(i % 4) * 0.4).toFixed(1) + "s");
      lamps.appendChild(b);
    }
    w.appendChild(lamps);
    return w;
  }
  // Snow on one canvas at 20 frames a second, and only while the window is in front: 46 CSS flakes
  // kept the page redrawing 60 times a second (a third of a CPU core just for the snow).
  function neve() {
    const w = el("div", "natal-neve natal-el");
    const cv = el("canvas");
    w.appendChild(cv);
    const flocos = [];
    for (let i = 0; i < 46; i++) {
      const t = 9 + Math.random() * 12;
      flocos.push({ x: Math.random(), r: 1 + Math.random() * 2, o: 0.35 + Math.random() * 0.5, dx: Math.random() * 60 - 30, t, f: Math.random() });
    }
    let ultimo = 0;
    function quadro() {
      if (!w.isConnected) { clearInterval(w._timer); return; }
      const b = document.body.classList;
      if (document.hidden || b.contains("paused") || b.contains("natal-esconde-neve")) { ultimo = 0; return; }
      const W = w.clientWidth, H = w.clientHeight;
      if (!W || !H) return;
      const agora = performance.now();
      const passo = ultimo ? Math.min(0.2, (agora - ultimo) / 1000) : 0;
      ultimo = agora;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const g = cv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.fillStyle = "#fff";
      const vh = innerHeight;
      for (const f of flocos) {
        f.f = (f.f + passo / f.t) % 1;
        const y = -10 + f.f * (vh * 1.05 + 10);
        const x = f.x * W + Math.sin(f.f * Math.PI) * f.dx;
        if (y > H + 6) continue;
        g.globalAlpha = f.o;
        g.beginPath(); g.arc(x, y, f.r, 0, Math.PI * 2); g.fill();
      }
    }
    w._timer = setInterval(quadro, 50);
    return w;
  }
  const visivel = (x) => { if (!x) return null; const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
  const firstVisible = (sel) => { for (const x of document.querySelectorAll(sel)) if (visivel(x)) return x; return null; };

  // mount(): adds the decoration (idempotent); returns the element to aim at (if it is on screen right now)
  const MONTA = {
    luzes() { const top = document.querySelector("#view-main .top"); let w = top.querySelector(".natal-luzes.topo"); if (!w) { w = luzes("topo", 34); top.appendChild(w); } return w; },
    neve() { const sky = document.querySelector(".sky"); let w = sky.querySelector(".natal-neve"); if (!w) { w = neve(); sky.appendChild(w); } return null; },
    lacos() { document.body.classList.add("natal-lacos"); return firstVisible("#grid .card"); },
    bolas() { let w = document.querySelector(".natal-bolas"); if (!w) { w = el("div", "natal-bolas natal-el", "<span></span><span></span><span></span>"); $("view-main").appendChild(w); posBolas(); } return w.children[1]; },
    bengalas() {
      let w = document.querySelector(".natal-bengalas");
      const bar = document.querySelector("#ah-main .ah-bar");
      if (!w && bar) { w = el("span", "natal-bengalas natal-el", "<i></i><i></i>"); bar.insertBefore(w, bar.firstChild); }
      return w;
    },
    gorro() { document.body.classList.add("natal-gorro"); return $("mascot-sprite"); },
    boneco() { let w = document.querySelector(".natal-boneco"); if (!w) { w = el("div", "natal-boneco natal-px natal-el"); $("tab-amigos").appendChild(w); } return w; },
    guirlanda() { const c = document.querySelector("#view-main .crest-wrap.sm"); let w = c.querySelector(".natal-guirlanda"); if (!w) { w = el("div", "natal-guirlanda natal-px natal-el"); c.insertBefore(w, c.firstChild); } return c; },
    abas() { let w = document.querySelector(".natal-luzes.abas"); if (!w) { w = luzes("abas", 26); const nav = document.querySelector("#view-main nav.tabs"); nav.parentNode.insertBefore(w, nav.nextSibling); } return w; },
    gorrinhos() { document.body.classList.add("natal-gorrinhos"); return firstVisible("#fr-grid .fr-lvl"); },
    sinos() {
      let w = document.querySelector(".natal-sinos");
      if (!w) {
        const ft = $("foot-text");
        const box = el("span", "natal-foot natal-el");
        ft.parentNode.insertBefore(box, ft);
        w = el("span", "natal-sinos", "<i></i><i></i>");
        box.append(w, ft);
      }
      return w;
    },
    presentes() { return canto().querySelector(".natal-presentes") || canto().insertBefore(el("div", "natal-presentes natal-px"), canto().firstChild); },
    arvore() { let a = canto().querySelector(".natal-arvore"); if (!a) { a = el("div", "natal-arvore natal-px", '<div class="estrela"></div>'); canto().appendChild(a); } return a; },
  };
  function canto() { let c = document.querySelector(".natal-canto"); if (!c) { c = el("div", "natal-canto natal-el"); $("view-main").appendChild(c); } return c; }
  const ALVO_FIXO = { neve: () => ({ left: innerWidth / 2 - 20, top: 140, width: 40, height: 40 }) };

  function desmontar() {
    document.querySelectorAll(".natal-el").forEach((x) => {
      if (x.classList.contains("natal-foot")) { x.parentNode.insertBefore($("foot-text"), x); }
      x.remove();
    });
    document.querySelectorAll(".natal-neve, .natal-caixa, .natal-voo, .natal-festa, .natal-palco").forEach((x) => x.remove());
    document.body.classList.remove("natal", "natal-lacos", "natal-gorro", "natal-gorrinhos");
    document.querySelectorAll(".tab-btn.natal-novo").forEach((b) => b.classList.remove("natal-novo"));
  }

  // ---------- countdown ----------
  function conta() {
    let c = $("natal-conta");
    if (!c) {
      c = el("div", "natal-conta natal-el", '<div class="nc-arv"></div><div class="nc-txt"><span class="nc-tit"></span><span class="nc-num"></span></div>');
      c.id = "natal-conta";
      c.title = "Contagem para o Natal";
      const brand = document.querySelector("#view-main .brand");
      brand.parentNode.insertBefore(c, brand.nextSibling);
      c.addEventListener("click", falarConta);
    }
    return c;
  }
  const dois = (n) => String(n).padStart(2, "0");
  function relogio(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (d > 0 ? `${d}<small>${d === 1 ? "dia" : "dias"}</small>` : "") + `${dois(h)}:${dois(m)}:${dois(x)}`;
  }
  function atualizarConta() {
    const d = agora();
    const c = conta();
    let tit, num, festa = false;
    if (d < T.natal) { tit = "Natal em"; num = relogio(T.natal - d); }
    else if (d < T.posNatal) { tit = "Hoje é Natal"; num = "Feliz Natal!"; festa = true; }
    else if (d < T.anoNovo) { tit = "Ano Novo em"; num = relogio(T.anoNovo - d); }
    else { tit = "Boas festas"; num = "Feliz " + (T.ano + 1) + "!"; festa = true; }
    c.querySelector(".nc-tit").textContent = tit;
    const n = c.querySelector(".nc-num");
    if (n.innerHTML !== num) n.innerHTML = num;
    c.classList.toggle("festa", festa);
  }
  function falarConta() {
    const m = M();
    if (!m || ocupado) return;
    const d = agora();
    const falta = diasPara(d, T.natal);
    const quem = m.login();
    let t;
    if (d >= T.natal && d < T.posNatal) t = `Feliz Natal${quem ? ", " + quem : ""}! Pela Aliança!`;
    else if (d >= T.anoNovo) t = `Feliz Ano Novo${quem ? ", " + quem : ""}!`;
    else if (d >= T.posNatal) t = `Faltam ${diasPara(d, T.anoNovo)} dias para o Ano Novo!`;
    else if (liberados(d, T) < ENFEITES.length) t = `Amanhã tem caixa nova! Faltam ${falta} dias para o Natal.`;
    else t = `Tudo enfeitado! Faltam ${falta} ${falta === 1 ? "dia" : "dias"} para o Natal.`;
    m.segura(2600);
    m.fala("comemorando", t, 2600);
    setTimeout(() => m.solta(), 2700);
  }

  // ---------- the box ----------
  function faiscas(x, y, n, tam = 1) {
    for (let i = 0; i < n; i++) {
      const f = el("div", "natal-faisca");
      f.style.left = x + "px";
      f.style.top = y + "px";
      document.body.appendChild(f);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const r = (40 + Math.random() * 40) * tam;
      f.animate([{ transform: "translate(0,0) rotate(45deg) scale(1)", opacity: 1 }, { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r - 20}px) rotate(45deg) scale(.2)`, opacity: 0 }],
        { duration: 650 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" }).finished.then(() => f.remove());
    }
  }
  function brilho(r) {
    const b = el("div", "natal-brilho");
    b.style.left = r.left + r.width / 2 + "px";
    b.style.top = r.top + r.height / 2 + "px";
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 950);
  }
  async function voar(x0, y0, r, id, ms) {
    const v = el("div", "natal-voo", `<div class="ic ${id}"></div>`);
    v.style.left = x0 + "px";
    v.style.top = y0 + "px";
    document.body.appendChild(v);
    const dx = r.left + r.width / 2 - x0, dy = r.top + r.height / 2 - y0;
    const alto = Math.min(0, dy) - 70;
    const a = v.animate([
      { transform: "translate(0,0) scale(.3)", opacity: 0 },
      { transform: "translate(0,-46px) scale(1.35)", opacity: 1, offset: 0.25 },
      { transform: `translate(${dx * 0.5}px, ${alto}px) scale(1.15) rotate(180deg)`, opacity: 1, offset: 0.62 },
      { transform: `translate(${dx}px, ${dy}px) scale(.75) rotate(360deg)`, opacity: 1 },
    ], { duration: ms, easing: "ease-in-out", fill: "forwards" });
    await a.finished;
    v.remove();
  }
  function tabBtn(aba) { return document.querySelector(`.tab-btn[data-tab="${aba}"]`); }
  const abaAtual = () => { const b = document.querySelector(".tab-btn.active"); return b ? b.dataset.tab : "addons"; };
  function pop(e, alvo) {
    if (e.id === "lacos" || e.id === "gorrinhos") {
      document.body.classList.add("natal-pop-" + e.id);
      setTimeout(() => document.body.classList.remove("natal-pop-" + e.id), 900);
    } else if (alvo && e.id !== "gorro" && e.id !== "guirlanda") {
      const t = e.id === "bolas" ? alvo.parentNode : alvo;
      t.classList.remove("natal-pop");
      void t.offsetWidth;
      t.classList.add("natal-pop");
      setTimeout(() => t.classList.remove("natal-pop"), 800);
    }
    if (e.id === "guirlanda") {
      const g = document.querySelector(".natal-guirlanda");
      if (g) { g.classList.add("natal-pop"); setTimeout(() => g.classList.remove("natal-pop"), 800); }
    }
    if (e.id === "neve") {
      const n = document.querySelector(".natal-neve");
      if (n) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1600 });
    }
    const r = visivel(alvo) || (ALVO_FIXO[e.id] && ALVO_FIXO[e.id]());
    if (r) brilho(r);
  }

  let ocupado = false;
  // The gift waits big in the middle of the window until the user pulls its lid up with the mouse
  // (a small box next to the otter played by itself and most people missed it).
  // Clicks shake it and show how; the third click, Enter or Space open it too.
  function palco(total) {
    return new Promise((ok) => {
      const p = el("div", "natal-palco",
        `<div class="np-tit">${total > 1 ? `Chegaram ${total} presentes de Natal!` : "Chegou um presente de Natal!"}</div>` +
        `<div class="np-lugar"><div class="np-caixa"><div class="natal-caixa chega" tabindex="0" title="Puxe a tampa para cima"><div class="luz"></div><div class="corpo"></div><div class="tampa"></div></div></div>` +
        (total > 1 ? `<b class="np-qtd">×${total}</b>` : "") + `</div>` +
        `<div class="np-dica"><span class="np-seta">⬆</span> Puxe a tampa para cima com o mouse</div>`);
      document.body.appendChild(p);
      const box = p.querySelector(".natal-caixa"), tampa = box.querySelector(".tampa"), dica = p.querySelector(".np-dica");
      const K = 2.6; // .np-caixa scale
      const PUXA = 90; // screen pixels up to open
      let y0 = null, puxou = 0, cliques = 0, aberto = false;
      const sacode = () => {
        box.classList.remove("chega", "balanca");
        void box.offsetWidth;
        box.classList.add("balanca");
        dica.classList.remove("pisca");
        void dica.offsetWidth;
        dica.classList.add("pisca");
      };
      const lembrete = setInterval(() => {
        if (!p.isConnected) { clearInterval(lembrete); ok(null); return; } // decorations switched off while it waited
        if (y0 == null && !document.hidden) sacode();
      }, 4000);
      const abrir = () => {
        if (aberto) return;
        aberto = true;
        clearInterval(lembrete);
        box.classList.remove("chega", "balanca");
        box.classList.add("abre");
        p.classList.add("aberto");
        const r = box.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height * 0.45;
        faiscas(x, y, 26, 2.2);
        ok({ x, y, el: p, fechar:() => { box.classList.add("some"); p.classList.add("sai"); setTimeout(() => p.remove(), 500); } });
      };
      box.addEventListener("pointerdown", (ev) => {
        if (aberto) return;
        y0 = ev.clientY;
        puxou = 0;
        box.setPointerCapture(ev.pointerId);
        tampa.style.transition = "none";
      });
      box.addEventListener("pointermove", (ev) => {
        if (y0 == null || aberto) return;
        puxou = Math.max(0, Math.min(PUXA * 1.2, y0 - ev.clientY));
        const u = puxou / K;
        tampa.style.transform = `translate(${u * 0.25}px, ${-u}px) rotate(${u * 0.35}deg)`;
        box.style.transform = `rotate(${Math.sin(puxou / 6) * puxou / 60}deg)`;
        if (puxou >= PUXA) { y0 = null; box.style.transform = ""; abrir(); }
      });
      const solta = () => {
        if (y0 == null || aberto) return;
        y0 = null;
        box.style.transform = "";
        tampa.style.transition = "transform .25s cubic-bezier(.3, 1.6, .5, 1)";
        tampa.style.transform = "";
        if (puxou < 6 && ++cliques >= 3) abrir();
        else if (puxou < 6) sacode();
      };
      box.addEventListener("pointerup", solta);
      box.addEventListener("pointercancel", solta);
      box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); abrir(); } });
      setTimeout(() => { if (!aberto) box.focus({ preventScroll: true }); }, 600);
    });
  }

  // one decoration flies from (x0, y0) to its spot
  async function soltar(e, x0, y0, k) {
    // where it goes: its spot, or the tab button when it lives in a tab the user isn't on
    const montar = MONTA[e.id];
    document.body.classList.add("natal");
    let alvo = null, outraAba = false;
    if (e.aba && e.aba !== abaAtual()) {
      alvo = tabBtn(e.aba);
      outraAba = true;
    } else {
      // measure the spot before showing it: mount hidden, aim, then reveal on arrival
      document.body.classList.add("natal-esconde-" + e.id);
      alvo = montar();
    }
    const r = visivel(alvo) || (ALVO_FIXO[e.id] && ALVO_FIXO[e.id]()) || { left: innerWidth / 2 - 20, top: innerHeight / 2 - 20, width: 40, height: 40 };
    await voar(x0, y0, r, e.id, 1000 * k);

    const s = estado();
    if (outraAba) {
      montar();
      tabBtn(e.aba).classList.add("natal-novo");
      if (!s.novos.includes(e.id)) s.novos.push(e.id);
      faiscas(r.left + r.width / 2, r.top + r.height / 2, 8);
    } else {
      document.body.classList.remove("natal-esconde-" + e.id);
      pop(e, alvo);
    }
    s.abertos = Math.max(s.abertos, ENFEITES.indexOf(e) + 1);
    salvar(s);
    return outraAba;
  }

  async function abrirCaixas() {
    if (ocupado) return;
    const s = estado();
    const n = liberados(agora(), T);
    if (s.abertos >= n) return;
    const m = M();
    if (!m) return;
    ocupado = true;
    try {
      const fila = ENFEITES.slice(s.abertos, n);
      m.segura(DIA); // the gift may wait a long time for the user
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        fila.forEach((e) => MONTA[e.id]());
        salvar({ abertos: n, novos: s.novos });
        m.fala("comemorando", fila[fila.length - 1].fala, 3600);
        await sleep(3700);
      } else {
        m.fala("avisando", fila.length > 1 ? `Chegaram ${fila.length} presentes! Abre aí!` : "Chegou um presente! Abre aí!");
        const p = await palco(fila.length);
        if (!p) return;
        m.fala("comemorando", null);
        await sleep(450);
        p.el.classList.add("voando"); // the dark backdrop fades so the decorations can be seen landing
        let outraAba = false;
        const rapido = fila.length > 1;
        for (let i = 0; i < fila.length; i++) {
          if (desligado()) break;
          outraAba = await soltar(fila[i], p.x, p.y, rapido && i < fila.length - 1 ? 0.55 : 1);
        }
        p.fechar();
        const s = estado(), e = fila[fila.length - 1];
        const falta = diasPara(agora(), T.natal);
        let t;
        if (fila.length > 1) t = `Abri ${fila.length} presentes!` + (s.novos.length ? " Tem enfeite novo nas abas com 🎁." : " " + e.fala);
        else t = e.fala + (outraAba ? " Abra a aba para ver!" : "");
        if (falta > 0) t += ` Faltam ${falta} ${falta === 1 ? "dia" : "dias"} para o Natal.`;
        m.segura(3800);
        m.fala("comemorando", t, 3600);
        await sleep(3700);
      }
    } finally {
      ocupado = false;
      m.solta();
    }
  }

  // a tab with a decoration the user hasn't seen: reveal it when they open the tab
  document.addEventListener("lontrax-tab", (ev) => {
    if (!document.body.classList.contains("natal")) return;
    const aba = ev.detail;
    const s = estado();
    const aqui = s.novos.filter((id) => (ENFEITES.find((e) => e.id === id) || {}).aba === aba);
    if (!aqui.length) return;
    const b = tabBtn(aba);
    if (b) b.classList.remove("natal-novo");
    s.novos = s.novos.filter((id) => !aqui.includes(id));
    salvar(s);
    setTimeout(() => {
      aqui.forEach((id) => { const e = ENFEITES.find((x) => x.id === id); pop(e, MONTA[id]()); });
      const m = M();
      if (m && !ocupado) {
        m.segura(2600);
        m.fala("comemorando", aqui.length > 1 ? "Enfeites novos aqui!" : ENFEITES.find((x) => x.id === aqui[0]).fala, 2600);
        setTimeout(() => m.solta(), 2700);
      }
    }, 350);
  });

  // ---------- Christmas / New Year greeting (first open of the day) ----------
  function festa() {
    const d = agora();
    let k = null, t = null;
    const quem = (M() && M().login()) || "";
    if (d >= T.natal && d < T.posNatal) { k = "natal"; t = `Feliz Natal${quem ? ", " + quem : ""}! Pela Aliança!`; }
    else if (d >= T.anoNovo && diasPara(d, T.anoNovo) > -2) { k = "anonovo"; t = `Feliz ${T.ano + 1}${quem ? ", " + quem : ""}!`; }
    if (!k || get(chave() + "." + k) === "1") return false;
    put(chave() + "." + k, "1");
    pausaAte = Date.now() + 4600;
    const w = el("div", "natal-festa");
    for (let i = 0; i < 70; i++) {
      const f = el("b");
      f.style.left = (Math.random() * 100).toFixed(2) + "%";
      f.style.setProperty("--x", (Math.random() * 80 - 40).toFixed(0) + "px");
      f.style.setProperty("--t", (3 + Math.random() * 3).toFixed(1) + "s");
      f.style.setProperty("--d", (Math.random() * 2).toFixed(1) + "s");
      w.appendChild(f);
    }
    document.body.appendChild(w);
    setTimeout(() => w.remove(), 8500);
    const m = M();
    m.segura(4200);
    m.fala("comemorando", t, 4200);
    setTimeout(() => m.solta(), 4300);
    return true;
  }

  // ---------- footer switch ----------
  function interruptor() {
    if ($("opt-natal")) return;
    const opts = document.querySelector("#view-main .foot .opts");
    if (!opts) return;
    const l = el("label", "opt natal-opt", '<input type="checkbox" id="opt-natal"> Enfeites de Natal');
    opts.insertBefore(l, opts.firstChild);
    const cb = l.querySelector("input");
    cb.checked = !desligado();
    cb.addEventListener("change", () => {
      put("lontrax.natal.off", cb.checked ? null : "1");
      montado = false;
      if (!cb.checked) desmontar();
      tick();
    });
  }

  // ---------- main loop ----------
  let montado = false;
  let mainDesde = 0;
  let mexeuEm = 0;
  ["pointermove", "pointerdown", "keydown", "wheel"].forEach((t) => addEventListener(t, () => (mexeuEm = Date.now()), { passive: true, capture: true }));
  // (the host sets "paused" when the window is not in front; hasFocus() can be false in WebView2 until a click)
  const presente = () => !document.hidden && !document.body.classList.contains("paused") && Date.now() - mexeuEm < 8000;
  let pausaAte = 0;
  function montarTudo() {
    // 1.9.3 brought the big gift: the newest box comes back once so everyone gets to open it (many missed the old one)
    const rever = chave() + ".rever193";
    if (get(rever) !== "1") {
      put(rever, "1");
      const r = estado(), n = liberados(agora(), T);
      if (n > 0 && r.abertos >= n) {
        r.abertos = n - 1;
        r.novos = r.novos.filter((id) => id !== ENFEITES[n - 1].id);
        salvar(r);
      }
    }
    const s = estado();
    document.body.classList.add("natal");
    ENFEITES.slice(0, s.abertos).forEach((e) => MONTA[e.id]());
    s.novos.forEach((id) => { const e = ENFEITES.find((x) => x.id === id); if (e && e.aba) { const b = tabBtn(e.aba); if (b) b.classList.add("natal-novo"); } });
    conta();
    montado = true;
  }
  function tick() {
    const d = agora();
    T = temporada(d);
    const main = $("view-main");
    if (!main || main.hidden) { mainDesde = 0; return; }
    if (!mainDesde) mainDesde = Date.now();
    if (!ativa(d, T)) {
      if (montado || document.body.classList.contains("natal")) { desmontar(); montado = false; }
      const o = document.querySelector(".natal-opt");
      if (o) o.remove();
      return;
    }
    interruptor();
    if (desligado()) return;
    if (!montado) montarTudo();
    // the Mercado bar exists only after the Mercado opens: mount the candy canes when it shows up
    if (estado().abertos >= 5 && !document.querySelector(".natal-bengalas")) MONTA.bengalas();
    atualizarConta();
    // only for someone who is really there: window in front and the mouse or keyboard used in the last few seconds
    const pronto = Date.now() - mainDesde > 1500 && presente() && !$("mascot").hidden && M() && !M().ocupada();
    if (!pronto || ocupado || Date.now() < pausaAte) return;
    if (festa()) return;
    if (estado().abertos < liberados(d, T)) abrirCaixas();
  }
  // Bells, baubles and the snowman move now and then (an endless CSS loop keeps the page redrawing).
  let proximoMexe = Date.now() + 4000;
  function mexer() {
    if (Date.now() < proximoMexe || document.hidden || document.body.classList.contains("paused")) return;
    proximoMexe = Date.now() + 5000 + Math.random() * 5000;
    const quem = [".natal-bolas", ".natal-sinos", ".natal-boneco"].map((q) => document.querySelector(q)).filter((x) => visivel(x));
    if (!quem.length) return;
    const x = quem[Math.floor(Math.random() * quem.length)];
    x.classList.remove("mexe");
    void x.offsetWidth;
    x.classList.add("mexe");
    setTimeout(() => x.classList.remove("mexe"), 2800);
  }
  // The baubles hang just right of the countdown (its place moves with the window width: on a narrow or
  // vertical monitor a fixed spot ended up on top of the numbers).
  // When the window is too narrow for that, they hang from the string of lights on the right instead.
  function posBolas() {
    const b = document.querySelector(".natal-bolas"), r = visivel($("natal-conta"));
    if (!b || !r) return;
    const depois = [visivel($("mascot-sprite")), visivel(document.querySelector("#view-main .user, #view-main .who"))]
      .filter((x) => x && x.left > r.left).map((x) => x.left);
    const livre = Math.min(innerWidth, ...depois) - r.right;
    const fio = visivel(document.querySelector(".natal-luzes.topo"));
    if (livre >= 100 || !fio) {
      b.classList.remove("baixo");
      b.style.top = "";
      b.style.left = Math.round(r.right + 14) + "px";
    } else {
      b.classList.add("baixo");
      b.style.top = Math.round(fio.top + 4) + "px";
      b.style.left = Math.round(innerWidth - 150) + "px";
    }
  }
  addEventListener("resize", posBolas);
  setInterval(() => { tick(); if (montado) { posBolas(); mexer(); } }, 1000);
  tick();
  window.lontraxNatal = { abrir: abrirCaixas, estado, liberados: () => liberados(agora(), T), agora };
})();
