# PHOENIX AUTH BRIDGE — Zero-Bypass prototype (Node.js 22+)

**Scope:** local, user-controlled message relay for separately signed-in official ChatGPT and Gemini applications. This does **not** make ChatGPT or Gemini account sessions available to third-party code. Model labels are **user-provided, not authenticated identities**.

**This prototype does NOT** access browsers, inspect cookies, extract OAuth tokens, invoke ChatGPT/Gemini, connect to APIs, perform automated paste/click/send. The **Node CLI** does not implement an MCP server; `relay` only prints approved text for a person to copy manually. Do not call it an OAuth integration or claim zero ban risk. Review each provider's terms before use.

The repository is predominantly Node.js, so the initial validation/guard is dependency-free JavaScript and JSON Schema (draft 2020-12). The optional Python MCP/SQLite contribution under `gemini_bridge/` uses the same schema but **must not** interpret MCP support as permission to control consumer web sessions.

## Windows PowerShell example (in repository root)

```powershell
node packages/phoenix-auth-bridge/src/cli.mjs status
node packages/phoenix-auth-bridge/src/cli.mjs resume
'Hola Gemini, propongo revisar juntos este diseño.' | node packages/phoenix-auth-bridge/src/cli.mjs prepare --from chatgpt --to gemini --intent proposal
node packages/phoenix-auth-bridge/src/cli.mjs status
node packages/phoenix-auth-bridge/src/cli.mjs approve --id <UUID>
node packages/phoenix-auth-bridge/src/cli.mjs relay --id <UUID>
# Copy the displayed text yourself into the OFFICIAL Gemini UI and send it manually.
node packages/phoenix-auth-bridge/src/cli.mjs delivered --id <UUID>
# Enter Gemini's reply as NEW text via stdin with --from gemini --to chatgpt --reply-to <UUID>.