// Se inyecta en la pestaña de claude.ai (mundo aislado). Expone globalThis.__EXPORTAR_CLAUDE__;
// el panel lateral invoca cada función con executeScript. Todo selector o texto de interfaz
// que dependa de la UI de Claude vive en CFG, para tener un único sitio que ajustar.
(() => {
  'use strict';

  const CFG = {
    scrollMaxIter: 80,
    scrollWaitMs: 600,
    sel: {
      usuario: '[data-testid="user-message"], .font-user-message, .whitespace-pre-wrap',
      claude: '.font-claude-response, .font-claude-message, [data-testid="assistant-message"], .prose',
      excluir: 'form, fieldset, textarea, [contenteditable="true"]',
    },
    // Idioma-agnóstico: acepta español e inglés.
    reDescargar: /download|descargar/i,
    reCerrar: /close|cerrar/i,
    reTipoArchivo: /\b(pdf|csv|txt|docx?|xlsx?|pptx?|json|md)\b/i,
    reTamano: /\b\d+(?:[.,]\d+)?\s?(?:kb|mb)\b/i,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(fn, timeout = 4000, paso = 100) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(paso);
    }
    return null;
  }

  // ---------- API interna ----------

  function idConversacion() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${url.split('?')[0]}`);
    return res.json();
  }

  async function organizacionesCandidatas() {
    const ids = [];
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/);
    if (m) ids.push(decodeURIComponent(m[1]));
    try {
      const orgs = await getJson('/api/organizations');
      for (const o of orgs) if (o && o.uuid && !ids.includes(o.uuid)) ids.push(o.uuid);
    } catch (e) { /* seguimos con lo que haya */ }
    return ids;
  }

  async function fetchConversationApi() {
    const conv = idConversacion();
    if (!conv) throw new Error('La pestaña activa no es una conversación (/chat/<id>).');
    let ultimoError = null;
    for (const org of await organizacionesCandidatas()) {
      try {
        const data = await getJson(
          `/api/organizations/${org}/chat_conversations/${conv}?tree=True&rendering_mode=messages&render_all_tools=true`
        );
        if (!data || !Array.isArray(data.chat_messages)) throw new Error('Respuesta sin chat_messages');
        return { org, data };
      } catch (e) { ultimoError = e; }
    }
    throw ultimoError || new Error('No se encontró una organización válida.');
  }

  // ---------- descarga binaria (con las cookies de la sesión) ----------

  async function fetchBinary(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const blob = await res.blob();
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      return { ok: true, type: blob.type || res.headers.get('content-type') || '', size: blob.size, b64 };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }

  // ---------- respaldo: lectura del DOM ----------

  function contenedorScroll() {
    const cands = [...document.querySelectorAll('main, main *')].filter((el) => {
      if (el.scrollHeight <= el.clientHeight + 40) return false;
      const o = getComputedStyle(el).overflowY;
      return o === 'auto' || o === 'scroll' || o === 'overlay';
    });
    cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return cands[0] || document.scrollingElement;
  }

  // Sube hasta que deja de cargar historial, para no exportar solo lo visible.
  async function scrollToTop() {
    const el = contenedorScroll();
    let estable = 0;
    let prev = -1;
    let iter = 0;
    while (iter++ < CFG.scrollMaxIter && estable < 3) {
      el.scrollTop = 0;
      await sleep(CFG.scrollWaitMs);
      if (el.scrollHeight === prev && el.scrollTop === 0) estable++; else estable = 0;
      prev = el.scrollHeight;
    }
    el.scrollTop = el.scrollHeight;
    return { iteraciones: iter - 1, altura: prev };
  }

  function htmlToText(root) {
    const out = [];
    const SALTAR = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'SVG', 'IMG', 'NOSCRIPT']);
    function celdas(tr) {
      return [...tr.children].map((c) => (c.innerText || '').trim().replace(/\s*\n\s*/g, ' ')).join(' | ');
    }
    function walk(n, enPre) {
      if (n.nodeType === 3) { out.push(enPre ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase();
      if (SALTAR.has(tag)) return;
      if (tag === 'PRE') {
        const code = n.querySelector('code');
        const lang = ((code && code.className.match(/language-([\w+-]+)/)) || [])[1] || '';
        out.push('\n\n```' + lang + '\n' + (code || n).textContent.replace(/\n$/, '') + '\n```\n\n');
        return;
      }
      if (tag === 'TR') { out.push('\n| ' + celdas(n) + ' |'); return; }
      if (tag === 'BR') { out.push('\n'); return; }
      if (tag === 'HR') { out.push('\n\n---\n\n'); return; }
      if (/^H[1-6]$/.test(tag)) { out.push('\n\n' + '#'.repeat(+tag[1]) + ' '); n.childNodes.forEach((c) => walk(c, false)); out.push('\n\n'); return; }
      if (tag === 'LI') {
        const ol = n.parentElement && n.parentElement.tagName === 'OL';
        const i = ol ? [...n.parentElement.children].indexOf(n) + 1 : 0;
        out.push('\n' + (ol ? i + '. ' : '- '));
        n.childNodes.forEach((c) => walk(c, false));
        return;
      }
      if (tag === 'A' && /^https?:/i.test(n.getAttribute('href') || '')) {
        out.push('[');
        n.childNodes.forEach((c) => walk(c, false));
        out.push(`](${n.getAttribute('href')})`);
        return;
      }
      if (tag === 'STRONG' || tag === 'B') { out.push('**'); n.childNodes.forEach((c) => walk(c, false)); out.push('**'); return; }
      if (tag === 'EM' || tag === 'I') { out.push('*'); n.childNodes.forEach((c) => walk(c, false)); out.push('*'); return; }
      if (tag === 'CODE') { out.push('`' + n.textContent + '`'); return; }
      const bloque = ['P', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE'].includes(tag);
      if (bloque) out.push('\n\n'); else if (tag === 'DIV') out.push('\n');
      n.childNodes.forEach((c) => walk(c, enPre));
      if (bloque) out.push('\n\n'); else if (tag === 'DIV') out.push('\n');
    }
    const preInicial = root.classList.contains('whitespace-pre-wrap') || /^pre/.test(getComputedStyle(root).whiteSpace);
    walk(root, preInicial);
    return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function esDocChip(el) {
    const t = (el.innerText || '').trim();
    return !!t && t.length < 120 && (CFG.reTipoArchivo.test(t) || CFG.reTamano.test(t));
  }

  function esImagenValida(img) {
    const src = img.currentSrc || img.src || '';
    if (!src || /avatar|profile|favicon/i.test(src)) return false;
    if ((img.naturalWidth && img.naturalWidth < 24) || (img.width && img.width < 24)) return false;
    const padre = img.closest('button, [role="button"], a');
    return !(padre && esDocChip(padre)); // miniaturas de documentos no son imágenes
  }

  function turnoDe(node, todos) {
    let el = node;
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      const p = el.parentElement;
      if (todos.some((o) => o !== node && p.contains(o))) break;
      el = p;
    }
    return el;
  }

  function extractDom() {
    const sel = `${CFG.sel.usuario}, ${CFG.sel.claude}`;
    const nodos = [...document.querySelectorAll(sel)].filter((n) => !n.closest(CFG.sel.excluir));
    const top = nodos.filter((n) => !nodos.some((p) => p !== n && p.contains(n)));
    const imagenesVistas = new Set();
    const mensajes = [];

    for (const nodo of top) {
      const esUsuario = nodo.matches(CFG.sel.usuario) && !nodo.matches(CFG.sel.claude);
      const rol = esUsuario ? 'Usuario' : 'Claude';
      const texto = htmlToText(nodo);
      const ambito = esUsuario ? turnoDe(nodo, top) : nodo;

      const imagenes = [];
      for (const img of ambito.querySelectorAll('img')) {
        if (img.closest(CFG.sel.excluir) || !esImagenValida(img)) continue;
        const url = img.currentSrc || img.src;
        if (imagenesVistas.has(url)) continue;
        imagenesVistas.add(url);
        imagenes.push({ url, alt: (img.alt || '').trim() || null });
      }

      const adjuntos = [];
      if (esUsuario) {
        for (const b of ambito.querySelectorAll('button, [role="button"]')) {
          if (b.closest(CFG.sel.excluir) || nodo.contains(b) || !esDocChip(b)) continue;
          const nombre = (b.innerText || '').split('\n')[0].trim();
          if (nombre && !adjuntos.includes(nombre)) adjuntos.push(nombre);
        }
      }

      if (!texto && !imagenes.length && !adjuntos.length) continue;
      const ult = mensajes[mensajes.length - 1];
      // Varios bloques consecutivos de Claude son un mismo turno; los del usuario no se funden.
      if (ult && ult.rol === 'Claude' && rol === 'Claude') {
        ult.texto = [ult.texto, texto].filter(Boolean).join('\n\n');
        ult.imagenes.push(...imagenes);
      } else {
        mensajes.push({ rol, texto, imagenes, adjuntos });
      }
    }
    return { titulo: document.title.replace(/\s*[-|–]\s*Claude\s*$/i, '').trim(), url: location.href, mensajes };
  }

  // ---------- robot de adjuntos (solo respaldo DOM) ----------

  async function scanAttachments() {
    const encontrados = [];
    const botones = [...document.querySelectorAll('button, [role="button"]')].filter(
      (b) => !b.closest(CFG.sel.excluir) && !b.closest('[role="dialog"]') && esDocChip(b)
    );
    const chips = botones.filter((n) => !botones.some((p) => p !== n && p.contains(n)));
    const usados = new Set();

    for (const chip of chips) {
      let nombre = (chip.innerText || '').split('\n')[0].trim();
      chip.scrollIntoView({ block: 'center' });
      await sleep(300);
      chip.click();

      const dialogo = await waitFor(() => document.querySelector('[role="dialog"]'), 4000);
      if (!dialogo) continue;

      const control = await waitFor(() => {
        return [...dialogo.querySelectorAll('a, button')].find((el) =>
          CFG.reDescargar.test(el.getAttribute('aria-label') || el.title || el.innerText || '')
        );
      }, 3000);

      const enlace = control && (control.closest('a') || control.querySelector('a'));
      const url = (enlace && enlace.href) || (control && control.href) || null;
      const titulo = dialogo.querySelector('h1, h2, h3');
      if (titulo && /\.\w{2,5}$/.test((titulo.innerText || '').trim())) nombre = titulo.innerText.trim();

      if (url) {
        let n = nombre || 'documento';
        for (let i = 2; usados.has(n); i++) n = `${nombre}_${i}`;
        usados.add(n);
        encontrados.push({ nombre: n, url });
      }

      const cerrar = [...dialogo.querySelectorAll('button')].find((b) => CFG.reCerrar.test(b.getAttribute('aria-label') || b.innerText || ''));
      if (cerrar) cerrar.click();
      else (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await waitFor(() => !document.querySelector('[role="dialog"]'), 2000);
    }
    return encontrados;
  }

  globalThis.__EXPORTAR_CLAUDE__ = { fetchConversationApi, fetchBinary, scrollToTop, extractDom, scanAttachments };
})();
