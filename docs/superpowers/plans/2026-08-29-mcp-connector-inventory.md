# MCP Connector Inventory Implementation Plan

English | [中文](2026-08-29-mcp-connector-inventory.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the model a live, secret-free inventory of authorization flows and MCP connector states.

**Architecture:** Add one shared `McpConnectorRegistry` service. MCP client instances publish lifecycle and public-tool changes through reversible handles; HARDNESS reads that registry beside the existing authorization seam and emits one closed read-only tool.

**Tech Stack:** TypeScript ESM, Cordis services/effects, Vitest, generated config catalog, MCP stdio and Streamable HTTP supervisors.

**Spec:** `docs/superpowers/specs/2026-08-29-mcp-connector-inventory-design.md`

## Global Constraints

- Registry payloads contain only server name, transport, status, stable reason code, and public tool names.
- Raw MCP configuration, headers, environment variables, credentials, URLs, and provider error text never enter model-visible output.
- Failed or disconnected MCP connections never become callable merely because a previous tool name remains in the inventory.
- Minimal contexts without the optional registry continue to mount the existing MCP client and HARDNESS adapter behavior.
- Every changed model-visible or package contract surface receives focused tests, bilingual documentation where applicable, and an Agent Note.

---

### Task 1: Add the MCP registry service

**Files:**
- Create: `packages/mcp/mcp-registry/package.json`
- Create: `packages/mcp/mcp-registry/tsconfig.json`
- Create: `packages/mcp/mcp-registry/src/index.ts`
- Create: `packages/mcp/mcp-registry/tests/registry.spec.ts`
- Create: `packages/mcp/mcp-registry/README.md`
- Create: `packages/mcp/mcp-registry/README.zh.md`
- Create: `packages/mcp/mcp-registry/README.i18n.yaml`
- Modify: `packages/mcp/README.md`
- Modify: `packages/mcp/README.zh.md`

**Interfaces:**
- Produces `McpConnectorStatus`, `McpConnectorEntry`, `McpConnectorRegistration`, and `McpConnectorRegistry` on `ctx.mcpConnectors`.
- `register({ serverName, transport })` returns `{ setStatus(status, reasonCode?), setTools(toolNames), dispose }` and rejects duplicate server names.
- `list()` returns detached, secret-free entries in registration order.

- [x] **Step 1: Write failing registry tests** for duplicate names, status/tool updates, detached snapshots, and disposal.
- [x] **Step 2: Run the registry test** and confirm the new package/service is absent.
- [x] **Step 3: Implement the service** with Cordis effects and a closed status/transport vocabulary.
- [x] **Step 4: Run registry tests and package typecheck.**
- [x] **Step 5: Add package README pair and update the MCP family index.**

### Task 2: Publish supervisor lifecycle state

**Files:**
- Modify: `packages/mcp/mcp-client/src/index.ts`
- Modify: `packages/mcp/mcp-client/src/connection.ts`
- Modify: `packages/mcp/mcp-client/package.json`
- Modify: `packages/mcp/mcp-client/tsconfig.json`
- Modify: `packages/mcp/mcp-client/tests/apply.spec.ts`
- Modify: `packages/mcp/mcp-client/tests/reconnect.spec.ts`

**Interfaces:**
- Consumes optional `ctx.mcpConnectors` and its registration handle.
- Produces status updates at initial start, successful synchronization, connection loss, retry, explicit HTTP authorization failure, retry exhaustion, and disposal.

- [x] **Step 1: Add lifecycle assertions** to existing MCP supervisor fixtures.
- [x] **Step 2: Run those tests** and confirm the assertions fail before publication is implemented.
- [x] **Step 3: Register one server handle** before starting the supervisor and update it from connection generations and synchronized public names.
- [x] **Step 4: Classify only explicit 401/403 HTTP failures** as `auth-required`; keep all other failures stable and secret-free.
- [x] **Step 5: Run MCP unit/reconnect tests and package typecheck.**

### Task 3: Merge registry state into HARDNESS inventory

**Files:**
- Modify: `packages/hardness/adapters/src/connector-list-tool.ts`
- Modify: `packages/hardness/adapters/src/index.ts`
- Modify: `packages/hardness/adapters/package.json`
- Modify: `packages/hardness/adapters/tsconfig.json`
- Modify: `packages/hardness/adapters/tests/connector-list-tool.spec.ts`
- Modify: `packages/hardness/adapters/tests/adapters.spec.ts`

**Interfaces:**
- `createConnectorListTool(authorization?, mcpConnectors?)` returns the same read-only tool with a merged closed output schema.
- Authorization rows keep sanitized service metadata; MCP rows expose `kind`, `transport`, `status`, and `tools` only.

- [x] **Step 1: Add failing merged-inventory tests** for ready, disconnected, auth-required, and absent-registry cases.
- [x] **Step 2: Run focused adapter tests** and confirm the new assertions fail.
- [x] **Step 3: Implement the merged projection** and register the tool whenever either optional source exists.
- [x] **Step 4: Run adapter tests, typecheck, and focused Oxlint.**

### Task 4: Compose, document, and verify the model-visible contract

**Files:**
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `docs/config-catalog.md`
- Modify: `docs/config-catalog.zh.md`
- Modify: `pnpm-lock.yaml`
- Modify: `.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.md`
- Modify: `.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.zh.md`
- Modify: `.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.i18n.yaml`
- Modify: `examples/headless-agent/tests/keyless-smoke.e2e.ts` and its connector-inventory fixture.

**Interfaces:**
- The base composition mounts the registry before optional MCP clients and HARDNESS adapters.
- The model-visible output is closed and excludes transport secrets and raw failure details.

- [x] **Step 1: Mount the registry and regenerate the config catalog.**
- [x] **Step 2: Update the implemented Agent Note and bilingual sidecar.**
- [x] **Step 3: Update the assembled keyless snapshot for the inventory tool.**
- [x] **Step 4: Run focused tests, snapshot tests, typecheck, `verify-translation-pairing`, `verify-config-catalog`, and `git diff --check`.**
- [ ] **Step 5: Commit the complete local change without pushing.**
