# PHOENIX Embedded Browser Specification

## Goal

Embed a real Chromium browser inside the Windows PHOENIX desktop shell so users can keep the PHOENIX chat visible while browsing external pages in a resizable right-hand pane.

## User experience

- PHOENIX Desktop owns one native window instead of launching Edge with `--app`.
- The left pane hosts the existing PHOENIX Web GUI at `http://127.0.0.1:3080/`.
- A collapsible, resizable right pane hosts an independent WebView2 browser.
- The browser pane includes Back, Forward, Reload, address/search box, Go, and Close controls.
- Clicking an external/new-window link from PHOENIX opens it in the embedded browser pane.
- PHOENIX pages can invoke a small injected `window.phoenixBrowser` bridge to open/close/navigate/reload the embedded browser without leaving the chat.
- Browser state is sent back to the PHOENIX page as a `phoenix-browser-state` CustomEvent containing URL, title, and navigation capabilities.
- The embedded browser uses a separate WebView2 user-data directory from the PHOENIX shell.
- `http`, `https`, and `about:blank` are allowed. Potentially executable schemes such as `javascript:`, `data:`, and `file:` are rejected by the native navigation parser.
- Plain hostnames normalize to HTTPS; localhost/loopback hostnames normalize to HTTP; free text becomes a web search.

## Scope

Windows desktop only. The web-only build remains unchanged and does not attempt to emulate a full browser with iframes.

## Verification

- Build `apps/desktop-windows/Phoenix.Desktop.csproj` on `windows-latest` with .NET 8.
- Run a no-framework contract test executable for address normalization and bridge-command parsing.
- CI workflow runs on the work branch, `main`, and `stable`.