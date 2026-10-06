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

## La familia de extensiones
Tres extensiones independientes que se complementan para **mover tus conversaciones entre ChatGPT y Claude**:

| Extensión | Qué hace |
|---|---|
| [Exportar Chats ChatGPT](https://github.com/alcalos9/extension_chrome_chatgpt) | Descarga una conversación (o proyectos y skills) de chatgpt.com como ZIP |
| [Exportar Chats Claude](https://github.com/alcalos9/extension_chrome_claude) | Descarga una conversación (o proyectos y skills) de claude.ai como ZIP |
| [Importar Chats a Claude](https://github.com/alcalos9/extension_chrome_importar_claude) | Carga esos ZIP en tu cuenta de Claude: chat suelto, proyecto existente o proyecto nuevo |

Flujo típico: **exportas** con una de las dos primeras → obtienes un ZIP → lo **importas** a Claude con la tercera.

## Proyectos y skills (v2.2)
El panel tiene tres pestañas: **Conversación**, **Proyectos** y **Skills**.
- **Proyectos:** lista tus proyectos, eliges cuáles y exporta, por proyecto: `instrucciones.md`,
  `conocimiento/` (documentos y archivos subidos), `proyecto.json`, `LEEME.md` y, opcionalmente, todas sus
  conversaciones (cada una con su carpeta completa: Markdown, JSON, imágenes y archivos).
- **Skills:** lista tus skills (los de Anthropic vienen desmarcados) y exporta cada uno como el ZIP original
  (listo para volver a subirlo en Configuración → Capacidades) y desempaquetado (`SKILL.md` + archivos).
- **Diagnóstico** (en «Registro y diagnóstico»): descarga `diagnostico_claude.json` con el estado HTTP y la *forma*
  (claves y tipos, nunca contenido) de cada endpoint probado. Úsalo si una lista sale vacía o falla.

Los endpoints de proyectos y skills **no son públicos**: cada operación prueba varias rutas y deja en el informe lo
que falló. Siempre se guarda la respuesta cruda en `debug/` para poder ajustar `recursos.js`.

## Instalación
La extensión no está en la Chrome Web Store: se instala a mano en modo desarrollador (1 minuto, gratis).

1. **Descarga el código.** En la página del repositorio pulsa **Code → Download ZIP** y descomprímelo
   (o usa `git clone https://github.com/alcalos9/extension_chrome_claude.git`). Guarda la carpeta en un lugar estable: Chrome la lee desde ahí,
   así que si la borras o la mueves la extensión deja de funcionar.
2. Abre `chrome://extensions` en Chrome (o Edge/Brave u otro navegador basado en Chromium, versión ≥ 116).
3. Activa **Modo de desarrollador** (interruptor arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta del proyecto (la que contiene `manifest.json`).
5. Fija la extensión desde el icono de puzle de la barra para tenerla a mano.
6. Abre sesión en claude.ai en esa misma ventana de Chrome: la extensión usa tu sesión, no pide contraseñas.

**Actualizar:** descarga de nuevo el repositorio, reemplaza la carpeta y pulsa el botón ⟳ de la extensión en
`chrome://extensions`. **Desinstalar:** botón *Quitar* en la misma página.

> Chrome puede mostrar al abrir el navegador el aviso «Desactiva las extensiones en modo desarrollador».
> Es normal en extensiones instaladas así; puedes cerrarlo.

## Uso
1. Instala la extensión (ver **Instalación** arriba).
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
| `recursos.js` | Lógica pura de proyectos y skills (URLs candidatas, normalización, reconstrucción de skills) |
| `recursos-ui.js` | Pestañas, listas, exportación de proyectos/skills y diagnóstico |
| `tests/` | `node tests/core.test.js`, `node tests/recursos.test.js`; `tests/e2e-panel.js` (requiere jsdom) |
| `vendor/jszip.min.js` | JSZip 3.10.1 |

## Privacidad y seguridad
- **Todo ocurre en tu navegador.** La extensión no tiene servidor propio, no envía tus conversaciones a ningún
  tercero y no incluye analítica ni telemetría.
- Usa **tu sesión ya abierta** en claude.ai; no pide ni guarda contraseñas ni tokens.
- Permisos que solicita (ver `manifest.json`): `activeTab`, `scripting` y `sidePanel` (leer la pestaña activa y mostrar el panel lateral); acceso a `claude.ai`; y, solo si lo aceptas al exportar proyectos, descargar archivos adjuntos de otros dominios.
- Puedes revisar el código completo: son archivos JavaScript sin compilar ni ofuscar.

## Solución de problemas
- **El icono no abre nada / el panel no aparece:** recarga la extensión (⟳ en `chrome://extensions`) y la pestaña de claude.ai.
- **Dice que la sesión está cerrada o no encuentra datos:** abre claude.ai, inicia sesión y vuelve a intentarlo.
- **Algo dejó de funcionar de un día para otro:** claude.ai cambió su interfaz o su API interna. Revisa el *Registro* del panel y abre un *issue* en el repositorio con ese texto (sin datos personales).
- **Chrome pide un permiso extra:** es para descargar archivos adjuntos de otros dominios; se pide una sola vez.

## Limitaciones conocidas
- La API y el DOM de claude.ai no son públicos ni estables: si Anthropic cambia el formato, ajusta `CFG` en
  `page-lib.js` o la normalización en `core.js`. El informe de cada ZIP indica qué falló.
- Un documento puede estar solo como vista previa (se marca en `informe.txt`); su texto extraído sí se guarda.
- Úsala únicamente con tus propias conversaciones y respetando los términos de servicio de Anthropic.
  Para volúmenes grandes, la exportación oficial (Configuración → Privacidad → Exportar datos) es más fiable.

## Aviso
Proyecto independiente, no afiliado ni respaldado por Anthropic ni por OpenAI. Claude y ChatGPT son marcas de sus
respectivos titulares. Depende de interfaces internas no documentadas que pueden cambiar sin aviso.
Úsalo solo con tus propias conversaciones y respetando los términos de servicio de cada plataforma.
