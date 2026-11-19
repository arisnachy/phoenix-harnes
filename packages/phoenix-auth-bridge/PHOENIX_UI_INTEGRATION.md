# PHOENIX AUTH BRIDGE — UI integration contract (not yet wired into main shell)

The actual PHOENIX Web entry is `apps/web/src/main.ts`, which delegates to the `@phoenix-ai/dsh-client-web` boot/renderer modules. **Do not patch the bootloader to call Python or import an authentication-bypassing browser module.**

The `apps/web/public/phoenix-auth-bridge.html` page is a safe, static **read-only snapshot inspector**. It renders a JSON snapshot selected by the operator through a File input. The page never invokes `fetch`, does not open a socket, does not read local files without an explicit selection, and cannot approve, deliver or resume messages. It is a staging UI asset, not a production operator panel.

The current write surface is the local Windows Tk operator (`launch-operator.ps1`), using the **same live SQLite authority** as the Node and stdio-MCP modules. That is the supported approval/STOP station until an authenticated host endpoint is implemented and reviewed.

## Host integration required to finish the main application panel

1. Register a new opt-in tool surface through PHOENIX's existing UI-renderer/slot system; don't attach a global React root or duplicate the app boot code.
2. Show **informational** turn status and SHA-256 digests from the metadata-only snapshot. Never turn a snapshot into an authorization grant: it may lag SQLite after a commit.
3. Operator actions must use a PHOENIX-owned, local-only backend with its **existing authenticated desktop session**, enforcing exact Origin/CSRF protection, capability checks, rate limits, and no cross-origin endpoint access. Avoid the `operator=True` local Python helper as a network-accessible permission token.
4. On each critical action, read/write SQLite in one transaction and display the result returned by that transaction. STOP revokes undelivered approvals; it does not retract text already copied or sent.
5. Don't open browsers, extract cookies, reuse OAuth/session tokens, or impersonate ChatGPT or Gemini web clients. No API charges or account access are needed for supervised manual relay.
6. Dedicated cross-platform CI validates the Node guard, SQLite operations, and a real SDK MCP `stdio` handshake. A separate interactive Windows acceptance test with Gemini CLI is still required before marking the feature production ready.

## Windows manual acceptance

Install Python 3 and requirements **in the same interpreter Gemini CLI launches**. The module is `gemini_bridge.mcp_server` (NOT `mcp_server.phoenix_mcp`). Use the correct absolute interpreter path and the bridge package directory as `cwd` in Gemini CLI's `settings.json`:

```json
{
  "mcpServers": {
    "phoenix-auth-bridge": {
      "command": "C:\\PATH\\TO\\phoenix-harnes\\packages\\phoenix-auth-bridge\\.venv\\Scripts\\python.exe",
      "args": ["-m", "gemini_bridge.mcp_server"],
      "cwd": "C:\\PATH\\TO\\phoenix-harnes\\packages\\phoenix-auth-bridge",
      "env": {"PYTHONUTF8": "1"},
      "trust": false,
      "includeTools": ["propose_bridge_draft", "read_approved_bridge_inbox"]
    }
  }
}
```

Run `gemini mcp list` and `/mcp list` from a **trusted working directory**, keeping `trust: false` for per-tool confirmations. Run the Tk operator station with `launch-operator.ps1`. Test STOP → resume (operator only) → MCP draft (pending) → inbox empty → approve via Tk → inbox contains one → STOP via Tk → inbox blocked. Perform an OS network/listener inspection if required: `Get-NetTCPConnection` is **TCP only**; UDP must be checked separately with `Get-NetUDPEndpoint`. Server stdio itself binds neither transport, but the client process can have independent network activity; attribute sockets to the **server PID**, not the whole Gemini CLI process. No sub-second latency guarantee is claimed.

**Release gates:** CI green on Ubuntu and Windows, manual Gemini CLI handshake on Windows, authorized PHOENIX host UI integration with tests, and review of local plaintext SQLite/ACL policy. Until then, don't merge to `stable` as a finished feature.
