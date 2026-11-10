(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });

  const views = ["view-login", "view-code", "view-setup", "view-main"];
  const show = (id) => views.forEach((v) => ($(v).hidden = v !== id));

  let state = {};
  let items = [];
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
    const ok = items.filter((x) => x.status === "atualizado").length;
    $("foot-text").textContent = items.length ? `${ok} de ${items.length} addons em dia · Pela Aliança!` : "Pela Aliança!";
  }

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
          break;
        case "progress": {
          setBusy(true);
          const c = document.querySelector(`.card[data-id="${CSS.escape(m.id)}"]`);
          if (!c) break;
          c.querySelector(".progress").hidden = false;
          c.querySelector(".bar").style.width = Math.round(m.value * 100) + "%";
          c.querySelector(".main-btn").textContent = "Instalando…";
          break;
        }
        case "progressEnd":
          setBusy(false);
          break;
        case "toast":
          toast(m.kind, m.text);
          break;
        case "appUpdate":
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
    ];
    $("banner").hidden = false;
    $("banner-text").textContent = "Nova versão do MF com a 1.3.4 oficial! Clique em Atualizar tudo.";
    renderItems();
  }

  send("ready");
})();
