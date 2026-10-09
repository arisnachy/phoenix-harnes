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

Las acciones que modifican la página están bloqueadas por defecto. Para habilitar `navigate`, `click_text` y `youtube_search`, establece `PHOENIX_BROWSER_ALLOW_ACTIONS=true` de forma consciente. `DSH_CHROME_*` se conserva solo como alias legado.

El conector no lee archivos del perfil, cookies ni contraseñas. CDP debe ser habilitado explícitamente por el usuario; una pestaña normal no puede ser adoptada mágicamente desde otro proceso.

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

- The connector requires a usable Chromium CDP session (a configured loopback endpoint or a dedicated auto-launched Chrome/Edge profile). It does not provide a browser binary, login flow, screenshot capture, or arbitrary JavaScript execution tool.
