/* cloud-ui.js — interfaz de proyectos en la nube para marketWeb.
   Usa cloud-projects.js tal cual está (sin modificarlo) y el puente window.__mwEditor de editor.html. */
(() => {
  "use strict";
  const ED = window.__mwEditor;
  const $ = id => document.getElementById(id);
  if (!ED || !$("cloudSaveBtn") || !$("cloudListBtn") || window.__mwCloudUi) return;
  window.__mwCloudUi = true;

  const MAX_HTML = 300000, MAX_PROJECT = 5 * 1024 * 1024; // mismos límites que cloud-projects.js (no se relajan)
  const bytes = s => new TextEncoder().encode(s).length;
  const current = { id: null, title: "", saved: null };
  let api = null;

  async function getApi() {
    if (!api) { try { api = await import("./cloud-projects.js"); } catch (e) { api = null; throw new Error("No se pudo cargar el módulo de la nube. Revisá tu conexión e intentá de nuevo."); } }
    return api;
  }

  /* ---------- utilidades de interfaz (todo con textContent, nada de innerHTML) ---------- */
  const style = document.createElement("style");
  style.textContent = ".cl-box{text-align:left;max-width:440px;max-height:88dvh;overflow:auto}.cl-box h3{text-align:center}" +
    ".cl-box input[type=text]{width:100%;border:1px solid var(--line);border-radius:9px;padding:10px 11px;background:#0B1220;color:var(--ink);outline:none}" +
    ".cl-box label{font-size:12px;font-weight:750}.cl-list,.cl-body{display:grid;gap:10px}" +
    ".cl-row{display:flex;gap:8px;align-items:center;border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px}" +
    ".cl-info{flex:1;min-width:0}.cl-title{font-size:13px;font-weight:750;overflow-wrap:anywhere}.cl-date{font-size:11px;color:var(--muted)}" +
    ".cl-msg{font-size:13px;margin:0;overflow-wrap:anywhere}.cl-msg.err{color:#ff9db1}.cl-msg a{color:var(--acc)}" +
    ".cl-actions{display:flex;flex-wrap:wrap;gap:8px}.cl-actions .btn{flex:1;justify-content:center}.cl-box .btn:disabled{opacity:.5;cursor:wait}";
  document.head.append(style);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const btn = (text, cls, fn) => { const b = el("button", "btn " + (cls || ""), text); b.type = "button"; b.addEventListener("click", fn); return b; };
  const busy = (m, v) => m.body.querySelectorAll("button,input").forEach(b => { b.disabled = v; });

  function openModal(title) {
    const wrap = el("div", "mw-modal"), box = el("div", "mw-box cl-box"), body = el("div", "cl-body");
    wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-modal", "true");
    box.append(el("h3", "", title), body); wrap.append(box); document.body.append(wrap);
    const onKey = e => { if (e.key === "Escape") close(); };
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey, true); };
    wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
    document.addEventListener("keydown", onKey, true);
    return { body, close };
  }

  function friendly(e) {
    const msg = String((e && e.message) || ""), code = e && e.code;
    if ((e && e.name === "AuthSessionMissingError") || /Iniciá sesión|session missing|not authenticated|JWT/i.test(msg))
      return { text: "Tu sesión no está iniciada o venció. Iniciá sesión para usar la nube.", login: true };
    if (code === "PGRST116") return { text: "Ese proyecto no existe en la nube o no te pertenece. Probá con «Guardar como nuevo»." };
    if (code === "42501") return { text: "No tenés permiso para realizar esta operación." };
    if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(msg))
      return { text: "No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo." };
    return { text: msg || "Ocurrió un error inesperado." };
  }
  function fail(p, e) {
    const f = friendly(e); p.className = "cl-msg err"; p.textContent = f.text + " ";
    if (f.login) { const a = el("a", "", "Ir a iniciar sesión"); a.href = "auth.html"; p.append(a); }
  }

  /* ---------- estado del proyecto abierto ---------- */
  const snapshot = () => JSON.stringify(ED.getProject());
  const dirty = () => { try { return current.id ? snapshot() !== current.saved : true; } catch (_) { return true; } };
  const status = el("p", "intro"); status.id = "cloudStatus"; status.style.margin = "8px 0 14px";
  $("cloudListBtn").insertAdjacentElement("afterend", status);
  function updateStatus() {
    status.textContent = current.id
      ? "Proyecto de la nube abierto: «" + current.title + "»" + (dirty() ? " · con cambios sin guardar." : ".")
      : "Este proyecto todavía no está guardado en la nube.";
  }
  updateStatus();
  $("tabs").addEventListener("click", updateStatus);

  /* ---------- guardar ---------- */
  const liteHtml = h => h.replace(/\ssrc="data:image\/[^"]*"/g, ' src="data:image/gif;base64,R0lGODlhAQABAAAAACw="');

  async function doSave(asNew, title, m, msg) {
    busy(m, true); msg.className = "cl-msg"; msg.textContent = "Guardando…";
    try {
      const cleanTitle = String(title || "").trim();
      if (!cleanTitle || cleanTitle.length > 80) throw new Error("El título debe tener entre 1 y 80 caracteres.");
      ED.commit();
      const projectData = ED.getProject();
      let html = ED.buildHtml(), lite = false;
      if (bytes(html) > MAX_HTML) {
        html = liteHtml(html); lite = true;
        if (bytes(html) > MAX_HTML) throw new Error("El HTML de la página supera el límite de 300 KB incluso sin imágenes. Reducí la cantidad de contenido.");
      }
      const json = JSON.stringify(projectData);
      if (bytes(json) > MAX_PROJECT) throw new Error("El proyecto pesa " + (bytes(json) / 1048576).toFixed(1) + " MB y el límite es 5 MB. Quitá o reemplazá las imágenes más pesadas.");
      const a = await getApi();
      const row = await a.saveProject({ id: asNew ? undefined : current.id, title: cleanTitle, html, projectData });
      current.id = row.id; current.title = row.title; current.saved = json; updateStatus();
      ED.toast(lite ? "Guardado. Por tamaño, el HTML guardado omite las imágenes; el proyecto sí las incluye." : "Proyecto guardado en la nube.");
      m.close();
    } catch (e) { busy(m, false); fail(msg, e); }
  }

  async function openSave() {
    const m = openModal("Guardar en la nube"), msg = el("p", "cl-msg", "Verificando sesión…");
    m.body.append(msg);
    try { const a = await getApi(); await a.getCurrentUser(); } catch (e) { fail(msg, e); m.body.append(btn("Cerrar", "", m.close)); return; }
    msg.textContent = "";
    const lab = el("label", "", "Título del proyecto"), inp = el("input"); inp.type = "text"; inp.maxLength = 80; inp.id = "cloudTitle"; lab.htmlFor = "cloudTitle";
    inp.value = current.title || (ED.getProject().state.businessName || "Mi página").trim().slice(0, 80);
    const acts = el("div", "cl-actions");
    if (current.id) {
      acts.append(btn("Actualizar este proyecto", "primary", () => doSave(false, inp.value, m, msg)),
                  btn("Guardar como nuevo", "", () => doSave(true, inp.value, m, msg)));
    } else acts.append(btn("Guardar", "primary", () => doSave(true, inp.value, m, msg)));
    acts.append(btn("Cancelar", "", m.close));
    m.body.append(lab, inp, msg, acts); inp.focus();
  }

  /* ---------- listar / abrir / eliminar ---------- */
  const fmt = v => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" }); };

  async function openOne(r, m, msg) {
    if (dirty() && !confirm("Abrir este proyecto reemplaza lo que hay ahora en el editor (podés volver con Deshacer). ¿Continuar?")) return;
    busy(m, true); msg.className = "cl-msg"; msg.textContent = "Abriendo…";
    try {
      const a = await getApi(), p = await a.loadProject(r.id), pd = p && p.project_data;
      if (!pd || typeof pd !== "object" || pd.app !== "marketweb" || pd.v !== 1) throw new Error("Este proyecto tiene un formato que el editor no reconoce.");
      ED.setProject(pd);
      current.id = p.id; current.title = String(p.title || ""); current.saved = snapshot(); updateStatus();
      ED.toast("Proyecto abierto: " + current.title); m.close();
    } catch (e) { busy(m, false); fail(msg, e); }
  }

  async function removeOne(r, rowEl, m, msg) {
    if (!confirm("¿Eliminar «" + r.title + "» de la nube? Esta acción no se puede deshacer.")) return;
    busy(m, true); msg.className = "cl-msg"; msg.textContent = "Eliminando…";
    try {
      const a = await getApi(); await a.deleteProject(r.id);
      rowEl.remove(); msg.textContent = "Proyecto eliminado.";
      if (current.id === r.id) { current.id = null; current.saved = null; }
      updateStatus(); busy(m, false);
      if (!m.body.querySelector(".cl-row")) msg.textContent = "Ya no quedan proyectos guardados en la nube.";
    } catch (e) { busy(m, false); fail(msg, e); }
  }

  async function openList() {
    const m = openModal("Mis proyectos en la nube"), msg = el("p", "cl-msg", "Cargando proyectos…"), list = el("div", "cl-list");
    m.body.append(msg, list, btn("Cerrar", "", m.close));
    let rows;
    try { const a = await getApi(); rows = await a.listProjects(); } catch (e) { fail(msg, e); return; }
    msg.textContent = rows.length ? "" : "Todavía no guardaste proyectos en la nube.";
    rows.forEach(r => {
      if (!r || typeof r.id !== "string") return;
      r.title = String(r.title || "Sin título");
      const row = el("div", "cl-row"), info = el("div", "cl-info");
      info.append(el("div", "cl-title", r.title + (r.id === current.id ? " (abierto)" : "")), el("div", "cl-date", "Modificado: " + fmt(r.updated_at)));
      row.append(info, btn("Abrir", "", () => openOne(r, m, msg)), btn("Eliminar", "danger", () => removeOne(r, row, m, msg)));
      list.append(row);
    });
  }

  $("cloudSaveBtn").addEventListener("click", openSave);
  $("cloudListBtn").addEventListener("click", openList);
})();
