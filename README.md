# Exportar Chats Claude

Extensión de Chrome (Manifest V3, Chrome ≥ 116) que exporta una conversación de claude.ai a un ZIP:

```
<titulo>/
  conversacion.json   datos estructurados: rol, fecha, texto, bloques y adjuntos por mensaje
  conversacion.md     versión legible, con quién escribe cada mensaje y enlaces a los archivos
  imagenes/           msg003_usuario_foto.png …   (prefijo = nº de mensaje + autor)
  archivos/           documentos originales + «.extraido.txt» con el texto que Claude leyó
  artefactos/         versión final de cada artefacto
  informe.txt         incidencias (descargas fallidas, solo vista previa, etc.)
  debug/api_raw.json  respuesta cruda de la API (para diagnosticar cambios de formato)
```

## Uso
1. Instala: `chrome://extensions` → Modo desarrollador → *Cargar descomprimida* → esta carpeta.
2. Abre una conversación en claude.ai y pulsa el icono: se abre el panel lateral.
3. **Capturar conversación** → revisa la vista previa → **Exportar ZIP**.

## Cómo obtiene los datos
1. **API de la conversación (preferido).** Lee `/api/organizations/<org>/chat_conversations/<id>` con la sesión
   del usuario: trae todo el historial sin hacer scroll, distingue autor, y entrega adjuntos, texto extraído de
   documentos y artefactos. Solo exporta la rama activa (ignora ediciones/regeneraciones descartadas).
2. **Lectura del DOM (respaldo).** Si la API falla, sube hasta cargar todo el historial y lee los mensajes. Aparece
   el botón *Buscar documentos adjuntos*, que abre cada adjunto y captura su enlace; en este modo los documentos no
   quedan ligados a un mensaje concreto (van a `archivos_sin_asignar`).

## Estructura del código
| Archivo | Rol |
|---|---|
| `manifest.json`, `background.js` | MV3; el icono abre el panel lateral |
| `sidepanel.*` | UI y orquestación (captura, descargas, ZIP). No se cierra al perder el foco |
| `page-lib.js` | Se inyecta en la pestaña: API, DOM, scroll, robot, descarga con cookies. **Selectores y textos de UI en `CFG`** |
| `core.js` | Lógica pura (normalización, Markdown, nombres) |
| `tests/core.test.js` | `node tests/core.test.js` |
| `vendor/jszip.min.js` | JSZip 3.10.1 |

## Limitaciones conocidas
- La API y el DOM de claude.ai no son públicos ni estables: si Anthropic cambia el formato, ajusta `CFG` en
  `page-lib.js` o la normalización en `core.js`. El informe de cada ZIP indica qué falló.
- Un documento puede estar solo como vista previa (se marca en `informe.txt`); su texto extraído sí se guarda.
- Úsala únicamente con tus propias conversaciones y respetando los términos de servicio de Anthropic.
  Para volúmenes grandes, la exportación oficial (Configuración → Privacidad → Exportar datos) es más fiable.
