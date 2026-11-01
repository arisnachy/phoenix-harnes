# PHOENIX — OpenClaw companion (optional)

PHOENIX remains the coordinating agent runtime. **OpenClaw is a separate, optional sidecar**, not a replacement for the Cordis core or Kira. Its native plugins are not automatically available as PHOENIX tools.

## Included

- Settings → Plugins → **OpenClaw**: non-interactive, secret-free readiness probes for the installed OpenClaw CLI, Gateway CLI, browser CLI, plugins and channels.
- `node scripts/phoenix-openclaw-companion.mjs status`: bounded Gateway CLI probe (does not expose raw configuration).
- `node scripts/phoenix-openclaw-companion.mjs browser-status`: bounded browser CLI probe.
- `node scripts/phoenix-openclaw-companion.mjs plugins`: limited IDs of installed plugins.
- `node scripts/phoenix-openclaw-companion.mjs lobster`: optional Lobster plugin probe.
- `node scripts/phoenix-openclaw-companion.mjs browser-snapshot --approve-capture`: explicitly requested text snapshot from the **OpenClaw-managed browser profile**. Browser content may contain private information: use only when the owner authorizes capture.

No OpenClaw installation is performed automatically. The existing ClawHub bootstrap (`scripts/phoenix-clawhub-bootstrap.mjs`) handles the optional ClawHub CLI separately. Installed code plugins remain within the OpenClaw runtime and are not silently loaded into the PHOENIX Host.

## Capabilities and limits

The Settings checks establish only that a CLI command responded. They do **not** assert Gateway connectivity, working channels, granted screen/audio permissions, active plugins, or authenticated access. Browser capture requires an explicit argument and a running managed browser with appropriate permissions. PHOENIX does not bypass browser/Windows consent.

The next integration milestone is a bounded, approval-gated `ctx.tools` adapter backed by a specific OpenClaw Gateway session, with cancellation, provenance and durable audit receipts. Do **not** route arbitrary CLI strings or raw plugin code through the Host.

## Source and license

OpenClaw is MIT-licensed. These bridge files are PHOENIX-owned integration code and do not vendor any OpenClaw source. Preserve required notices if source code is imported later.

Official documentation:
- https://docs.openclaw.ai/cli/gateway/query
- https://docs.openclaw.ai/cli/browser
- https://docs.openclaw.ai/tools/plugin
