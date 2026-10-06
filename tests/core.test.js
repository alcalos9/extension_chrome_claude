// Ejecutar: node tests/core.test.js
const assert = require('assert');
const Core = require('../core.js');

const raw = {
  uuid: 'c1', name: 'Análisis de contrato', created_at: '2025-01-01T10:00:00Z', updated_at: '2025-01-01T10:05:00Z',
  current_leaf_message_uuid: 'm4',
  chat_messages: [
    { uuid: 'm1', index: 0, sender: 'human', parent_message_uuid: 'root', created_at: '2025-01-01T10:00:00Z',
      content: [{ type: 'text', text: 'Revisa este PDF' }],
      attachments: [{ id: 'a1', file_name: 'contrato.pdf', file_type: 'pdf', file_size: 2048, extracted_content: 'CLÁUSULA 1…' },
                    { id: 'a2', file_name: 'Pasted content', file_type: 'txt', file_size: 10, extracted_content: 'pegado' }],
      files_v2: [
        { file_uuid: 'f1', file_kind: 'document', file_name: 'contrato.pdf', preview_url: '/api/o/files/f1/preview', thumbnail_url: '/api/o/files/f1/thumb', document_asset: { url: '/api/o/files/f1/doc' } },
        { file_uuid: 'f2', file_kind: 'image', file_name: 'foto.png', preview_asset: { url: '/api/o/files/f2/preview' }, thumbnail_url: '/api/o/files/f2/thumb' },
      ], files: [{ file_uuid: 'f2', file_kind: 'image', file_name: 'foto.png' }] },
    { uuid: 'm2', index: 1, sender: 'assistant', parent_message_uuid: 'm1', content: [{ type: 'text', text: 'Primera versión' }] },
    { uuid: 'm3', index: 2, sender: 'assistant', parent_message_uuid: 'm1', content: [{ type: 'text', text: 'Rama regenerada (descartada)' }] },
    { uuid: 'm4', index: 3, sender: 'assistant', parent_message_uuid: 'm1', created_at: '2025-01-01T10:01:00Z', content: [
      { type: 'thinking', thinking: 'pienso' },
      { type: 'text', text: 'Aquí va el análisis.' },
      { type: 'tool_use', name: 'artifacts', input: { id: 'art1', command: 'create', type: 'application/vnd.ant.code', language: 'python', title: 'Script', content: 'print(1)' } },
      { type: 'tool_use', name: 'artifacts', input: { id: 'art1', command: 'update', old_str: '1', new_str: '2' } },
    ] },
  ],
};

const conv = Core.normalizarApi(raw, { org: 'o', origin: 'https://claude.ai' });
assert.strictEqual(conv.mensajes.length, 2, 'solo la rama activa (m1 → m4)');
assert.strictEqual(conv.mensajes_en_arbol, 4);
assert.deepStrictEqual(conv.mensajes.map((m) => m.rol), ['Usuario', 'Claude']);
assert.strictEqual(conv.mensajes[1].texto, 'Aquí va el análisis.');

const adj = conv.mensajes[0].adjuntos;
assert.strictEqual(adj.length, 3, 'pdf + imagen (sin duplicar) + texto pegado');
const pdf = adj.find((a) => a.nombre === 'contrato.pdf');
assert.strictEqual(pdf.texto_extraido, 'CLÁUSULA 1…', 'attachments se fusiona con files_v2');
assert.strictEqual(pdf.urls[0].calidad, 'original');
assert.ok(pdf.urls[0].url.startsWith('https://claude.ai/api/o/files/f1/doc'));
assert.strictEqual(adj.find((a) => a.clase === 'imagen').urls[0].calidad, 'vista_previa');
assert.strictEqual(adj.find((a) => a.nombre === 'Pasted content').urls.length, 0);

const arts = Core.artefactosFinales(conv);
assert.strictEqual(arts.length, 1);
assert.strictEqual(arts[0].contenido, 'print(2)', 'update aplicado sobre create');
assert.strictEqual(Core.extArtefacto(arts[0]), 'py');

const md = Core.construirMarkdown(conv, { incluirRazonamiento: true });
assert.ok(md.includes('## 👤 Usuario · #1'));
assert.ok(md.includes('## 🤖 Claude · #2'));
assert.ok(md.includes('pienso') && md.includes('print(2)'));

assert.strictEqual(Core.nombreSeguro('¡Análisis: contrato 2025!'), 'analisis_contrato_2025');
assert.strictEqual(Core.nombreArchivoSeguro('Mi Contrato Ñandú (final).PDF'), 'Mi_Contrato_Nandu_final.pdf');
assert.strictEqual(Core.nombreArchivoSeguro('../../etc/passwd'), 'passwd');
const usados = new Set();
assert.strictEqual(Core.nombreUnico(usados, 'a/x.png'), 'a/x.png');
assert.strictEqual(Core.nombreUnico(usados, 'a/x.png'), 'a/x_2.png');
assert.strictEqual(Core.extDesdeMime('image/webp; charset=x'), 'webp');

const dom = Core.normalizarDom({ titulo: 'T', mensajes: [
  { rol: 'Usuario', texto: 'hola', imagenes: [{ url: 'https://x/y.png' }], adjuntos: ['a.pdf'] },
  { rol: 'Claude', texto: 'qué tal', imagenes: [], adjuntos: [] }] });
assert.strictEqual(dom.mensajes[0].adjuntos.length, 2);
assert.strictEqual(dom.mensajes[1].rol, 'Claude');

console.log('core.test.js: OK');
