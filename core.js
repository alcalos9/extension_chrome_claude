// Lógica pura (sin chrome.* ni DOM): normaliza la conversación venga de la API interna
// o del DOM, y genera Markdown / nombres de archivo. Se prueba con `node tests/core.test.js`.
(function (root) {
  'use strict';

  const ROL_USUARIO = 'Usuario';
  const ROL_CLAUDE = 'Claude';

  // ---------- nombres de archivo ----------

  function quitarAcentos(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function nombreSeguro(s, max = 60, fallback = 'chat') {
    const t = quitarAcentos(s)
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .slice(0, max)
      .replace(/_+$/, '');
    return t || fallback;
  }

  // Conserva mayúsculas y extensión; solo neutraliza caracteres problemáticos.
  function nombreArchivoSeguro(nombre, fallback = 'archivo') {
    const base = String(nombre || '').split(/[\\/]/).pop();
    const m = base.match(/^(.*)\.([A-Za-z0-9]{1,6})$/);
    const stem = m ? m[1] : base;
    const ext = m ? m[2].toLowerCase() : '';
    const limpio = quitarAcentos(stem).replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
    return (limpio || fallback) + (ext ? '.' + ext : '');
  }

  function nombreUnico(usados, ruta) {
    if (!usados.has(ruta)) { usados.add(ruta); return ruta; }
    const m = ruta.match(/^(.*?)(\.[A-Za-z0-9]{1,6})?$/);
    for (let i = 2; ; i++) {
      const candidata = `${m[1]}_${i}${m[2] || ''}`;
      if (!usados.has(candidata)) { usados.add(candidata); return candidata; }
    }
  }

  const MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic',
    'application/pdf': 'pdf', 'text/csv': 'csv', 'text/plain': 'txt', 'text/markdown': 'md',
    'application/json': 'json', 'text/html': 'html',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  };

  function extDesdeMime(mime) {
    return MIME_EXT[String(mime || '').split(';')[0].trim().toLowerCase()] || '';
  }

  function tieneExtension(nombre) {
    return /\.[A-Za-z0-9]{1,6}$/.test(nombre || '');
  }

  // ---------- normalización: API interna de claude.ai ----------

  function absUrl(u, origin) {
    if (!u || typeof u !== 'string') return null;
    try { return new URL(u, origin).href; } catch (e) { return null; }
  }

  function aTexto(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x;
    if (Array.isArray(x)) return x.map(aTexto).filter(Boolean).join('\n');
    if (typeof x.text === 'string') return x.text;
    try { return JSON.stringify(x, null, 2); } catch (e) { return String(x); }
  }

  const RE_IMG_URL = /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:[?#]|$)/i;
  const CLAVES_IMG = /^(?:image_url|thumbnail_url|image|thumbnail|src|img_url|preview_url)$/i;

  // Los resultados de herramientas (p. ej. búsqueda de imágenes) no tienen un esquema fijo:
  // se recorren recursivamente buscando URLs que parezcan imágenes.
  function extraerImagenes(nodo, origin, acc = [], vistos = new Set(), prof = 0) {
    if (!nodo || prof > 8) return acc;
    const agregar = (u, titulo, fuente) => {
      const url = absUrl(u, origin);
      if (!url || !/^https?:/i.test(url) || vistos.has(url)) return;
      vistos.add(url);
      acc.push({ url, titulo: titulo || null, fuente: fuente || null });
    };
    if (Array.isArray(nodo)) { nodo.forEach((x) => extraerImagenes(x, origin, acc, vistos, prof + 1)); return acc; }
    if (typeof nodo !== 'object') return acc;
    const titulo = nodo.title || nodo.alt || nodo.name || null;
    const fuente = nodo.source_url || nodo.page_url || nodo.page || nodo.link || null;
    if (nodo.type === 'image') {
      const u = nodo.url || (nodo.source && nodo.source.url);
      if (typeof u === 'string') agregar(u, titulo, fuente);
    }
    for (const [k, v] of Object.entries(nodo)) {
      if (typeof v === 'string') {
        if (CLAVES_IMG.test(k) || (k === 'url' && RE_IMG_URL.test(v))) agregar(v, titulo, fuente);
      } else if (v && typeof v === 'object') {
        extraerImagenes(v, origin, acc, vistos, prof + 1);
      }
    }
    return acc;
  }

  function bloquesDe(content, origin) {
    if (!Array.isArray(content)) return [];
    const bloques = [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text') {
        if (b.text) bloques.push({ tipo: 'texto', texto: b.text });
      } else if (b.type === 'thinking') {
        if (b.thinking) bloques.push({ tipo: 'razonamiento', texto: b.thinking });
      } else if (b.type === 'tool_use') {
        const inp = b.input || {};
        if (b.name === 'artifacts') {
          bloques.push({
            tipo: 'artefacto', id: inp.id || null, titulo: inp.title || null,
            tipo_artefacto: inp.type || null, lenguaje: inp.language || null,
            comando: inp.command || null, contenido: inp.content || null,
            old_str: inp.old_str || null, new_str: inp.new_str || null,
          });
        } else {
          bloques.push({ tipo: 'herramienta', nombre: b.name || null, entrada: inp });
        }
      } else if (b.type === 'tool_result') {
        bloques.push({
          tipo: 'resultado_herramienta', nombre: b.name || null, texto: aTexto(b.content),
          imagenes: extraerImagenes(b.content, origin),
        });
      }
    }
    return bloques;
  }

  function candidatas(f, esImagen, origin) {
    const lista = [];
    const add = (u, calidad) => {
      const url = absUrl(u, origin);
      if (url && !lista.some((c) => c.url === url)) lista.push({ url, calidad });
    };
    if (esImagen) {
      add(f.image_asset && f.image_asset.url, 'original');
      add(f.preview_asset && f.preview_asset.url, 'vista_previa');
      add(f.preview_url, 'vista_previa');
    } else {
      add(f.document_asset && f.document_asset.url, 'original');
      add(f.download_url, 'original');
      add(f.preview_asset && f.preview_asset.url, 'vista_previa');
      add(f.preview_url, 'vista_previa');
    }
    add(f.thumbnail_asset && f.thumbnail_asset.url, 'miniatura');
    add(f.thumbnail_url, 'miniatura');
    return lista;
  }

  function adjuntosDe(m, origin) {
    const out = [];
    const vistos = new Set();
    for (const f of [...(m.files_v2 || []), ...(m.files || [])]) {
      if (!f) continue;
      const id = f.file_uuid || f.uuid || f.id || null;
      if (id) { if (vistos.has(id)) continue; vistos.add(id); }
      const mime = f.mime_type || f.file_type || '';
      const esImagen = f.file_kind === 'image' || /^image\//i.test(mime);
      out.push({
        clase: esImagen ? 'imagen' : 'documento',
        id,
        nombre: f.file_name || (esImagen ? 'imagen' : 'documento'),
        tipo: mime || f.file_kind || null,
        tamano: f.size_bytes != null ? f.size_bytes : (f.file_size != null ? f.file_size : null),
        urls: candidatas(f, esImagen, origin),
        texto_extraido: null,
      });
    }
    // `attachments` trae el texto extraído de documentos y los "pegados" largos.
    for (const a of m.attachments || []) {
      if (!a) continue;
      const nombre = a.file_name || 'adjunto';
      const existente = out.find((o) => o.clase === 'documento' && o.nombre === nombre && !o.texto_extraido);
      if (existente) {
        existente.texto_extraido = a.extracted_content || null;
        if (existente.tamano == null) existente.tamano = a.file_size != null ? a.file_size : null;
        if (!existente.tipo) existente.tipo = a.file_type || null;
      } else {
        out.push({
          clase: 'documento', id: a.id || null, nombre, tipo: a.file_type || null,
          tamano: a.file_size != null ? a.file_size : null, urls: [],
          texto_extraido: a.extracted_content || null,
        });
      }
    }
    return out;
  }

  // El árbol trae todas las ramas (ediciones/regeneraciones): nos quedamos con la activa.
  function ramaActual(msgs, hoja) {
    const porOrden = [...msgs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!hoja) return porOrden;
    const porId = new Map(msgs.map((m) => [m.uuid, m]));
    const cadena = [];
    const vistos = new Set();
    let cur = porId.get(hoja);
    while (cur && !vistos.has(cur.uuid)) {
      vistos.add(cur.uuid);
      cadena.push(cur);
      cur = porId.get(cur.parent_message_uuid);
    }
    return cadena.length ? cadena.reverse() : porOrden;
  }

  // Imágenes devueltas por herramientas (búsqueda web, etc.) como adjuntos del mensaje.
  function imagenesWeb(bloques) {
    const out = [];
    for (const b of bloques) {
      if (b.tipo !== 'resultado_herramienta') continue;
      for (const img of b.imagenes || []) {
        out.push({
          clase: 'imagen', id: null, nombre: img.titulo ? String(img.titulo).slice(0, 60) : `imagen_web_${out.length + 1}`,
          tipo: null, tamano: null, origen: 'web', fuente: img.fuente,
          urls: [{ url: img.url, calidad: 'original' }], texto_extraido: null,
        });
      }
    }
    return out;
  }

  function normalizarMensajeApi(m, indice, origin) {
    const bloques = bloquesDe(m.content, origin);
    let texto = bloques.filter((b) => b.tipo === 'texto').map((b) => b.texto).join('\n\n').trim();
    if (!texto && typeof m.text === 'string') texto = m.text.trim();
    return {
      indice,
      id: m.uuid || null,
      rol: m.sender === 'human' ? ROL_USUARIO : ROL_CLAUDE,
      fecha: m.created_at || null,
      texto,
      bloques,
      adjuntos: adjuntosDe(m, origin).concat(imagenesWeb(bloques)),
    };
  }

  function normalizarApi(raw, ctx = {}) {
    const origin = ctx.origin || 'https://claude.ai';
    const todos = Array.isArray(raw && raw.chat_messages) ? raw.chat_messages : [];
    const rama = ramaActual(todos, raw.current_leaf_message_uuid);
    return {
      id: raw.uuid || null,
      titulo: raw.name || 'Sin título',
      creada: raw.created_at || null,
      actualizada: raw.updated_at || null,
      modelo: raw.model || null,
      origen: 'api',
      organizacion: ctx.org || null,
      mensajes_en_arbol: todos.length,
      mensajes: rama.map((m, i) => normalizarMensajeApi(m, i + 1, origin)),
      archivos_sin_asignar: [],
    };
  }

  // ---------- normalización: lectura del DOM (respaldo) ----------

  function normalizarDom(raw) {
    const mensajes = (raw.mensajes || []).map((m, i) => {
      const adjuntos = [];
      (m.imagenes || []).forEach((img, k) => {
        adjuntos.push({
          clase: 'imagen', id: null, nombre: img.alt || `imagen_${i + 1}_${k + 1}`, tipo: null, tamano: null,
          urls: [{ url: img.url, calidad: 'original' }], texto_extraido: null,
        });
      });
      (m.adjuntos || []).forEach((nombre) => {
        adjuntos.push({ clase: 'documento', id: null, nombre, tipo: null, tamano: null, urls: [], texto_extraido: null });
      });
      return {
        indice: i + 1, id: null, rol: m.rol === 'Usuario' ? ROL_USUARIO : ROL_CLAUDE, fecha: null,
        texto: (m.texto || '').trim(), bloques: [], adjuntos,
      };
    });
    return {
      id: null, titulo: raw.titulo || 'Sin título', creada: null, actualizada: null, modelo: null,
      origen: 'dom', organizacion: null, mensajes_en_arbol: mensajes.length, mensajes,
      archivos_sin_asignar: [],
    };
  }

  // ---------- artefactos ----------

  const EXT_LENGUAJE = {
    python: 'py', javascript: 'js', typescript: 'ts', html: 'html', css: 'css', json: 'json', bash: 'sh',
    shell: 'sh', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', ruby: 'rb', php: 'php',
    sql: 'sql', yaml: 'yml', markdown: 'md', jsx: 'jsx', tsx: 'tsx', swift: 'swift', kotlin: 'kt',
  };

  function extArtefacto(a) {
    const t = a.tipo_artefacto || '';
    if (t === 'text/html') return 'html';
    if (t === 'text/markdown') return 'md';
    if (t === 'image/svg+xml') return 'svg';
    if (t === 'application/vnd.ant.mermaid') return 'mmd';
    if (t === 'application/vnd.ant.react') return 'jsx';
    if (t === 'application/vnd.ant.code') return EXT_LENGUAJE[String(a.lenguaje || '').toLowerCase()] || 'txt';
    return 'txt';
  }

  // Versión final de cada artefacto tras aplicar create / rewrite / update en orden.
  function artefactosFinales(conv) {
    const porId = new Map();
    for (const m of conv.mensajes) {
      for (const b of m.bloques) {
        if (b.tipo !== 'artefacto' || !b.id) continue;
        const prev = porId.get(b.id) || { id: b.id, titulo: b.titulo, tipo_artefacto: b.tipo_artefacto, lenguaje: b.lenguaje, contenido: '', mensaje: m.indice };
        if (b.titulo) prev.titulo = b.titulo;
        if (b.tipo_artefacto) prev.tipo_artefacto = b.tipo_artefacto;
        if (b.lenguaje) prev.lenguaje = b.lenguaje;
        if (b.comando === 'update' && b.old_str != null) {
          prev.contenido = prev.contenido.replace(b.old_str, b.new_str || '');
        } else if (b.contenido != null) {
          prev.contenido = b.contenido;
        }
        porId.set(b.id, prev);
      }
    }
    return [...porId.values()].filter((a) => a.contenido);
  }

  // ---------- Markdown ----------

  function formatoTamano(n) {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function fencia(texto, lenguaje) {
    const largo = Math.max(3, ...((texto.match(/`+/g) || []).map((s) => s.length + 1)));
    const f = '`'.repeat(largo);
    return `${f}${lenguaje || ''}\n${texto}\n${f}`;
  }

  function construirMarkdown(conv, opciones = {}) {
    const L = [];
    const finales = new Map(artefactosFinales(conv).map((a) => [a.id, a]));
    const ultimoBloque = new Map();
    for (const m of conv.mensajes) for (const b of m.bloques) if (b.tipo === 'artefacto' && b.id) ultimoBloque.set(b.id, b);
    L.push(`# ${conv.titulo}`, '');
    if (conv.id) L.push(`- ID: \`${conv.id}\``);
    if (conv.creada) L.push(`- Creada: ${conv.creada}`);
    if (conv.actualizada) L.push(`- Última actualización: ${conv.actualizada}`);
    L.push(`- Mensajes: ${conv.mensajes.length}`, '', '---', '');

    for (const m of conv.mensajes) {
      const icono = m.rol === ROL_USUARIO ? '👤' : '🤖';
      L.push(`## ${icono} ${m.rol} · #${m.indice}${m.fecha ? ' · ' + m.fecha : ''}`, '');

      if (m.adjuntos.length) {
        L.push('**Adjuntos:**', '');
        for (const a of m.adjuntos) {
          const meta = [a.tipo, formatoTamano(a.tamano)].filter(Boolean).join(', ');
          if (a.clase === 'imagen' && a.archivo) {
            L.push(`- 🖼️ ${a.nombre}${meta ? ' (' + meta + ')' : ''}`, `  ![${a.nombre}](${encodeURI(a.archivo)})`);
          } else {
            const enlaces = [];
            if (a.archivo) enlaces.push(`[archivo${a.solo_vista_previa ? ' (solo vista previa)' : ''}](${encodeURI(a.archivo)})`);
            if (a.archivo_texto) enlaces.push(`[texto extraído](${encodeURI(a.archivo_texto)})`);
            const icono2 = a.clase === 'imagen' ? '🖼️' : '📎';
            L.push(`- ${icono2} ${a.nombre}${meta ? ' (' + meta + ')' : ''}${enlaces.length ? ' — ' + enlaces.join(' · ') : ''}${a.error ? ' ⚠️ ' + a.error : ''}`);
          }
        }
        L.push('');
      }

      if (opciones.incluirRazonamiento) {
        for (const b of m.bloques) {
          if (b.tipo === 'razonamiento') L.push('<details><summary>Razonamiento</summary>', '', b.texto, '', '</details>', '');
          else if (b.tipo === 'herramienta') L.push(`> 🔧 Herramienta \`${b.nombre}\`: ${JSON.stringify(b.entrada)}`, '');
          else if (b.tipo === 'resultado_herramienta') L.push('<details><summary>Resultado de herramienta</summary>', '', fencia(b.texto), '', '</details>', '');
        }
      }

      if (m.texto) L.push(m.texto, '');

      for (const b of m.bloques) {
        if (b.tipo !== 'artefacto') continue;
        // Con id: se muestra la versión final una sola vez, en el último bloque que lo toca.
        const final = b.id ? finales.get(b.id) : null;
        if (final && ultimoBloque.get(b.id) !== b) continue;
        const contenido = final ? final.contenido : b.contenido;
        if (!contenido) continue;
        const titulo = (final && final.titulo) || b.titulo || b.id || '';
        L.push(`**Artefacto:** ${titulo}`, '', fencia(contenido, b.lenguaje || (final && final.lenguaje) || extArtefacto(final || b)), '');
      }
      L.push('---', '');
    }
    return L.join('\n');
  }

  const api = {
    ROL_USUARIO, ROL_CLAUDE, nombreSeguro, nombreArchivoSeguro, nombreUnico, extDesdeMime, tieneExtension,
    normalizarApi, normalizarDom, ramaActual, artefactosFinales, extArtefacto, construirMarkdown, formatoTamano,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
