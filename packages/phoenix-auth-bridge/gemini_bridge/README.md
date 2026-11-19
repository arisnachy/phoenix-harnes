# Gemini contribution: optional SQLite + local stdio MCP + Windows operator UI

This module incorporates the useful design from Gemini's pasted Python proposal while correcting conflicts with the **actual** PHOENIX `PhoenixEnvelope v1` schema. It uses UUID `message_id`/`thread_id`, integer `turn`, `reply_to`, `payload.text`, `origin`, and strict turn-chain rules; it never silently skips schema validation.

**Important:** This is an *alternative* SQLite-backed prototype, not a migration of the existing Node `state.json`. The Node CLI and Python MCP/UI do NOT share approval/STOP state. **Use one backend per deployment**. Python MCP and Windows operator UI both use this SQLite backend; they are interoperable with each other. Do not run the Node CLI and Python MCP/UI as if they were the same inbox. Full PHOENIX host/UI integration and any state migration still require separate work and review.

### Install and test (Windows PowerShell)

From `packages/phoenix-auth-bridge`:

```powershell
py -3 -m pip install -r gemini_bridge/requirements-core.txt
py -3 -m unittest discover -s test -p test_sqlite_store.py -v
py -3 -m gemini_bridge.windows_relay
```

Only when an officially supported MCP host is available, install the optional transport:

```powershell
py -3 -m pip install -r gemini_bridge/requirements-mcp.txt
py -3 -m gemini_bridge.mcp_server
```

The MCP process runs **stdio only**; configure the official host to launch it with working directory `packages/phoenix-auth-bridge`, never expose it over HTTP. There are **two** MCP tools: propose draft (always `pending`, origin `mcp-agent-proposal`), and read only already-approved inbox. MCP clients cannot call `approve`, `resume`, `stop`, or `mark_delivered`; those are manual Windows UI operator actions. Avoid automatically reading/sending messages between consumers; the user must still manually paste and send in supported ChatGPT/Gemini applications.

The local SQLite file is `%USERPROFILE%\.phoenix\auth-bridge\sqlite\state.db` (WAL and SHM sidecars). **Plaintext bodies live in `envelopes.body_json`**; the `audit_events` table stores metadata and SHA-256 digests only. The audit log is not tamper-proof and hashes are not an anonymization guarantee. No protected clinical/personal data or credentials. Review Windows ACLs; the `operator=True` Python argument is a programmatic guard, **not authentication or a security boundary against local code execution**. The MCP host must have actual consent/tool permissions enabled. A local process running with the same OS user may access the database directly; shared-device deployments need stronger access control and encryption.

STOP is active by default. STOP revokes pending and approved messages atomically, does not revoke previously delivered messages or copies already pasted into browsers. No browser automation, cookies, OAuth token harvesting, API-key billing, or background web sending is included. No risk-free account guarantee.
