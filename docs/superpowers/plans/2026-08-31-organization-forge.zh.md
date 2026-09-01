# Organization Forge 实施计划

[English](2026-08-31-organization-forge.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将现有 Organization Forge ledger 转换为用于研究、审计、构建、验证和交付企业或系统的持久化证据驱动协调器。

**架构：** 扩展 `OrganizationForgeLedger` 和现有 `organization_forge` 工具，加入明确的研究、蓝图、工作、交付物、策略、重新验证和经过清理的 Atlas 记录。保留会话事件作为持久化权威，现有工具和沙箱作为执行权威，独立 goal judge 作为完成权威。

**技术栈：** TypeScript strict mode、Cordis 服务、现有 goal/session 事件、现有 goal 工具、Vitest、生成的文档目录和现有 HARDNESS 元数据类型。

**规范：** `docs/superpowers/specs/2026-08-31-organization-forge-design.md`

## 全局约束

- Forge 是可选能力，与 goal engine、tool registry、sandbox、permissions、connectors 和 deployment authority 保持分离。
- Forge 构建必须具有研究证据、通过复用前和修改后审计的来源、已验证交付物、已验证必需标准以及独立 judge 通过结果，才能进入 `ready`。
- Atlas 记录只包含经过清理的可复用元数据；客户数据、秘密、令牌、私有文档和部署特定标识都会被拒绝。
- 可恢复失败会创建修复或替代策略记录，不会关闭构建。
- 未经用户明确选择管理模式和现有权限控制，不会启用自主管理。
- 每个对模型可见的变更和结果都必须能从所属会话事件日志重建。

---

### 任务 1：增加持久化 Forge 研究和构建记录

**文件：**
- 修改：`packages/goal/goal/src/organization-forge.ts`
- 测试：`packages/goal/goal/tests/organization-forge.spec.ts`

**接口：**
- 使用：现有 `OrganizationForgeSnapshot`、`OrganizationForgeChange`、`OrganizationForgeLedger` 和 `Session.append`。
- 产出：`OrganizationForgeResearch`、`OrganizationForgeBlueprint`、`OrganizationForgeDeliverable`、`OrganizationForgeWorkItem`、`OrganizationForgeStrategy`、`OrganizationForgeAtlasEntry`，以及 ledger 方法 `addResearch`、`setBlueprint`、`addDeliverable` 和 `markDeliverable`。

- [x] **步骤 1：编写失败的持久记录测试**

增加测试：启动 Forge，记录可比仓库和工具来源作为研究，设置包含组件、基础设施、自动化、工作流、指标、成本控制和质量目标的蓝图，随后添加交付物并使用工件引用验证。断言所有记录都能通过 `foldOrganizationForge` 和独立读取恢复。

```text
forge = ledger.addResearch(agent, forge.id, {
  kind: 'repository', title: 'Comparable platform', locator: 'https://github.com/example/platform',
  summary: 'Public reference implementation', relevance: 'Workflow and deployment comparison',
})
forge = ledger.setBlueprint(agent, forge.id, {
  components: ['api'], infrastructure: ['local sandbox'], automations: ['daily check'],
  workflows: ['research-build-verify'], metrics: ['test pass rate'], costControls: ['deterministic checks'],
  qualityTargets: ['all required criteria verified'],
})
forge = ledger.addDeliverable(agent, forge.id, {
  name: 'working service', kind: 'software', artifactRef: 'artifact:service-v1',
})
forge = ledger.markDeliverable(agent, forge.id, forge.deliverables[0].id, 'verified', ['test:service', 'smoke:service'])
expect(foldOrganizationForge(session.events).get(forge.id)?.deliverables[0]?.status).toBe('verified')
```

- [x] **步骤 2：运行聚焦测试并确认失败**

运行 `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks`。

预期：失败，因为新的记录类型、快照字段和 ledger 方法尚不存在。

- [x] **步骤 3：实现最小的类型记录和快照字段**

增加带稳定 id 和证据数组的有界标准化记录。扩展 change operation union 和快照，加入 `research`、可选 `blueprint`、`deliverables`、`work`、`strategies`、`atlasEntries` 以及可选 `goalRef`。在 `start()` 中初始化所有新集合，保持现有调用方有效。

- [x] **步骤 4：实现带持久化完整快照事件的 ledger 变更**

实现 `addResearch`、`setBlueprint`、`addDeliverable` 和 `markDeliverable`。`verified` 必须提供非空证据；拒绝无效 id、过长文本、无效状态以及在构建进入 `verifying` 前验证交付物。每次变更都增加 Forge revision 并追加 `organization-forge/change`。

- [x] **步骤 5：运行聚焦测试和类型检查**

运行 `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` 和 `pnpm exec tsc -b packages/goal/goal --pretty false`。

预期：新测试和既有 Forge 测试通过，软件包类型检查通过。

### 任务 2：强制研究优先的质量检查和恢复记录

**文件：**
- 修改：`packages/goal/goal/src/organization-forge.ts`
- 测试：`packages/goal/goal/tests/organization-forge.spec.ts`

**接口：**
- 使用：任务 1 的记录和现有来源审计逻辑。
- 产出：`addWork`、`recordStrategy`、`revalidateSource`、`publishAtlasEntry` 以及确定性的 ready 检查。

- [x] **步骤 1：编写失败的检查和恢复测试**

增加测试：没有研究时拒绝设计，没有蓝图时拒绝构建，没有真实交付物时拒绝验证；保留失败策略作为非终止工作记录；重复失败指纹时要求不同的策略 id；Atlas 中出现秘密样式文本时拒绝发布。

```text
expect(() => ledger.advance(agent, forge.id, 'designing')).toThrow('research evidence')
expect(() => ledger.advance(agent, forge.id, 'building')).toThrow('blueprint')
expect(() => ledger.advance(agent, forge.id, 'verifying')).toThrow('deliverable')
expect(ledger.recordStrategy(agent, forge.id, {
  name: 'fallback', status: 'failed', failureFingerprint: 'missing-tool', summary: 'Tool unavailable',
}).phase).not.toBe('blocked')
expect(() => ledger.publishAtlasEntry(agent, forge.id, {
  name: 'bad', summary: 'api_key: secret', reusablePattern: 'unsafe',
})).toThrow('secret')
```

- [x] **步骤 2：运行新测试并确认失败**

运行 `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks`。

预期：失败，因为当前生命周期只检查来源审计，也没有恢复或 Atlas 记录。

- [x] **步骤 3：实现确定性的生命周期保护**

进入 `designing` 前至少需要一条研究记录，进入 `building` 前需要蓝图，进入 `verifying` 前需要已验证交付物。进入设计和所有后续阶段前，每个复用来源都必须通过两次审计。`ready` 仍是唯一交付阶段。

- [x] **步骤 4：实现策略和活动工作记录**

增加带 `active`、`completed` 和 `failed` 状态的策略指纹和工作记录。重复失败指纹不能作为相同策略再次记录；方法必须要求新的策略 id/name，并保持 Forge 活动。已完成工作保留在持久历史中，同时提供只返回活动工作的 projection helper 供 UI 使用。

- [x] **步骤 5：实现重新验证和清理后的 Atlas 发布**

增加 `revalidateSource` 作为带当前时间和证据的修改后审计操作。增加 `publishAtlasEntry`，验证标题、摘要、可复用模式和来源 id，拒绝类似凭据的值和私有定位符，并要求通过复用前/修改后审计和当前重新验证。Forge 快照只保存清理后的元数据。

- [x] **步骤 6：运行聚焦测试和类型检查**

运行 `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` 和 `pnpm exec tsc -b packages/goal/goal --pretty false`。

预期：生命周期、恢复、安全和重放测试全部通过。

### 任务 3：通过面向模型的工具暴露完整工作流

**文件：**
- 修改：`packages/goal/tool-goal/src/index.ts`
- 测试：`packages/goal/tool-goal/tests/organization-forge.spec.ts`
- 修改：`packages/goal/tool-goal/README.md`
- 修改：`packages/goal/tool-goal/README.zh.md`

**接口：**
- 使用：任务 1 和任务 2 的 ledger 方法以及现有 `judgeGoalCompletion`。
- 产出：`organization_forge` 的 `research`、`blueprint`、`deliverable`、`work`、`strategy`、`revalidate` 和 `atlas` 操作，以及模型可见的 `nextAction` 投影。

- [x] **步骤 1：编写失败的工具测试**

增加真实工具注册 fixture，调用 `organization_forge` 的 `start`、`research`、`blueprint`、`deliverable`、`work`、`strategy`、`revalidate`、`atlas` 和 `judge`。断言输出包含下一个必需动作、不包含凭据，并且只有 judge 通过且所有必需证据完成后才包含交接问题。

- [x] **步骤 2：运行聚焦工具测试并确认失败**

运行 `pnpm exec vitest run packages/goal/tool-goal/tests/organization-forge.spec.ts --pool=forks`。

预期：失败，因为新的操作参数、分发分支和投影字段尚不存在。

- [x] **步骤 3：扩展工具 schema 和描述**

增加研究元数据、蓝图列表、交付物字段、工作和策略状态、重新验证证据以及 Atlas 元数据的严格参数。更新 guidance，说明 `start` 之后第一动作是 `research`，被拒绝的 judge 结果仍保持活动状态，最终交接问题不是完成替代品。

- [x] **步骤 4：实现分发和 next-action 投影**

将每个操作路由到 ledger；只有 `start` 和 `management` 使用直接人类权限；根据当前阶段和缺失证据生成 `nextAction`。只有 ledger 返回 `ready` 时才包含准确的交接问题和管理选项。

- [x] **步骤 5：扩展独立 judge 输入**

把当前 Forge revision、研究、蓝图、活动工作、策略、交付物、审计、重新验证证据和标准发送给 `judgeGoalCompletion`。把 `needs_changes` 结果保存为下一批修复工作，而不是返回终止成功。

- [x] **步骤 6：运行工具测试和软件包类型检查**

运行 `pnpm exec vitest run packages/goal/tool-goal/tests/organization-forge.spec.ts packages/goal/goal/tests/organization-forge.spec.ts --pool=forks` 和 `pnpm exec tsc -b packages/goal/tool-goal --pretty false`。

预期：所有工具操作、输出门控和软件包声明通过。

### 任务 4：在文档和证据中注册能力

**文件：**
- 修改：`packages/goal/goal/README.md`
- 修改：`packages/goal/goal/README.zh.md`
- 修改：`docs/subsystems/goal.md`
- 修改：`docs/subsystems/goal.zh.md`
- 创建：`.agents/notes/implemented/feature/2026-08-31-organization-forge.md`
- 创建：`.agents/notes/implemented/feature/2026-08-31-organization-forge.zh.md`
- 创建：`.agents/notes/implemented/feature/2026-08-31-organization-forge.i18n.yaml`

- [x] **步骤 1：记录当前 Forge 协议**

记录面向模型的操作、持久化记录、研究优先顺序、审计检查、恢复行为、Atlas 清理、角色职责、judge 要求和最终交接问题。保留 goal 软件包作为所有者，并链接设计规范。

- [x] **步骤 2：更新已实现 Agent Note**

用现在时记录已发布机制、考虑过的替代方案、安全后果、失败行为和准确测试证据。不写入私密数据或凭据。

- [x] **步骤 3：重新生成文档派生物**

运行 `pnpm run verify-translation-pairing --write packages/goal/goal/README.md docs/subsystems/goal.md .agents/notes/implemented/feature/2026-08-31-organization-forge.md` 以及相关文档生成器。

### 任务 5：验证完整变更

- [x] **步骤 1：运行聚焦 goal 和工具套件**

运行 `pnpm exec vitest run packages/goal/goal/tests/organization-forge.spec.ts packages/goal/tool-goal/tests/organization-forge.spec.ts --pool=forks`。

- [x] **步骤 2：运行构建路径和类型检查**

运行 `pnpm run typecheck`、`node apps/cli/lib/bin.js --help` 和 goal/tool-goal 工件的软件包构建 smoke。

- [x] **步骤 3：运行文档和 hygiene 检查**

运行 `pnpm run doc-sync`、`pnpm run verify-agent-note-format`、`pnpm run verify-translation-pairing` 和 `git diff --check`。

- [x] **步骤 4：检查最终需求矩阵**

确认设计规范中的每项要求都有实现、聚焦测试、持久证据路径和文档限制。将整个仓库中预先存在的失败单独报告，不将其视为 Forge 证据。

## 自检清单

- 研究发生在设计或复用之前：任务 1–2。
- 复用前/修改后审计和重新验证会限制复用及 Atlas 发布：任务 2。
- 真实交付物和证据限制 ready：任务 1–3。
- 失败方案保持活动状态并要求替代策略：任务 2。
- IT、Security 和 R&D 保持模块化，活动工作与历史分离：任务 1–2。
- 独立 judge 接收完整 Forge 状态，拒绝结果回到修复循环：任务 3。
- Atlas 经过清理，管理需要用户明确选择：任务 2–3。
- 会话重放和模型可见记录仍由事件提供：任务 1–2。
