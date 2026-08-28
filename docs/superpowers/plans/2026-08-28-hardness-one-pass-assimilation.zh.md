# HARDNESS 单次同化实施计划

[English](2026-08-28-hardness-one-pass-assimilation.md) | 中文

> **面向代理式执行者：** 必须使用子技能：按任务执行本计划时，使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 在一次任务执行中，打通从已编目能力到受治理执行、基于证据的验证以及丰富 UI 的完整纵向路径。

**架构：** 扩展现有 HARDNESS 适配器层，而不是创建第二个控制平面。生产组合将明确连接 OpenClaw 的获取/执行，保守地丰富能力描述符，将成功结果规范化为 artifact，并让晋级/隔离始终受证据约束。

**技术栈：** TypeScript 6、Vitest、Cordis、HARDNESS、PHOENIX tools/skills、OpenClaw 兼容运行时。

**规范：** `docs/superpowers/specs/2026-08-28-hardness-one-pass-assimilation-design.zh.md`

## 全局约束

- 在最终验证并集成之前，只在 `feat/hardness-one-pass-assimilation` 上工作。
- 不得削弱 HARDNESS 验证，也不得执行仅存在于目录中的能力。
- 不得绕过 PHOENIX 审批，也不得暴露凭据。
- 不得加入新的 donor 目录或无关功能。
- 所有生产行为变更都必须测试优先。
- 只有在候选 head 的精确版本通过验证后，`main` 和 `stable` 才能移动。

---

### 任务 1：单次编排回归

**文件：**
- 修改：`packages/hardness/adapters/tests/mission-orchestrator.spec.ts`
- 修改：`packages/hardness/adapters/src/mission-orchestrator.ts`

**接口：**
- 消费：`HardnessService.route`、`AcquisitionRegistry.acquireOrBuild`、`executeCapabilityNeed`。
- 产出：一次任务调用完成一次获取、恢复路由、执行、渲染、记录证据以及晋级/隔离。

- [ ] 添加一个失败测试，证明初始不可路由的能力能在同一个 `runHardnessMission` 调用中被获取并完成。
- [ ] 运行 `pnpm exec vitest run packages/hardness/adapters/tests/mission-orchestrator.spec.ts`，并确认新行为为 RED。
- [ ] 实现所需的最小编排改动。
- [ ] 重新运行聚焦测试并确认 GREEN。

### 任务 2：将结果规范化为丰富 artifact

**文件：**
- 修改：`packages/hardness/adapters/tests/artifact-runtime.spec.ts`
- 修改：`packages/hardness/adapters/src/artifact-runtime.ts`
- 修改：`packages/hardness/adapters/src/mission-orchestrator.ts`

**接口：**
- 产出：`artifactFromCapabilityResult(result, fallbackId)`，保留显式 `meta.artifact`，并安全地将普通成功的结构化/文本输出规范化。

- [ ] 为没有 `meta.artifact` 的 JSON/文本结果添加 RED 用例。
- [ ] 实现保守规范化：不凭空生成 HTML，也不授予外部动作权限。
- [ ] 确认 artifact-runtime 与 mission-orchestrator 测试为 GREEN。

### 任务 3：描述符丰富化

**文件：**
- 修改：`packages/hardness/adapters/tests/adapters.spec.ts`
- 修改：`packages/hardness/adapters/src/tool-adapter.ts`
- 修改：`packages/hardness/adapters/src/skill-adapter.ts`

**接口：**
- 产出：描述符的 inputs/outputs/compatibility/limitations 反映注册表中可发现的元数据，而不是无条件使用空数组。

- [ ] 为 tool schema 输入/输出提示与 skill 来源/兼容性提示添加 RED 断言。
- [ ] 只从注册表现有可见元数据中实现保守提取。
- [ ] 保持状态为 `experimental`；验证仍然由证据驱动。
- [ ] 确认 adapter 测试为 GREEN。

### 任务 4：OpenClaw 生产接线

**文件：**
- 修改：`packages/hardness/adapters/tests/mission-runtime.spec.ts`
- 修改：`packages/hardness/adapters/tests/openclaw-broker.spec.ts`
- 修改：`packages/hardness/adapters/src/index.ts`
- 仅当现有 seam 需要时修改/创建：`packages/hardness/adapters/src/openclaw/*`

**接口：**
- 消费：`OpenClawCapabilityBroker.acquire/execute`。
- 产出：把显式 broker 传给 `createHardnessAcquisition(...)`，并把 executor 传给 `installHardnessMissionRuntime(...)`。

- [ ] 添加一个 RED 的生产组合测试，证明 OpenClaw 不只是被索引，而是实际提供给获取/执行路径。
- [ ] 复用现有 broker/host seam；不得创建第二个控制平面。
- [ ] 如果不存在安全、具体的 installer，则以明确的准备诊断 fail-closed，而不是假装目录可执行。
- [ ] 确认 mission-runtime/OpenClaw 聚焦测试为 GREEN。

### 任务 5：证据、版本失效与隔离

**文件：**
- 修改：`packages/hardness/adapters/tests/mission-orchestrator.spec.ts`
- 仅按需修改：`packages/hardness/adapters/src/mission-orchestrator.ts`

**接口：**
- 证据中的 descriptor version 必须与已路由 surface 的版本一致。
- renderer 失败与确定性执行失败必须隔离对应的精确能力版本。

- [ ] 为 renderer 失败、执行失败以及版本绑定证据添加 RED 用例。
- [ ] 实现最小修正。
- [ ] 确认 GREEN。

### 任务 6：回归 gate 与集成

**文件：** 除非 gate 揭示具体回归，否则不修改生产代码。

- [ ] 运行聚焦 HARDNESS adapter 套件：`pnpm exec vitest run packages/hardness/adapters/tests`。
- [ ] 运行 `pnpm typecheck`。
- [ ] 运行 `pnpm build`。
- [ ] 运行 PR 上可用的仓库 CI gates。
- [ ] 将分支与最新 `main` 比较；rebase/merge 最新 `main` 到功能分支，同时不覆盖并行工作。
- [ ] 在精确的集成后 head 上重新运行聚焦测试/typecheck/build。
- [ ] 只有精确 head 通过时，才把已验证 PR 合并到 `main`。
- [ ] 重新验证 `main` head 状态。
- [ ] 仅在 `main` 验证后，将 `stable` fast-forward 到已验证的 `main` SHA。
