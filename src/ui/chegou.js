// "Chegou addon novo!": when the catalog has an addon with "lancado" (yyyy-mm-dd) in the last DIAS days,
// each person sees, once, a big announcement with the addon's banner. Seen ids stay in localStorage.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const host = window.chrome && window.chrome.webview;
  const send = (cmd, extra = {}) => host && host.postMessage({ cmd, ...extra });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const DIAS = 14;
  const KEY = "lontrax.chegou";
  const seen = new Set(read());
  let fila = [];       // ids waiting to be shown
  let aberto = null;   // id on screen
  let items = [];
  let espera = null;

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
  function marca(id) { seen.add(id); try { localStorage.setItem(KEY, JSON.stringify([...seen])); } catch { } }

  function recente(it) {
    if (!it.lancado) return false;
    const d = new Date(it.lancado + "T12:00:00");
    if (isNaN(d)) return false;
    const dias = (Date.now() - d.getTime()) / 86400000;
    return dias >= -1 && dias <= DIAS;
  }

  // Called by app.js with every new list of addons.
  window.lontraxChegou = (list) => {
    items = list || [];
    items.filter((it) => recente(it) && !seen.has(it.id) && it.status !== "erro")
      .sort((a, b) => String(b.lancado).localeCompare(String(a.lancado)))
      .forEach((it) => { if (!fila.includes(it.id) && aberto !== it.id) fila.push(it.id); });
    tenta();
  };

  function tenta() {
    if (aberto || !fila.length) return;
    const main = $("view-main");
    const m = window.lontraxMascote;
    if (!main || main.hidden || (m && m.ocupada())) { clearTimeout(espera); espera = setTimeout(tenta, 4000); return; }
    const it = items.find((x) => x.id === fila[0]);
    if (!it) { fila.shift(); return tenta(); }
    // The banner comes a moment after the list: wait for it (up to 15 s), then show anyway.
    if (it.temBanner && !it.banner && !it._esperou) {
      it._esperou = true;
      clearTimeout(espera);
      espera = setTimeout(() => { const x = items.find((y) => y.id === it.id); if (x) x._esperou = true; tenta(); }, 15000);
      return;
    }
    fila.shift();
    abre(it);
  }

  function abre(it) {
    aberto = it.id;
    const total = fila.length + 1;
    const ov = document.createElement("div");
    ov.className = "ch-ov";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Addon novo: " + (it.nome || ""));
    const faiscas = Array.from({ length: 34 }, (_, i) => {
      const a = (i / 34) * Math.PI * 2 + Math.random() * 0.3, r = 220 + Math.random() * 260;
      return `<i style="--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r * 0.7}px;--d:${(Math.random() * 0.5).toFixed(2)}s;--s:${(3 + Math.random() * 5).toFixed(1)}px"></i>`;
    }).join("");
    const instalado = it.status && it.status !== "nao_instalado";
    ov.innerHTML = `
      <div class="ch-raios"></div>
      <div class="ch-faiscas">${faiscas}</div>
      <div class="ch-box">
        <div class="ch-fita">Chegou addon novo!</div>
        <div class="ch-banner${it.banner ? "" : " sem"}">
          <div class="ch-aura"></div>
          ${it.banner ? `<img alt="" src="${esc(it.banner)}">` : `<div class="ch-semimg"><img alt="" src="brasao.png"></div>`}
          <div class="ch-brilho"></div>
        </div>
        <h2 class="ch-nome">${esc(it.nome)}</h2>
        <p class="ch-desc">${esc(it.descricao)}</p>
        <div class="ch-botoes">
          ${instalado
            ? `<button type="button" class="btn gold ch-ok" data-a="ver">Já está instalado ✓</button>`
            : `<button type="button" class="btn gold ch-ok" data-a="instalar">Instalar agora</button>`}
          <button type="button" class="link ch-depois" data-a="depois">${instalado ? "Fechar" : "Depois"}</button>
        </div>
        ${total > 1 ? `<div class="ch-conta">mais ${total - 1} ${total - 1 === 1 ? "novidade" : "novidades"} depois deste</div>` : ""}
      </div>`;
    const img = ov.querySelector(".ch-banner > img");
    if (img) img.onerror = () => { img.remove(); ov.querySelector(".ch-banner").classList.add("sem"); };
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("on"));
    const m = window.lontraxMascote;
    if (m) { m.segura(4000); m.fala("comemorando", "Olha o que chegou: " + (it.nome || "addon novo") + "!", 3800); }
    const fecha = (acao) => {
      marca(it.id);
      document.removeEventListener("keydown", tecla);
      ov.classList.add("sai");
      setTimeout(() => {
        ov.remove();
        aberto = null;
        if (acao === "instalar") send("install", { id: it.id });
        if (acao === "instalar" || acao === "ver") {
          const c = document.querySelector(`.card[data-id="${CSS.escape(it.id)}"]`);
          if (c) { c.scrollIntoView({ behavior: "smooth", block: "center" }); c.classList.add("ch-pisca"); setTimeout(() => c.classList.remove("ch-pisca"), 2600); }
        }
        if (m) m.solta();
        setTimeout(tenta, 900);
      }, 350);
    };
    const tecla = (e) => { if (e.key === "Escape") fecha("depois"); };
    document.addEventListener("keydown", tecla);
    ov.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]");
      if (b) fecha(b.dataset.a);
    });
    setTimeout(() => { const b = ov.querySelector(".ch-ok"); if (b) b.focus(); }, 900);
  }

  // Preview in a normal browser: ?chegou shows the announcement again.
  if (!host && /[?&]chegou/.test(location.search)) seen.clear();
  window.lontraxChegouTeste = (id) => { if (id) { seen.delete(id); } else { seen.clear(); } try { localStorage.removeItem(KEY); } catch { } window.lontraxChegou(items); };
})();
