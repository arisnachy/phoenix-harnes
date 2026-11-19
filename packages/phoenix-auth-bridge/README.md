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

## Phase 3 — Cross-platform stdio MCP test and read-only PHOENIX panel asset

The isolated MCP client test `test/test_mcp_stdio.py` performs a real SDK `stdio` handshake, discovers exactly the two unprivileged MCP tools, verifies STOP blocks all drafts, then checks that a draft is invisible until local operator approval and revoked immediately upon a subsequent STOP. It **never** invokes ChatGPT/Gemini accounts. The test requires `mcp>=1.28,<2` and runs on both Ubuntu and Windows using `.github/workflows/phoenix-auth-bridge.yml` with `PHOENIX_REQUIRE_MCP=1` (no accidental skipping in CI). CI checks are distinct from a manual Gemini CLI session on Arisnachy's computer.

For Windows, install the optional MCP dependencies in the actual interpreter used by Gemini CLI:

```powershell
cd packages/phoenix-auth-bridge
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r gemini_bridge\requirements-mcp.txt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launch-operator.ps1
```

See [PHOENIX UI integration contract](PHOENIX_UI_INTEGRATION.md) for the correct `gemini_bridge.mcp_server` module path, exact `settings.json` example, and Windows interactive test sequence. `apps/web/public/phoenix-auth-bridge.html` adds a **read-only** local file-selected snapshot inspector to the PHOENIX web asset tree. **It is not wired to the main navigation or PHOENIX host authentication**, and cannot approve/stop/send messages. The operator's actual controls remain in the Windows Tk window, which talks directly to SQLite; full native host/UI integration remains an explicit release gate.


## Gemini CLI per-user registration (explicit opt-in; Windows PowerShell 5.1)

Use **only** a Python virtual environment for this bridge. From
`packages\phoenix-auth-bridge` (do NOT run these commands from an unrelated
working directory):

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\gemini_bridge\requirements-mcp.txt
powershell.exe -NoProfile -File .\configure-gemini-cli.ps1
# The previous command only PREVIEWS the settings. Read the paths before applying.
powershell.exe -NoProfile -File .\configure-gemini-cli.ps1 -Apply
powershell.exe -NoProfile -File .\verify-gemini-cli-windows.ps1 -ListGeminiMcp
```

The installer merges **only** the `phoenix-auth-bridge` entry into your *per-user*
`%USERPROFILE%\.gemini\settings.json`. It preserves unrelated Gemini settings,
refuses to overwrite an existing bridge entry without `-ReplaceExisting`, makes
an on-disk backup, and uses an atomic file replacement. No credentials or
provider session cookies are accessed or copied. If you have a custom bridge
home, pass the SAME `-BridgeHome` directory as your Windows operator uses via
`PHOENIX_BRIDGE_HOME`. `-SettingsPath` is supported for isolated testing.

The generated server uses the actual Python module `gemini_bridge.mcp_server`,
`trust: false`, and an exact allowlist of the two non-privileged MCP tools. This
does **not** override every possible Gemini CLI approval mode or guarantee
prompts on every call: retain explicit PHOENIX approval in SQLite regardless.
Gemini CLI and PHOENIX must never access or reuse one another's web sessions.

Once Gemini CLI is open from a trusted folder, inspect `/mcp` and the server's
two exposed tools. Launch `launch-operator.ps1` separately. Test: STOP initially
ON → operator resumes → MCP drafts are pending → inbox empty → operator approves
→ inbox lists approved message → operator stops → inbox BLOCKED and approval
revoked. Actual Gemini CLI usage on Arisnachy's Windows remains a **manual
acceptance gate**, not a result established by GitHub Actions.

Optional host network check (while Gemini CLI's MCP worker is running):

```powershell
powershell.exe -NoProfile -File .\verify-gemini-cli-windows.ps1 -InspectNetwork
```

The check reports listening TCP and bound UDP sockets for the **MCP Python
server process**, not for Gemini CLI. A zero-listener check alone cannot prove
account-policy compliance, nor can it undo text that was already copied.

**Main PHOENIX panel:** the existing static viewer is read-only; operator
controls currently remain in the local Tk window, not PHOENIX's web shell.
Do NOT introduce a bearer token header in a public SPA or unauthenticated
`localhost` endpoint and call it "production authentication". A true web
control panel must be implemented within PHOENIX's existing authenticated
host session with per-action CSRF/origin checks and command-level access
control, then tested before release to stable.
