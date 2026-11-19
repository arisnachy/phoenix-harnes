# PHOENIX AUTH BRIDGE — Zero-Bypass prototype (Node.js 22+)

**Scope:** local, user-controlled message relay for separately signed-in official ChatGPT and Gemini applications. This does **not** make ChatGPT or Gemini account sessions available to third-party code. Model labels are **user-provided, not authenticated identities**.

**This prototype does NOT** access browsers, inspect cookies, extract OAuth tokens, invoke ChatGPT/Gemini, connect to APIs, perform automated paste/click/send, or implement an MCP server. `relay` only prints approved text for a person to copy manually. Do not call it an OAuth integration or claim zero ban risk. Review each provider's terms before use.

The repository is predominantly Node.js, so the initial validation/guard is dependency-free JavaScript and JSON Schema (draft 2020-12). Gemini's planned Python MCP/SQLite implementation can use the same schema but **must not** interpret MCP support as permission to control consumer web sessions.

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
node packages/phoenix-auth-bridge/src/cli.mjs stop
```

The first `status` is STOPPED by default. The bridge requires explicit user `resume`, per-message `approve`, and manual confirmation `delivered`; a `stop` revokes previously approved, undelivered messages. Replies require confirmed previous delivery, strict alternation, no forks, and a maximum of 12 turns per thread. There is no polling or background service.

Local state is in `%USERPROFILE%\.phoenix\auth-bridge\state.json` (override `PHOENIX_BRIDGE_HOME` for testing). It contains plaintext message bodies: **do not include credentials or medical/personal-sensitive content**. On shared Windows machines, verify filesystem ACLs; Unix modes alone are not a Windows security guarantee. The audit reported by `status` has metadata and SHA-256 digests only, not message bodies; this is not a cryptographically tamper-proof audit log. This demo trusts a user with direct local shell access; the `arisnachy` actor label is NOT authentication. A future HTTP/UI/MCP service MUST add real authentication, CSRF controls, origin validation, access checks and rate limits before exposing these functions.

## Test

```powershell
node --test packages/phoenix-auth-bridge/test/guard.test.mjs
```

## Integration contract for Gemini's implementation

Use `schema/phoenix-envelope.schema.json`; preserve `origin: manual-user-entry`, `reply_to`, validated turn order, approval and STOP semantics. Model source labels are never proof of account identity. Gemini-side Python components should implement transport/persistence as untrusted message input and must request explicit user approval before presenting any outbound relay content. Avoid logging raw payloads and never expose the local bridge on a public network by default.

**Status:** standalone proof of concept. No PHOENIX UI wiring, no MCP implementation, no use of OpenAI/Google credentials, no `main`/`stable` merge.