// Ejecutar: node tests/recursos.test.js
const assert = require('assert');
const JSZip = require('../vendor/jszip.min.js');
const R = require('../recursos.js');

(async () => {
  // ---- lista de proyectos (varias formas de respuesta) ----
  const a = R.proyectos.normalizarLista({ projects: [{ uuid: 'p1', name: 'Consulting', description: 'D', archived_at: null }, { uuid: 'p2', name: 'Viejo', archived_at: '2025-01-01' }, { name: 'sin id' }] });
  assert.deepStrictEqual(a.map((p) => [p.id, p.nombre, p.archivado]), [['p1', 'Consulting', false], ['p2', 'Viejo', true]]);
  assert.strictEqual(R.proyectos.normalizarLista([{ id: 'x', title: 'T' }])[0].nombre, 'T');
  assert.deepStrictEqual(R.proyectos.normalizarLista(null), []);

  // ---- cargar proyecto con un ctx simulado ----
  const rutas = {
    '/api/organizations/o/projects/p1': { uuid: 'p1', prompt_template: 'Responde en español', description: 'Desc nueva' },
    '/api/organizations/o/projects/p1/docs': [{ uuid: 'd1', file_name: 'notas.md', content: '# Notas', created_at: '2025-01-02' }],
    '/api/organizations/o/projects/p1/files': { files: [{ file_uuid: 'f1', file_name: 'contrato.pdf', file_kind: 'document', document_asset: { url: '/api/o/f1/doc' }, preview_url: '/api/o/f1/prev' }] },
  };
  const ctx = {
    org: 'o', origin: 'https://claude.ai',
    async consultar(urls) {
      for (const u of urls) if (rutas[u]) return { url: u, data: rutas[u] };
      throw new Error('HTTP 404 en ' + urls[0]);
    },
    async listar() { return [{ uuid: 'c1', name: 'Chat A', project_uuid: 'p1', created_at: '2025-02-01' }, { uuid: 'c2', name: 'Otro', project_uuid: 'pX' }, { uuid: 'c3', name: 'Chat B', project: { uuid: 'p1' } }]; },
    async binario() { return null; },
  };
  const p = await R.proyectos.cargar(ctx, a[0]);
  assert.strictEqual(p.instrucciones, 'Responde en español');
  assert.strictEqual(p.descripcion, 'Desc nueva');
  assert.deepStrictEqual(p.docs.map((d) => [d.nombre, d.contenido]), [['notas.md', '# Notas']]);
  assert.strictEqual(p.archivos[0].urls[0].url, 'https://claude.ai/api/o/f1/doc');
  assert.strictEqual(p.archivos[0].urls[0].calidad, 'original');
  assert.deepStrictEqual(p.conversaciones.map((c) => c.id), ['c1', 'c3'], 'sin endpoint directo, filtra la lista global por proyecto');
  assert.strictEqual(p.errores.length, 0, 'si la lista global resuelve, el 404 del endpoint directo no es una incidencia');
  const sinNada = await R.proyectos.cargar({ ...ctx, async listar() { return []; } }, a[0]);
  assert.ok(sinNada.errores.some((e) => /conversaciones del proyecto/.test(e)), 'si no aparece nada, sí se informa');
  const md = R.construirLeemeProyecto({ ...p, docs: [{ ...p.docs[0], ruta: 'conocimiento/notas.md' }] });
  assert.ok(md.includes('# Consulting') && md.includes('Responde en español') && md.includes('conocimiento/notas.md') && md.includes('Chat A'));

  // ---- skills ----
  const lista = R.skills.normalizarLista({ skills: [
    { skill_id: 's1', name: 'informe-ejecutivo', description: 'Hace informes', enabled: true },
    { id: 's2', display_name: 'pdf', type: 'anthropic' },
    { id: 's3', name: 'publico', is_public: true }] });
  assert.deepStrictEqual(lista.map((s) => [s.id, s.nombre, s.tipo]), [['s1', 'informe-ejecutivo', 'personal'], ['s2', 'pdf', 'anthropic'], ['s3', 'publico', 'anthropic']]);

  // con ZIP descargable
  const z = new JSZip();
  z.file('informe-ejecutivo/SKILL.md', '---\nname: informe-ejecutivo\n---\nPasos');
  const b64 = await z.generateAsync({ type: 'base64' });
  const ctxZip = { org: 'o', async consultar() { throw new Error('HTTP 404'); }, async binario(urls) { assert.ok(urls[0].endsWith('/skills/s1/download')); return { url: urls[0], type: 'application/zip', b64 }; } };
  const s1 = await R.skills.cargar(ctxZip, lista[0]);
  assert.strictEqual(s1.zipB64, b64);
  assert.strictEqual(s1.archivos.length, 0);
  assert.strictEqual(s1.errores.length, 0, 'con ZIP, el fallo del detalle no es una incidencia');

  // sin ZIP: reconstruye desde el detalle JSON
  const ctxJson = { org: 'o', async binario() { return null; }, async consultar() { return { url: 'x', data: { skill: { name: 'x', files: [{ path: 'SKILL.md', content: '---\nname: x\n---\nhola' }, { path: 'scripts/run.py', content: 'print(1)' }] } } }; } };
  const s2 = await R.skills.cargar(ctxJson, lista[0]);
  assert.deepStrictEqual(s2.archivos.map((f) => f.ruta), ['SKILL.md', 'scripts/run.py']);

  // sin ZIP ni archivos: solo texto de instrucciones → SKILL.md con cabecera
  const arch = R.reconstruirArchivosSkill({ instructions: 'Haz esto' }, 'mi-skill', 'Descripción\nlarga');
  assert.strictEqual(arch[0].ruta, 'SKILL.md');
  assert.ok(arch[0].contenido.startsWith('---\nname: mi-skill\ndescription: Descripción larga\n---'));
  assert.deepStrictEqual(R.reconstruirArchivosSkill({ id: 'solo metadatos' }, 'x', ''), []);

  // nada recuperable: se avisa pero no se rompe
  const ctxNada = { org: 'o', async binario() { return null; }, async consultar() { throw new Error('HTTP 404'); } };
  const s3 = await R.skills.cargar(ctxNada, { id: 's9', nombre: 'raro', descripcion: '', raw: {} });
  assert.ok(s3.errores.some((e) => /no se encontró el contenido/.test(e)));

  const diag = R.urlsDiagnostico('o', { proyectoId: 'p1', skillId: 's1' });
  assert.ok(diag.some((u) => u.endsWith('/projects/p1/docs')) && diag.some((u) => u.endsWith('/skills/s1/download')));

  console.log('recursos.test.js: OK');
})().catch((e) => { console.error(e); process.exit(1); });
