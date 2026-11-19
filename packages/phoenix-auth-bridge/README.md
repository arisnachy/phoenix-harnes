# PHOENIX AUTH BRIDGE — Zero-Bypass (single SQLite authority)

**Scope:** local, user-controlled message relay for separately signed-in official ChatGPT and Gemini applications. This does **not** make ChatGPT or Gemini account sessions available to third-party code. Model labels are **user-provided, not authenticated identities**.

**This prototype does NOT** access browsers, inspect cookies, extract OAuth tokens, invoke ChatGPT/Gemini, connect to APIs, perform automated paste/click/send. The **Node CLI** does not implement an MCP server; `relay` only prints approved text for a person to copy manually. Do not call it an OAuth integration or claim zero ban risk. Review each provider's terms before use.

The original Node validator is dependency-free JavaScript; the operational Node CLI is now a thin, local subprocess wrapper over the same SQLite authority used by the Python MCP server and Tk operator UI. Python 3 with `jsonschema` is required. MCP remains optional. This does NOT permit automated interaction with subscription web sessions.

## Installation and Windows PowerShell example (in repository root)

```powershell
py -3 -m pip install -r packages/phoenix-auth-bridge/gemini_bridge/requirements-core.txt
```

If the Python Launcher is not installed, install Python 3 and set `PHOENIX_BRIDGE_PYTHON` to your Python executable. Node CLI runs `py -3` on Windows or `python3` elsewhere. It never shells out through PowerShell.

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

Single source of truth is `%USERPROFILE%\.phoenix\auth-bridge\sqlite\state.db` (override `PHOENIX_BRIDGE_HOME` for testing). The legacy `state.json` file is deliberately ignored, never silently migrated, and must not be operated in parallel. `sqlite/state_snapshot.json` is a metadata-only, atomically replaced, **advisory** projection: it can briefly lag a committed STOP, so **only live SQLite reads authorize actions**. The database contains plaintext message bodies: **do not include credentials or medical/personal-sensitive content**. On shared Windows machines, verify filesystem ACLs; Unix modes alone are not a Windows security guarantee. The audit reported by `status` has metadata and SHA-256 digests only, not message bodies; this is not a cryptographically tamper-proof audit log. This demo trusts a user with direct local shell access; the `arisnachy` actor label is NOT authentication. A future HTTP/UI/MCP service MUST add real authentication, CSRF controls, origin validation, access checks and rate limits before exposing these functions.

## Test

```powershell
node --test packages/phoenix-auth-bridge/test/guard.test.mjs
cd packages/phoenix-auth-bridge
py -3 -m unittest discover -s test -p "test_*.py" -v
```

## Integration contract for Gemini's implementation

Use `schema/phoenix-envelope.schema.json`; preserve `origin: manual-user-entry`, `reply_to`, validated turn order, approval and STOP semantics. Model source labels are never proof of account identity. Gemini-side Python components should implement transport/persistence as untrusted message input and must request explicit user approval before presenting any outbound relay content. Avoid logging raw payloads and never expose the local bridge on a public network by default.

**Status:** standalone proof of concept. Node CLI + Python MCP + Tk UI share SQLite. No PHOENIX main UI wiring, no external MCP client / Windows integration test yet, no use of OpenAI/Google credentials, no `main`/`stable` merge.

## Gemini Python contribution (authoritative backend)

`gemini_bridge/` implements a SQLite-backed, stdio-only MCP proposal/inbox adapter and a human operator Windows Tk interface. Node CLI, MCP and Windows operator UI now share the same live SQLite STOP flag and approval decisions. The legacy `state.json` is not imported and no longer used for relay operations; manual migration of legacy threads requires a separate review. The schema supports explicit `origin: mcp-agent-proposal` drafts, which still require human approval. See [Gemini bridge README](gemini_bridge/README.md).
