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
4. Usa `mcp__browser__status`, luego `mcp__browser__tabs`, `mcp__browser__navigate` y `mcp__browser__read_page`.

Las acciones que modifican la página están bloqueadas por defecto. Para habilitar `navigate`/`click_text`, establece `PHOENIX_BROWSER_ALLOW_ACTIONS=true` de forma consciente. `DSH_CHROME_*` se conserva solo como alias legado.

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

The `navigate` and `click_text` tools are model-visible only when the connector is configured with explicit action approval. Their results report the requested URL or click outcome and never include credentials.

#### Token effect

Action results are short status messages; the page contents enter context only after a separate `read_page` call.

#### KV Cache effect

Action results append to the tool transcript and do not rewrite the earlier system prompt; a later `read_page` result is independent dynamic content.

## Known Limitations and Deferred Work

- The connector requires a user-launched CDP session and does not provide a browser binary, login flow, screenshot capture, or arbitrary JavaScript execution tool.
