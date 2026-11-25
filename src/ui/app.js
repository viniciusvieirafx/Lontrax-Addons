(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });

  const views = ["view-login", "view-code", "view-setup", "view-main"];
  const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

  let state = {};
  let items = [];
  const finishedAt = {};

  // ---------- Lontrinha de armadura (mascote) ----------
  let celebrateUntil = 0;
  let bubbleTimer = null;
  let appUpdatePending = false;
  let lastAuto = "";
  function setMascot(mode, text, ms) {
    const sp = $("mascot-sprite");
    sp.className = "mascot-sprite " + mode;
    const b = $("mascot-bubble");
    clearTimeout(bubbleTimer);
    if (text) {
      b.textContent = text;
      b.hidden = false;
      if (ms) bubbleTimer = setTimeout(() => (b.hidden = true), ms);
    } else {
      b.hidden = true;
    }
  }
  // What the otter does when nothing special is happening.
  function mascotAuto() {
    if (Date.now() < celebrateUntil) return;
    const pending = items.filter((x) => x.status === "atualizar" || x.status === "nao_instalado" || x.status === "externo").length;
    let key, mode, text;
    if (appUpdatePending) { key = "app"; mode = "avisando"; text = "Tenho uma versão nova do app! Clique em Atualizar o app."; }
    else if (pending > 0) { key = "addons" + pending; mode = "avisando"; text = pending === 1 ? "Tem 1 novidade! Clique em Atualizar tudo." : `Tem ${pending} novidades! Clique em Atualizar tudo.`; }
    else { key = "ok"; mode = "parada"; text = null; }
    if (key === lastAuto && $("mascot-sprite").classList.contains(mode)) return;
    lastAuto = key;
    setMascot(mode, text, mode === "parada" ? 0 : 0);
  }
  const PHRASES = ["Pela Aliança!", "Elmo polido, addons em dia!", "Lontra de guarda, senhor!", "Precisando de algo? Clique em Verificar!", "Nenhum murloc passa por aqui."];

  let deviceUri = "https://github.com/login/device";

  const LABEL = {
    atualizado: "Em dia",
    atualizar: "Nova versão",
    nao_instalado: "Não instalado",
    externo: "Versão de fora",
    erro: "Sem acesso",
  };
  const ACTION = {
    atualizado: "Reinstalar",
    atualizar: "Atualizar",
    nao_instalado: "Instalar",
    externo: "Instalar versão da galera",
    erro: "Tentar de novo",
  };

  function toast(kind, text) {
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = text;
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), kind === "erro" ? 9000 : 5000);
  }

  function renderState() {
    if (!state.configured && !state.loggedIn) return show("view-setup");
    if (!state.loggedIn) return show("view-login");
    show("view-main");
    $("mascot").hidden = false;
    $("user-name").textContent = state.login || "Herói";
    if (state.avatar) $("avatar").src = state.avatar;
    const pv = $("path-value");
    if (state.addonsPath) {
      pv.textContent = state.addonsPath;
      pv.title = "Abrir: " + state.addonsPath;
      pv.classList.remove("missing");
    } else {
      pv.textContent = "Não encontrei o WoW Forever. Clique em Alterar.";
      pv.classList.add("missing");
    }
    $("wow-warning").hidden = !state.wowRunning;
    $("version").textContent = "v" + (state.version || "");
    $("opt-autostart").checked = state.autostart !== false;
    $("opt-tray").checked = state.keepInTray !== false;
  }

  function skeletons() {
    const g = $("grid");
    g.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("div");
      s.className = "skeleton";
      g.appendChild(s);
    }
  }

  function metaRow(dl, label, value, cls) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    if (cls) dd.className = cls;
    dd.title = value;
    dl.append(dt, dd);
  }

  function renderItems() {
    const g = $("grid");
    g.innerHTML = "";
    if (!items.length) {
      g.innerHTML = '<p class="empty">O catálogo está vazio por enquanto.</p>';
    }
    const tpl = $("card-tpl");
    items.forEach((it, i) => {
      const c = tpl.content.firstElementChild.cloneNode(true);
      c.dataset.id = it.id;
      c.style.animationDelay = i * 40 + "ms";
      c.querySelector(".card-title").textContent = it.nome || it.id;
      if (it.banner) {
        const b = c.querySelector(".card-banner"), img = b.querySelector("img");
        img.onload = () => { b.hidden = false; c.classList.add("has-banner"); };
        img.onerror = () => { b.hidden = true; c.classList.remove("has-banner"); };
        img.src = it.banner;
        img.alt = it.nome || "";
      }
      c.querySelector(".card-desc").textContent = it.descricao || "";
      const st = c.querySelector(".status");
      st.textContent = LABEL[it.status] || it.status;
      st.classList.add(it.status);
      const tags = c.querySelector(".tags");
      (it.tags || []).forEach((t) => {
        const s = document.createElement("span");
        s.className = "tag";
        s.textContent = t;
        tags.appendChild(s);
      });
      const dl = c.querySelector(".meta");
      if (it.autor) metaRow(dl, "Autor", it.autor);
      if (it.instalado) metaRow(dl, "Instalado", it.instalado.data);
      if (it.novo) metaRow(dl, it.status === "atualizado" ? "Versão" : "Nova", it.novo.msg || it.novo.sha);
      if (it.novo) metaRow(dl, "Publicada", it.novo.data);
      if (it.erro) metaRow(dl, "Problema", it.erro, "err");
      if (it.status === "externo") metaRow(dl, "Aviso", "Instalado por fora do app (CurseForge ou zip).");

      const btn = c.querySelector(".main-btn");
      btn.textContent = ACTION[it.status] || "Instalar";
      if (it.status === "atualizado") btn.classList.replace("gold", "ghost");
      btn.addEventListener("click", () => {
        if (it.status === "erro") return send("refresh");
        send("install", { id: it.id });
      });
      c.querySelector(".news-btn").addEventListener("click", () => abrirNovidades(it));
      const rm = c.querySelector(".remove-btn");
      rm.hidden = it.status === "nao_instalado" || it.status === "erro" || it.obrigatorio;
      rm.addEventListener("click", () => {
        if (confirm(`Remover ${it.nome} do WoW? (fica uma cópia de segurança)`)) send("uninstall", { id: it.id });
      });
      g.appendChild(c);
    });
    const pending = items.filter((x) => x.status === "atualizar" || x.status === "nao_instalado" || x.status === "externo").length;
    const cnt = $("update-count");
    cnt.hidden = pending === 0;
    cnt.textContent = pending;
    $("btn-update-all").disabled = pending === 0;
    mascotAuto();
    const ok = items.filter((x) => x.status === "atualizado").length;
    $("foot-text").textContent = items.length ? `${ok} de ${items.length} addons em dia · Pela Aliança!` : "Pela Aliança!";
  }

  // ---------- Novidades: what changed in an addon ----------
  // From the repo's NOVIDADES.md ("## 1.4.2 · 23/11/2026" headers, "- " items, **bold**) or, when it has none,
  // its last commits. What came after the installed version is marked "novo".
  let novidadesDe = null;
  function abrirNovidades(it) {
    novidadesDe = it.id;
    $("novidades-tit").textContent = "Novidades · " + (it.nome || it.id);
    $("novidades-body").innerHTML = '<p class="waiting"><span class="spinner"></span> Buscando as novidades…</p>';
    $("novidades").hidden = false;
    if (host) send("novidades", { id: it.id });
    else setTimeout(() => mostrarNovidades(DEMO_NOVIDADES(it)), 400);
  }
  function fecharNovidades() { novidadesDe = null; $("novidades").hidden = true; }
  $("novidades-close").addEventListener("click", fecharNovidades);
  $("novidades").addEventListener("click", (ev) => { if (ev.target === $("novidades")) fecharNovidades(); });
  addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !$("novidades").hidden) fecharNovidades(); });
  const escN = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const negrito = (t) => escN(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>");
  function dataDoTitulo(t) {
    const d = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null;
  }
  function mostrarNovidades(m) {
    if (m.id !== novidadesDe) return;
    const body = $("novidades-body");
    if (m.erro) { body.innerHTML = `<p class="note">Não consegui buscar as novidades agora. ${escN(m.erro)}</p>`; return; }
    let h = "";
    if (m.md) {
      let lista = false;
      const fecha = () => { if (lista) { h += "</ul>"; lista = false; } };
      for (const raw of m.md.split(/\r?\n/)) {
        const l = raw.trim();
        if (!l || l.startsWith("# ")) { fecha(); continue; }
        if (l.startsWith("## ")) {
          fecha();
          const t = l.slice(3), d = dataDoTitulo(t);
          const novo = m.instalado && d && d >= m.instalado;
          h += `<h4 class="nv-ver">${negrito(t)}${novo ? ' <span class="nv-novo">novo</span>' : ""}</h4>`;
        } else if (l.startsWith("### ")) { fecha(); h += `<h5 class="nv-sub">${negrito(l.slice(4))}</h5>`; }
        else if (/^[-*] /.test(l)) { if (!lista) { h += "<ul>"; lista = true; } h += `<li>${negrito(l.slice(2))}</li>`; }
        else { fecha(); h += `<p>${negrito(l)}</p>`; }
      }
      fecha();
    } else if (m.commits && m.commits.length) {
      h += '<p class="nv-obs">Este addon ainda não tem uma lista de novidades. Estas são as últimas mudanças enviadas:</p><ul class="nv-commits">';
      for (const c of m.commits) h += `<li><span class="nv-data">${escN(c.data)}</span> ${escN(c.msg)}${c.novo ? ' <span class="nv-novo">novo</span>' : ""}</li>`;
      h += "</ul>";
    } else h = '<p class="note">Nada por aqui ainda.</p>';
    body.innerHTML = h;
    body.scrollTop = 0;
  }
  const DEMO_NOVIDADES = (it) => it.id === "mf"
    ? { id: it.id, instalado: "2026-11-20", md: "# Novidades\n\n## 1.4.2 · 23/11/2026\n### Modo Simples\n- O `/mf` abre numa página **simples** com o básico.\n- Estilos prontos: **MF Style**, **Moderno** e **Clássico**.\n### Alvo\n- O seu alvo pode ter setas, brilho e borda.\n\n## 1.4.0 · 15/11/2026\n- Bicho de missão confere o tipo da criatura." }
    : { id: it.id, commits: [{ msg: "Corrige a seta no mapa", data: "22/11/2026", novo: true }, { msg: "v4.4.1", data: "01/11/2026", novo: false }] };

  // Soft click for buttons inside the app (made on the fly, no sound file).
  let actx = null;
  function softClick() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      const filter = actx.createBiquadFilter();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(600, t + 0.04);
      filter.type = "lowpass";
      filter.frequency.value = 2500;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(filter).connect(gain).connect(actx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (e) {}
  }
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("button, .link, .opt, .code");
    if (el && !el.disabled) softClick();
  });

  function setBusy(on) {
    document.querySelectorAll(".main-btn, #btn-update-all, #btn-refresh").forEach((b) => (b.disabled = on));
  }

  host &&
    host.addEventListener("message", (ev) => {
      const m = ev.data;
      switch (m.type) {
        case "state":
          state = m;
          renderState();
          break;
        case "deviceCode":
          deviceUri = m.uri || deviceUri;
          $("device-code").textContent = m.code;
          show("view-code");
          break;
        case "loginCancelled":
          renderState();
          break;
        case "loading":
          skeletons();
          break;
        case "addons":
          items = m.items || [];
          $("banner").hidden = !m.mensagem;
          $("banner-text").textContent = m.mensagem || "";
          state.wowRunning = m.wowRunning;
          $("wow-warning").hidden = !m.wowRunning;
          renderItems();
          setBusy(false);
          if (window.lontraxChegou) window.lontraxChegou(items);
          break;
        case "progress": {
          if (fight.on) endFight();
          if (!(finishedAt[m.id] && Date.now() - finishedAt[m.id] < 5000 && m.value > 0.05)) setMascot("trabalhando", "Instalando… martelando aqui!");
          // A late report after the install finished must not bring back "Instalando…".
          if (finishedAt[m.id] && Date.now() - finishedAt[m.id] < 5000 && m.value > 0.05) break;
          delete finishedAt[m.id];
          setBusy(true);
          const c = document.querySelector(`.card[data-id="${CSS.escape(m.id)}"]`);
          if (!c) break;
          c.querySelector(".progress").hidden = false;
          c.querySelector(".bar").style.width = Math.round(m.value * 100) + "%";
          c.querySelector(".main-btn").textContent = "Instalando…";
          break;
        }
        case "progressEnd": {
          finishedAt[m.id] = Date.now();
          lastAuto = "";
          celebrateUntil = Date.now() + 2600;
          setMascot("comemorando", "Pronto! Pela Aliança!", 2600);
          setTimeout(mascotAuto, 2700);
          setBusy(false);
          const c = document.querySelector(`.card[data-id="${CSS.escape(m.id)}"]`);
          if (c) c.querySelector(".progress").hidden = true;
          break;
        }
        case "novidades":
          mostrarNovidades(m);
          break;
        case "toast":
          toast(m.kind, m.text);
          break;
        case "focus":
          document.body.classList.toggle("paused", !m.on);
          break;
        case "appUpdate":
          appUpdatePending = true;
          lastAuto = "";
          mascotAuto();
          $("app-update").hidden = false;
          $("app-update-version").textContent = "(" + m.version + ")";
          $("app-update-progress").hidden = true;
          $("btn-update-app").disabled = false;
          $("btn-update-app").textContent = "Atualizar o app";
          break;
        case "appUpdateProgress":
          $("app-update-progress").hidden = false;
          $("app-update-progress").querySelector(".bar").style.width = Math.round(m.value * 100) + "%";
          $("btn-update-app").disabled = true;
          $("btn-update-app").textContent = m.value >= 1 ? "Reabrindo…" : "Baixando…";
          break;
      }
    });

  $("btn-login").addEventListener("click", () => send("login"));
  $("btn-open-github").addEventListener("click", () => send("openUrl", { url: deviceUri }));
  $("btn-copy-code").addEventListener("click", () => {
    send("copy", { text: $("device-code").textContent });
    toast("ok", "Código copiado!");
  });
  $("device-code").addEventListener("click", () => {
    send("copy", { text: $("device-code").textContent });
    toast("ok", "Código copiado!");
  });
  $("btn-cancel-login").addEventListener("click", () => send("cancelLogin"));
  $("btn-logout").addEventListener("click", () => {
    if (confirm("Sair da conta do GitHub neste computador?")) send("logout");
  });
  $("btn-refresh").addEventListener("click", () => send("refresh"));
  $("btn-update-all").addEventListener("click", () => send("updateAll"));
  $("btn-update-app").addEventListener("click", () => send("updateApp"));
  $("btn-pick").addEventListener("click", () => send("pickFolder"));
  $("path-value").addEventListener("click", () => send("openFolder"));
  $("opt-autostart").addEventListener("change", (e) => send("setOption", { name: "autostart", value: e.target.checked }));
  $("opt-tray").addEventListener("change", (e) => send("setOption", { name: "tray", value: e.target.checked }));

  // Preview in a normal browser (no app host): show the main screen with sample data.
  if (!host) {
    state = { loggedIn: true, configured: true, login: "Miranajanela", addonsPath: "N:\\World of Warcraft\\_forever_\\Interface\\AddOns", version: "1.0.0", wowRunning: true };
    renderState();
    items = [
      { id: "mf", nome: "MF Nameplates (galera)", descricao: "Placas de nome com cores por facção, alerta de vida baixa e o visual da Lontrax.", tags: ["Placas", "Interface"], autor: "Marcelian & Flame + Lontrax", status: "atualizar", instalado: { data: "10/11/2026 09:06" }, novo: { msg: "Junta MF oficial v1.3.4", data: "10/11/2026 12:47" } },
      { id: "tomtom", nome: "TomTom", descricao: "Setas de navegação e coordenadas.", tags: ["Mapa"], status: "atualizado", instalado: { data: "09/11/2026 20:10" }, novo: { msg: "v4.4.1", data: "01/11/2026 10:00" } },
      { id: "openmap", nome: "OpenMap", descricao: "Mapa do mundo turbinado.", tags: ["Mapa"], status: "nao_instalado", novo: { msg: "v0.8.2", data: "08/11/2026 18:30" } },
      { id: "x", nome: "Addon secreto", descricao: "Ainda sem convite.", status: "erro", erro: "Sem acesso (aceitou o convite do repositório?)." },
      { id: "lontraxmap", nome: "Lontrax Map - Mapa com zoom", descricao: "Mapa do mundo com zoom, alfinetes das missões e o caminho até elas.", tags: ["Mapa"], status: "nao_instalado", lancado: new Date().toISOString().slice(0, 10), temBanner: true, banner: "natal-caixa.png" },
    ];
    $("banner").hidden = false;
    $("banner-text").textContent = "Nova versão do MF com a 1.3.4 oficial! Clique em Atualizar tudo.";
    renderItems();
    setTimeout(() => window.lontraxChegou && window.lontraxChegou(items), 300);
  }

  // ---------- Lontrinha vs murloc ----------
  // Now and then a murloc walks along the top bar toward the otter, she draws her sword and
  // sends it away in a puff of smoke. Also: click the otter 5 times quickly to call one.
  // Never while installing, while the window is in the background or with reduced motion.
  const fight = { on: false, timers: [], clicks: [] };
  const MURLOC_SAYS = ["Mrrglglglgl!", "Mrgle? Mrgle!", "Aaaughibbrgubugbugrguburgle!", "Mrglmrgl!"];
  const WIN_SAYS = ["Nenhum murloc passa por aqui!", "Volta pro lago, peixão!", "Pela Aliança! Mais um!", "Esse não rouba mais addon."];
  function murlocCount(add) {
    let n = 0;
    try { n = parseInt(localStorage.getItem("lontrax.murlocs") || "0", 10) || 0; } catch (e) {}
    if (add) { n += add; try { localStorage.setItem("lontrax.murlocs", String(n)); } catch (e) {} }
    return n;
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function later(fn, ms) { fight.timers.push(setTimeout(fn, ms)); }
  function canFight(force) {
    if (fight.on || document.hidden || document.body.classList.contains("paused")) return false;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if ($("mascot").hidden || (!force && Date.now() < celebrateUntil)) return false;
    const sp = $("mascot-sprite");
    return !sp.classList.contains("trabalhando") && !document.querySelector(".card .progress:not([hidden])");
  }
  function endFight() {
    fight.timers.forEach(clearTimeout);
    fight.timers = [];
    const m = $("murloc");
    m.hidden = true;
    m.className = "murloc";
    m.onclick = null;
    document.querySelectorAll(".dmg").forEach((d) => d.remove());
    if (fight.on) { fight.on = false; $("mascot-sprite").classList.remove("lutando"); }
  }
  function damage(x, y, text, crit) {
    const d = document.createElement("div");
    d.className = "dmg" + (crit ? " crit" : "");
    d.textContent = text;
    d.style.left = x + "px";
    d.style.top = y + "px";
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 950);
  }
  function startFight(force) {
    if (!canFight(force)) return false;
    fight.on = true;
    celebrateUntil = Date.now() + 60000; // keep the automatic messages away during the fight
    const sp = $("mascot-sprite");
    setMascot("avisando", null);
    const r = sp.getBoundingClientRect();
    const m = $("murloc");
    const say = m.querySelector(".murloc-say");
    const endX = Math.round(r.left - 24 - 84 + 22); // right next to the sword tip
    const startX = Math.max(-90, endX - 360);
    m.className = "murloc";
    m.style.transition = "none";
    m.style.left = startX + "px";
    m.style.top = Math.round(r.top) + "px";
    m.hidden = false;
    void m.offsetWidth;
    m.style.transition = "";
    m.style.left = endX + "px";
    say.textContent = pick(MURLOC_SAYS);
    say.hidden = false;
    later(() => (say.hidden = true), 1800);

    let hits = 0;
    let done = false;
    const hitOnce = () => {
      if (done) return;
      hits++;
      const crit = hits >= 3 || Math.random() < 0.15;
      m.classList.remove("hit");
      void m.offsetWidth;
      m.classList.add("hit");
      const mr = m.getBoundingClientRect();
      damage(mr.left + 42 + (Math.random() * 20 - 10), mr.top + 10, crit ? "CRÍTICO! -" + (90 + Math.floor(Math.random() * 60)) : "-" + (12 + Math.floor(Math.random() * 30)), crit);
      if (crit) win();
    };
    const win = () => {
      if (done) return;
      done = true;
      later(() => {
        m.className = "murloc poof";
        m.onclick = null;
        sp.classList.remove("lutando");
        const n = murlocCount(1);
        celebrateUntil = Date.now() + 4000;
        setMascot("comemorando", null);
        // the bubble waits for the smoke to clear (it opens right where the murloc was)
        later(() => setMascot("comemorando", pick(WIN_SAYS) + (n > 1 ? ` (${n} murlocs derrotados)` : " (o primeiro!)"), 3200), 750);
      }, 260);
      later(() => { endFight(); lastAuto = ""; mascotAuto(); }, 4300);
    };
    // A click on the murloc lands a hit right away.
    m.onclick = () => { if (fight.on && sp.classList.contains("lutando")) hitOnce(); };
    // It arrives (3.4 s), the otter draws her sword and swings until a critical hit.
    later(() => {
      m.classList.add("stop");
      setMascot("lutando", null);
      for (let i = 0; i < 4; i++) later(hitOnce, 300 + i * 440);
    }, 3400);
    later(endFight, 12000); // safety net
    return true;
  }
  // Random visits: first one 3 to 8 minutes after opening, then every 20 to 45 minutes.
  function scheduleMurloc(first) {
    const min = first ? 3 : 20, max = first ? 8 : 45;
    setTimeout(() => { startFight(); scheduleMurloc(false); }, (min + Math.random() * (max - min)) * 60000);
  }
  scheduleMurloc(true);
  window.lontraxMurloc = startFight; // handy for testing from the dev tools
  // for natal.js: the otter talks, and nothing automatic interrupts her while she unpacks a box
  window.lontraxMascote = {
    fala: (mode, text, ms) => setMascot(mode, text, ms),
    segura: (ms) => { celebrateUntil = Date.now() + ms; },
    solta: () => { celebrateUntil = 0; lastAuto = ""; mascotAuto(); },
    login: () => state.login || "",
    ocupada: () => fight.on || !!document.querySelector(".card .progress:not([hidden])"),
  };

  $("mascot-sprite").addEventListener("click", () => {
    const now = Date.now();
    fight.clicks = fight.clicks.filter((t) => now - t < 2500);
    fight.clicks.push(now);
    if (fight.clicks.length >= 5 && !fight.on) {
      fight.clicks = [];
      if (startFight(true)) return;
    }
    if (fight.on || Date.now() < celebrateUntil) return;
    const p = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    const was = $("mascot-sprite").className.split(" ")[1];
    celebrateUntil = Date.now() + 1300;
    setMascot("comemorando", p, 2200);
    setTimeout(() => { lastAuto = ""; if (was === "parada") setMascot("parada", p, 900); mascotAuto(); }, 1350);
  });

  send("ready");
})();
