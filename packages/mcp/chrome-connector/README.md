# PHOENIX Browser Connector

English | [中文](README.zh.md)

Servidor MCP local para una sesión de Chrome o Microsoft Edge que el usuario haya expuesto explícitamente mediante Chrome DevTools Protocol (CDP).

## Activación

1. Usa una instancia y un perfil separados de tus cuentas personales.
2. Inicia Chrome o Edge con uno de estos comandos:

```powershell
chrome.exe --remote-debugging-port=9222 --user-data-dir="$env:TEMP\phoenix-chrome-profile"
msedge.exe --remote-debugging-port=9223 --user-data-dir="$env:TEMP\phoenix-edge-profile"
```

3. Carga `examples/mcp-chrome.cordis.yml` como overlay de PHOENIX.
4. Para una inspección general, usa `mcp__browser__status`, `mcp__browser__tabs`, `mcp__browser__navigate` y `mcp__browser__read_page`. Para una solicitud sencilla como «abre YouTube y busca Bob Esponja», usa **una sola llamada** a `youtube_search` con `query="Bob Esponja"` y presenta el resultado.

Las acciones que modifican la página están bloqueadas por defecto. Para habilitar `navigate`, `click_text`, `youtube_search`, `fill_form`, `interact` y `submit_form`, establece `PHOENIX_BROWSER_ALLOW_ACTIONS=true` de forma consciente. `DSH_CHROME_*` se conserva solo como alias legado.

### Formularios y aplicaciones web (sin Computer visible)

- `inspect_page`: en una sola consulta devuelve controles, etiquetas, tipo, alternativas de select, bloqueos readonly/disabled y formularios. No devuelve valores de contraseñas.
- `fill_form`: hasta 30 cambios en una llamada con `fields: [{operation:'fill', name:'my-text', value:'texto'}, {operation:'check', name:'my-check', checked:true}, {operation:'select', name:'my-select', value:'Two'}]`. Para fecha usa el valor ISO `YYYY-MM-DD`. Se detiene ante controles ambiguos o protegidos; no altera archivos ni campos ocultos.
- `interact`: clic/scroll/fill/check/select individual por `selector`, `name`, `label` o `placeholder` en una pestaña activa.
- `submit_form`: solo si el usuario pidió explícitamente enviar; `selector:'form', confirmation:true`. Es un intento de envío, **no** una confirmación de éxito.
- `wait_for`: verifica un texto de éxito real y la URL final tras la navegación; no reenvía el formulario.

Para `https://www.selenium.dev/selenium/web/web-form.html`, un flujo normal es inspeccionar → completar campos en lote, sin cambiar Disabled/Readonly/File/Hidden → enviar si fue autorizado → esperar `Received!`. No uses Computer si no hay ventanas de escritorio visibles; Chromium CDP actúa directamente sobre la página, con permiso de navegador. Si aparece CAPTCHA, autenticación externa, iframe de otro origen o diálogo nativo, devuelve el bloqueo observable y solicita intervención humana en vez de intentar sortearlo.

El conector no lee archivos del perfil, cookies ni contraseñas. CDP debe ser habilitado explícitamente por el usuario; una pestaña normal no puede ser adoptada mágicamente desde otro proceso.


### Análisis real de videos de YouTube (Kira / Godot)

`youtube_video_inspect` acepta una URL pública o `tabId`, subtítulos JSON3/XML, hasta 12 capturas reales (`frames`, 6 predeterminadas) y `audioSeconds` (0–9, 8 predeterminados). Cuando no hay texto en la pista, intenta un fragmento de audio real de Chromium y lo transcribe en la máquina local. `youtube_video_listen` escucha tramos posteriores de 3–9 segundos mediante `startSeconds` y `durationSeconds`, conserva marcas de tiempo y retorna el siguiente segundo que se debe escuchar. Kira debe encadenar segmentos para revisar un video largo, no afirmar haber oído lo que todavía no procesó. Los tramos de audio son efímeros, no se envían al modelo ni a una API de voz; únicamente devuelve texto reconocido con su idioma y tiempos. Un video con DRM, autoplay bloqueado o sin pista de audio capturable puede continuar inaccesible.

Cuando el conector navega por petición de Kira, las tarjetas del MiniBrowser aparecen también en investigaciones y análisis indirectos (no solo con la orden «abre»). El Chromium headless funciona silenciado para impedir audio invisible; los videos de YouTube muestran una vista previa en el chat y el sonido se activa exclusivamente desde el reproductor visible mediante el botón «Reproducir con audio».


### Motor local de voz y prueba

Al analizar un video sin subtítulos, Phoenix busca `uv` en PATH, resuelve en un entorno aislado `faster-whisper` y descarga en la caché el modelo `base` de Whisper la primera vez; después reutiliza los archivos instalados. Esto puede requerir conexión a Internet la primera vez. Se puede elegir `PHOENIX_VIDEO_WHISPER_MODEL=tiny|base|small` y un intérprete Python ya preparado mediante `PHOENIX_VIDEO_PYTHON`. Kira no escribe contraseñas ni datos del perfil de Chrome en el resultado del MCP. Para autorizar navegación y captura en el navegador aislado, utiliza la política normal `PHOENIX_BROWSER_ALLOW_ACTIONS=true`. Prueba de aceptación: Kira debe presentar como mínimo un fotograma legible y un segmento transcrito con tiempo real, o reportar el código concreto del fallo de audio/imagen. No se asegura compatibilidad con videos privados o DRM.

## Model Experience

### Browser session inspection

#### What the model sees

The `status`, `tabs`, and `read_page` tools expose only the connected browser endpoint, visible tab metadata, and bounded visible page text. Cookies, passwords, profile files, and browser storage stay outside the model request.

#### Token effect

`tabs` and `status` return short metadata; `read_page` adds at most the requested `maxChars` of visible text plus a small JSON envelope.

#### KV Cache effect

Each tool result is a new model-visible result. Earlier page text remains in conversation history until the session compacts or the user starts a new turn.

### Browser navigation and clicks

#### What the model sees

The `navigate`, `click_text`, and `youtube_search` tools follow the configured browser-action permission. `youtube_search` constructs the YouTube search-results URL, navigates once, inspects tab metadata once, and reports whether the final URL is confirmed or the navigation only started. It never selects or plays videos and never accesses credentials.

#### Token effect

Action results are short status messages; `youtube_search` avoids a separate `read_page` by returning a bounded URL-confirmation result. The page contents enter context only after an explicitly needed `read_page` call.

#### KV Cache effect

Action results append to the tool transcript and do not rewrite the earlier system prompt; a later `read_page` result is independent dynamic content.

## Known Limitations and Deferred Work

- El conector requiere Chromium disponible con CDP en loopback (perfil aislado si hace falta). Las herramientas estructuradas no ejecutan JavaScript arbitrario del modelo. No pueden automatizar CAPTCHA, file input, iframes cross-origin, selectores ambiguos, diálogos nativos o aplicaciones de escritorio sin interfaz visible; esos casos se reportan y se derivan al usuario.
