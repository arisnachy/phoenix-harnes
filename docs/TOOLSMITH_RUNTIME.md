# PHOENIX Toolsmith Runtime v3

Toolsmith Runtime gives PHOENIX a provider-neutral capability layer: discover existing MCP tools, import the user's Codex/Claude Code MCP ecosystems, and create constrained local MCP tools when a mission needs a capability that is missing.

The design goal is **adaptive capability acquisition**, not unrestricted self-modification.

## Runtime loop

```text
mission
  ↓
identify capability needs
  ↓
lazy-search MCP federation
  ├─ suitable tool exists → bind and use
  └─ missing capability
         ↓
      propose constrained blueprint
         ↓
      materialize ephemeral local MCP
         ↓
      discover schema
         ↓
      probe
       ├─ fail → record evidence → different blueprint/path
       └─ pass → mark verified → bind to Tool Registry
  ↓
execute mission
  ├─ success → ledger + normal memory/experience path
  └─ failure → strategy pivot → new approach/new needs → retry
```

Both forge attempts and mission attempts are bounded. A failed path is evidence for the next proposal rather than permission to loop indefinitely.

## MCP Federation

`@phoenix/mcp` uses the official Model Context Protocol SDK.

PHOENIX currently executes:

- stdio MCP servers;
- Streamable HTTP MCP servers.

SSE/WebSocket specifications can be catalogued by imported configuration, but v3 deliberately fails closed instead of pretending to execute an unsupported transport.

### Lazy tool discovery

PHOENIX does not inject every connected MCP schema into every prompt. Federation discovers tools lazily and `search()` ranks compact descriptors for the current capability query. Only selected schemas need to be exposed to an agent.

This reduces one common source of harness token growth: large static tool catalogs.

MCP results are also bounded by `maxToolResultChars` (40,000 by default) before they can flood later context.

## Codex MCP interoperability

`bootstrapMcpFederation()` can import MCP definitions from:

```text
~/.codex/config.toml
```

It can also register Codex itself as an MCP server using the official command:

```text
codex mcp-server
```

Imported servers start `trusted: false`. PHOENIX does not copy their authentication material into the repository.

## Claude Code MCP interoperability

PHOENIX can import:

```text
./.mcp.json
~/.claude.json
```

and can register Claude Code itself as an MCP server using:

```text
claude mcp serve
```

Project/user scope is retained where it can be inferred. Imported servers remain untrusted until the operator's policy allows execution.

## Toolsmith Forge

Toolsmith v3 intentionally supports only two generated implementation families:

### `http-json`

Wrap one fixed HTTP endpoint. Requirements:

- HTTPS, except loopback development endpoints;
- no embedded secret values;
- secret headers reference environment-variable names;
- fixed HTTP method/endpoint declared in the blueprint.

### `command-json`

Wrap one fixed executable. Requirements:

- `shell: false`;
- executable and arguments are separate;
- no compound shell syntax/metacharacters;
- JSON input is provided on stdin;
- stdout is interpreted as JSON when possible.

This is deliberately narrower than "generate arbitrary source code and run it". A future general-code forge should only be promoted after PHOENIX has a stronger OS/container sandbox and adversarial validation layer.

## Ephemeral → verified

Generated servers are created under:

```text
.phoenix/forge/
```

`.phoenix/` is ignored by Git. Toolsmith writes a local `forge.json` provenance record with initial status `ephemeral`. It changes to `verified` only after the generated MCP initializes, advertises the expected tool, and passes its configured probe.

Verification does **not** automatically mean unrestricted authority. Actual calls still pass through `McpCallPolicy` and then the PHOENIX Tool Registry's risk policy.

## Adaptive mission pivot

`AdaptiveMissionRunner` adds a layer above an ordinary AgentRunner.

If the current approach cannot acquire a required capability, or execution itself fails, the pivot planner receives the accumulated failure evidence and must propose a materially different permitted approach. It can request new capabilities, causing another federation-search/forge cycle.

Ledger events include:

```text
toolsmith.needs
toolsmith.reused
toolsmith.forged
toolsmith.exhausted
mission.attempt
mission.pivot
mission.completed
mission.exhausted
```

This makes route changes inspectable instead of hiding them inside model prose.

## Security boundary

Toolsmith does not:

- extract Codex/Claude OAuth tokens;
- bypass provider quotas;
- bypass MCP/user approvals;
- automatically trust imported MCP servers;
- auto-commit generated tools;
- give generated tools unrestricted shell access;
- keep retrying without a bound.

The intended progression is:

```text
need → minimal capability → local artifact → verification → policy → execution
```

not:

```text
need → arbitrary generated code → full machine access
```

## Example bootstrap

```ts
import {
  McpFederation,
  PhoenixToolsmithPlanner,
  ToolsmithEngine,
  bootstrapMcpFederation,
} from '@phoenix/core';

const federation = new McpFederation();
await bootstrapMcpFederation(federation);

const planner = new PhoenixToolsmithPlanner(phoenixRuntime);
const toolsmith = new ToolsmithEngine({
  federation,
  planner,
  ledger: phoenixRuntime.ledger,
  callPolicy: {
    allowedRisks: ['read', 'network'],
  },
});
```

Write/exec authority should be added explicitly through policy/approval only when the mission requires it.
