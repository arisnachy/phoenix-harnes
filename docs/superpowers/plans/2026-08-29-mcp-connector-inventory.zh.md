# MCP 连接器清单实现计划

[English](2026-08-29-mcp-connector-inventory.md) | 中文

> **面向 agentic workers：** REQUIRED SUB-SKILL：使用 `superpowers:executing-plans` 按任务逐项实现此计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 为模型提供 authorization flows 和 MCP connector states 的实时、无 secret inventory。

**架构：** 增加一个共享的 `McpConnectorRegistry` service。MCP client instances 通过可撤销句柄发布 lifecycle 和 public-tool changes；HARDNESS 在现有 authorization seam 旁读取 registry，并输出一个封闭的只读 tool。

**技术栈：** TypeScript ESM、Cordis services/effects、Vitest、generated config catalog、MCP stdio 和 Streamable HTTP supervisors。

**规范：** `docs/superpowers/specs/2026-08-29-mcp-connector-inventory-design.md`

## 全局约束

- Registry payloads 只包含 server name、transport、status、stable reason code 和 public tool names。
- Raw MCP configuration、headers、environment variables、credentials、URLs 和 provider error text 永远不会进入面向模型的 output。
- Failed 或 disconnected MCP connections 不会仅因为 inventory 中残留之前的 tool name 就变成可调用。
- 没有 optional registry 的 minimal contexts 继续挂载现有 MCP client 和 HARDNESS adapter behavior。
- 每个变更的 model-visible 或 package contract surface 都要有 focused tests、适用时的双语文档以及 Agent Note。

---

### Task 1：增加 MCP registry service

**文件：**
- 创建：`packages/mcp/mcp-registry/package.json`
- 创建：`packages/mcp/mcp-registry/tsconfig.json`
- 创建：`packages/mcp/mcp-registry/src/index.ts`
- 创建：`packages/mcp/mcp-registry/tests/registry.spec.ts`
- 创建：`packages/mcp/mcp-registry/README.md`
- 创建：`packages/mcp/mcp-registry/README.zh.md`
- 创建：`packages/mcp/mcp-registry/README.i18n.yaml`
- 修改：`packages/mcp/README.md`
- 修改：`packages/mcp/README.zh.md`

**接口：**
- 在 `ctx.mcpConnectors` 提供 `McpConnectorStatus`、`McpConnectorEntry`、`McpConnectorRegistration` 和 `McpConnectorRegistry`。
- `register({ serverName, transport })` 返回 `{ setStatus(status, reasonCode?), setTools(toolNames), dispose }`，并拒绝重复 server names。
- `list()` 按注册顺序返回 detached、secret-free entries。

- [x] **步骤 1：编写失败 registry tests**，覆盖 duplicate names、status/tool updates、detached snapshots 和 disposal。
- [x] **步骤 2：运行 registry test**，确认新的 package/service 不存在。
- [x] **步骤 3：实现 service**，使用 Cordis effects 和封闭的 status/transport vocabulary。
- [x] **步骤 4：运行 registry tests 和 package typecheck。**
- [x] **步骤 5：增加 package README pair 并更新 MCP family index。**

### Task 2：发布 supervisor lifecycle state

**文件：**
- 修改：`packages/mcp/mcp-client/src/index.ts`
- 修改：`packages/mcp/mcp-client/src/connection.ts`
- 修改：`packages/mcp/mcp-client/package.json`
- 修改：`packages/mcp/mcp-client/tsconfig.json`
- 修改：`packages/mcp/mcp-client/tests/apply.spec.ts`
- 修改：`packages/mcp/mcp-client/tests/reconnect.spec.ts`

**接口：**
- 消费可选的 `ctx.mcpConnectors` 及其 registration handle。
- 在 initial start、successful synchronization、connection loss、retry、explicit HTTP authorization failure、retry exhaustion 和 disposal 时产生 status updates。

- [x] **步骤 1：向现有 MCP supervisor fixtures 增加 lifecycle assertions。**
- [x] **步骤 2：运行 tests**，确认 publication 实现前 assertions 会失败。
- [x] **步骤 3：在启动 supervisor 前注册一个 server handle，并从 connection generations 和 synchronized public names 更新它。**
- [x] **步骤 4：只将明确的 401/403 HTTP failures 分类为 `auth-required`；其他 failures 保持稳定且 secret-free。**
- [x] **步骤 5：运行 MCP unit/reconnect tests 和 package typecheck。**

### Task 3：将 registry state 合并到 HARDNESS inventory

**文件：**
- 修改：`packages/hardness/adapters/src/connector-list-tool.ts`
- 修改：`packages/hardness/adapters/src/index.ts`
- 修改：`packages/hardness/adapters/package.json`
- 修改：`packages/hardness/adapters/tsconfig.json`
- 修改：`packages/hardness/adapters/tests/connector-list-tool.spec.ts`
- 修改：`packages/hardness/adapters/tests/adapters.spec.ts`

**接口：**
- `createConnectorListTool(authorization?, mcpConnectors?)` 返回同一个只读 tool，并带有合并后的封闭 output schema。
- Authorization rows 保留经过清理的 service metadata；MCP rows 只暴露 `kind`、`transport`、`status` 和 `tools`。

- [x] **步骤 1：增加失败的 merged-inventory tests**，覆盖 ready、disconnected、auth-required 和 absent-registry cases。
- [x] **步骤 2：运行 focused adapter tests**，确认新的 assertions 会失败。
- [x] **步骤 3：实现 merged projection**，只要任一 optional source 存在就注册该 tool。
- [x] **步骤 4：运行 adapter tests、typecheck 和 focused Oxlint。**

### Task 4：组合、记录文档并验证 model-visible contract

**文件：**
- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`docs/config-catalog.md`
- 修改：`docs/config-catalog.zh.md`
- 修改：`pnpm-lock.yaml`
- 修改：`.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.md`
- 修改：`.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.zh.md`
- 修改：`.agents/notes/implemented/feature/2026-08-29-model-connector-inventory.i18n.yaml`
- 修改：`examples/headless-agent/tests/keyless-smoke.e2e.ts` 及其 connector-inventory fixture。

**接口：**
- Base composition 在 optional MCP clients 和 HARDNESS adapters 之前挂载 registry。
- Model-visible output 是封闭的，并排除 transport secrets 和 raw failure details。

- [x] **步骤 1：挂载 registry 并重新生成 config catalog。**
- [x] **步骤 2：更新 implemented Agent Note 和 bilingual sidecar。**
- [x] **步骤 3：更新 inventory tool 的 assembled keyless snapshot。**
- [x] **步骤 4：运行 focused tests、snapshot tests、typecheck、`verify-translation-pairing`、`verify-config-catalog` 和 `git diff --check`。**
- [ ] **步骤 5：在不 push 的情况下提交完整 local change。**
