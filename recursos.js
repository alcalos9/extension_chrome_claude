// Proyectos y skills de claude.ai. Lógica pura: recibe un «contexto» (ctx) que sabe consultar la página:
//   ctx.org, ctx.origin
//   ctx.consultar(urls)  → { url, data }  (primera URL que responde JSON; lanza si ninguna)
//   ctx.listar(urlBase)  → array          (recorre la paginación)
//   ctx.binario(urls)    → { url, type, b64 } | null   (primera respuesta binaria/zip)
// Los endpoints internos no son públicos: cada operación prueba varias rutas y registra lo que falla
// en `errores`, y siempre conserva la respuesta cruda en `crudo` para poder ajustar el formato.
// Pruebas: `node tests/recursos.test.js`.
(function (root) {
  'use strict';

  const pick = (o, ...claves) => {
    for (const k of claves) if (o && o[k] != null && o[k] !== '') return o[k];
    return null;
  };

  // Acepta [..], {projects:[..]}, {data:[..]}, o cualquier objeto con un único array.
  function lista(data, claves) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const k of claves) if (Array.isArray(data[k])) return data[k];
    const arrays = Object.values(data).filter(Array.isArray);
    return arrays.length === 1 ? arrays[0] : [];
  }

  function absUrl(u, origin) {
    if (!u || typeof u !== 'string') return null;
    try { return new URL(u, origin).href; } catch (e) { return null; }
  }

  // Archivo subido a un proyecto → mismo formato de «adjunto» que usan las conversaciones.
  function adjuntoDeArchivo(f, origin) {
    const id = pick(f, 'file_uuid', 'uuid', 'id');
    const mime = pick(f, 'mime_type', 'file_type') || '';
    const esImagen = f.file_kind === 'image' || /^image\//i.test(mime);
    const urls = [];
    const add = (u, calidad) => {
      const url = absUrl(u, origin);
      if (url && !urls.some((c) => c.url === url)) urls.push({ url, calidad });
    };
    add(f.document_asset && f.document_asset.url, 'original');
    add(f.image_asset && f.image_asset.url, 'original');
    add(f.download_url, 'original');
    add(f.preview_asset && f.preview_asset.url, 'vista_previa');
    add(f.preview_url, 'vista_previa');
    add(f.thumbnail_url, 'miniatura');
    return {
      clase: esImagen ? 'imagen' : 'documento', id, nombre: pick(f, 'file_name', 'name') || (esImagen ? 'imagen' : 'documento'),
      tipo: mime || f.file_kind || null, tamano: pick(f, 'size_bytes', 'file_size', 'size'), urls, ref: null, texto_extraido: null,
    };
  }

  // ---------- proyectos ----------

  const proyectos = {
    urlsLista: (org) => [
      `/api/organizations/${org}/projects?include_harmony_projects=true&limit=100`,
      `/api/organizations/${org}/projects`,
    ],

    normalizarLista(data) {
      return lista(data, ['projects', 'data', 'items', 'results'])
        .map((p) => ({
          id: pick(p, 'uuid', 'id'),
          nombre: pick(p, 'name', 'title') || 'Sin nombre',
          descripcion: pick(p, 'description') || '',
          archivado: !!pick(p, 'archived_at', 'is_archived'),
          creado: pick(p, 'created_at'),
          actualizado: pick(p, 'updated_at'),
          raw: p,
        }))
        .filter((p) => p.id);
    },

    async listar(ctx) {
      const r = await ctx.consultar(this.urlsLista(ctx.org));
      return { fuente: r.url, items: this.normalizarLista(r.data) };
    },

    async cargar(ctx, item) {
      const org = ctx.org;
      const base = `/api/organizations/${org}/projects/${item.id}`;
      const out = {
        id: item.id, nombre: item.nombre, descripcion: item.descripcion || '', instrucciones: '',
        creado: item.creado || null, actualizado: item.actualizado || null,
        docs: [], archivos: [], conversaciones: [], errores: [], crudo: { lista: item.raw || null },
      };
      const intentar = async (etiqueta, fn) => {
        try { return await fn(); } catch (e) { out.errores.push(`${etiqueta}: ${e.message}`); return null; }
      };

      const det = await intentar('detalle del proyecto', () => ctx.consultar([base]));
      if (det) {
        out.crudo.detalle = det.data;
        out.instrucciones = pick(det.data, 'prompt_template', 'instructions', 'custom_instructions') || '';
        out.descripcion = pick(det.data, 'description') || out.descripcion;
      }

      const docs = await intentar('documentos del proyecto', () => ctx.consultar([`${base}/docs`]));
      if (docs) {
        out.crudo.docs = docs.data;
        out.docs = lista(docs.data, ['docs', 'documents', 'data', 'items']).map((d) => ({
          nombre: pick(d, 'file_name', 'name', 'title') || 'documento', contenido: pick(d, 'content', 'text') || '', creado: pick(d, 'created_at'),
        }));
      }

      const files = await intentar('archivos del proyecto', () => ctx.consultar([`${base}/files`]));
      if (files) {
        out.crudo.files = files.data;
        out.archivos = lista(files.data, ['files', 'data', 'items']).filter(Boolean).map((f) => adjuntoDeArchivo(f, ctx.origin));
      }

      // Conversaciones: endpoint del proyecto y, si no existe, filtro sobre la lista global.
      let convs = null;
      let errDirecto = null;
      try {
        const directo = await ctx.consultar([`${base}/conversations`]);
        convs = lista(directo.data, ['conversations', 'chats', 'data', 'items']);
      } catch (e) { errDirecto = `conversaciones del proyecto: ${e.message}`; }
      if (!convs || !convs.length) {
        const todas = await intentar('lista global de conversaciones', () => ctx.listar(`/api/organizations/${org}/chat_conversations`));
        if (todas) convs = todas.filter((c) => pick(c, 'project_uuid') === item.id || (c.project && c.project.uuid === item.id));
        // El fallo del endpoint directo solo importa si tampoco apareció nada por la lista global.
        if (errDirecto && !(convs && convs.length)) out.errores.push(errDirecto);
      }
      out.conversaciones = (convs || []).map((c) => ({ id: pick(c, 'uuid', 'id'), titulo: pick(c, 'name', 'title') || 'Sin título', creada: pick(c, 'created_at'), actualizada: pick(c, 'updated_at') })).filter((c) => c.id);
      return out;
    },
  };

  // ---------- skills ----------

  function esDeAnthropic(s) {
    if (s.is_public === true || s.is_anthropic === true) return true;
    return /anthropic|public|example|system|builtin/i.test(String(pick(s, 'type', 'source', 'creator_type', 'visibility', 'scope') || ''));
  }

  // Un skill es un ZIP con SKILL.md (+ archivos). Si el servidor no entrega el ZIP, se reconstruye de los campos.
  function reconstruirArchivosSkill(obj, nombre, descripcion) {
    const candidatos = [obj, obj && obj.skill, obj && obj.latest_version, obj && obj.version, obj && obj.current_version].filter((x) => x && typeof x === 'object');
    for (const o of candidatos) {
      const files = ['files', 'contents', 'skill_files', 'file_contents'].map((k) => o[k]).find(Array.isArray);
      if (files) {
        const archivos = files
          .map((f) => ({ ruta: pick(f, 'path', 'name', 'file_name', 'filename'), contenido: pick(f, 'content', 'text', 'body') }))
          .filter((f) => f.ruta && typeof f.contenido === 'string');
        if (archivos.length) return archivos;
      }
      const md = pick(o, 'skill_md', 'skill_md_content', 'skill_markdown', 'instructions', 'content', 'body');
      if (typeof md === 'string' && md.trim()) {
        const conCabecera = /^---\s*\n[\s\S]*?\n---/.test(md)
          ? md
          : `---\nname: ${nombre}\ndescription: ${String(descripcion || '').replace(/\n/g, ' ')}\n---\n\n${md}`;
        return [{ ruta: 'SKILL.md', contenido: conCabecera }];
      }
    }
    return [];
  }

  const skills = {
    urlsLista: (org) => [
      `/api/organizations/${org}/skills/list-skills?include_public_skills=true`,
      `/api/organizations/${org}/skills/list-skills`,
      `/api/organizations/${org}/skills`,
      `/api/organizations/${org}/skills/list`,
    ],

    normalizarLista(data) {
      return lista(data, ['skills', 'data', 'items', 'results'])
        .map((s) => {
          const id = pick(s, 'skill_id', 'id', 'uuid', 'name');
          return {
            id,
            nombre: pick(s, 'name', 'display_name', 'title') || String(id || ''),
            descripcion: pick(s, 'description', 'summary') || '',
            tipo: esDeAnthropic(s) ? 'anthropic' : 'personal',
            habilitado: pick(s, 'enabled', 'is_enabled'),
            actualizado: pick(s, 'updated_at', 'created_at'),
            raw: s,
          };
        })
        .filter((s) => s.id);
    },

    async listar(ctx) {
      const r = await ctx.consultar(this.urlsLista(ctx.org));
      return { fuente: r.url, items: this.normalizarLista(r.data) };
    },

    async cargar(ctx, item) {
      const org = ctx.org;
      const base = `/api/organizations/${org}/skills/${encodeURIComponent(item.id)}`;
      const out = { id: item.id, nombre: item.nombre, descripcion: item.descripcion, tipo: item.tipo, zipB64: null, archivos: [], errores: [], crudo: { lista: item.raw || null } };

      try {
        const bin = await ctx.binario([`${base}/download`, `${base}/download-skill`, `${base}/export`]);
        if (bin) { out.zipB64 = bin.b64; out.crudo.zip = { url: bin.url, type: bin.type }; }
      } catch (e) { out.errores.push(`descarga del ZIP: ${e.message}`); }

      let detalle = null;
      try {
        const r = await ctx.consultar([base, `${base}/versions`, `${base}/files`]);
        detalle = r.data;
        out.crudo.detalle = r.data;
      } catch (e) { if (!out.zipB64) out.errores.push(`detalle del skill: ${e.message}`); }

      if (!out.zipB64) {
        out.archivos = reconstruirArchivosSkill(detalle, item.nombre, item.descripcion);
        if (!out.archivos.length) out.archivos = reconstruirArchivosSkill(item.raw, item.nombre, item.descripcion);
        if (!out.archivos.length) out.errores.push('no se encontró el contenido del skill (ni ZIP ni SKILL.md); solo se guardan sus metadatos');
      }
      return out;
    },
  };

  // ---------- documentos de salida ----------

  function construirLeemeProyecto(p) {
    const L = [`# ${p.nombre}`, ''];
    if (p.descripcion) L.push(p.descripcion, '');
    if (p.creado) L.push(`- Creado: ${p.creado}`);
    if (p.actualizado) L.push(`- Actualizado: ${p.actualizado}`);
    L.push('', '## Instrucciones del proyecto', '', p.instrucciones ? p.instrucciones : '_(sin instrucciones)_', '');
    L.push('## Conocimiento', '');
    if (!p.docs.length && !p.archivos.length) L.push('_(vacío)_');
    p.docs.forEach((d) => L.push(`- 📄 ${d.nombre}${d.ruta ? ` — [abrir](${encodeURI(d.ruta)})` : ''}`));
    p.archivos.forEach((a) => L.push(`- 📎 ${a.nombre}${a.archivo ? ` — [abrir](${encodeURI(a.archivo)})` : ''}${a.error ? ` ⚠️ ${a.error}` : ''}`));
    L.push('', '## Conversaciones', '');
    if (!p.conversaciones.length) L.push('_(ninguna)_');
    p.conversaciones.forEach((c) => L.push(`- ${c.titulo}${c.creada ? ` (${String(c.creada).slice(0, 10)})` : ''}${c.carpeta ? ` — [abrir](${encodeURI(c.carpeta + '/conversacion.md')})` : ''}`));
    return L.join('\n') + '\n';
  }

  // Rutas a sondear con el botón de diagnóstico (solo se registran estado y forma, nunca contenido).
  function urlsDiagnostico(org, { proyectoId, skillId } = {}) {
    const urls = [...proyectos.urlsLista(org), ...skills.urlsLista(org), `/api/organizations/${org}/chat_conversations?limit=2`];
    if (proyectoId) {
      const b = `/api/organizations/${org}/projects/${proyectoId}`;
      urls.push(b, `${b}/docs`, `${b}/files`, `${b}/conversations`);
    }
    if (skillId) {
      const b = `/api/organizations/${org}/skills/${encodeURIComponent(skillId)}`;
      urls.push(b, `${b}/versions`, `${b}/files`, `${b}/download`);
    }
    return urls;
  }

  const api = { urlsDiagnostico, proyectos, skills, reconstruirArchivosSkill, construirLeemeProyecto, lista, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Recursos = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
