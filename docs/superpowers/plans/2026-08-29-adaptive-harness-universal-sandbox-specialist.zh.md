# 自适应 Harness、通用沙箱与专家实验室实施计划

[English](2026-08-29-adaptive-harness-universal-sandbox-specialist.md) | 中文

**目标：** 让 Phoenix 继续执行一次获批的完整任务计划，在统一的自适应沙箱表面中显示并执行受支持的产物，并持久化有证据的专家实验室。

**架构：** 扩展现有审批与 HARDNESS 产物 seam，使用持久会话事件和一个客户端表面。专家能力复用 goal supervisor、web provider、sandbox、skill 与 judge，不修改 agent loop。计时器、输出限制和追加式 replay 保证无人值守进度可恢复且有界。

**技术栈：** TypeScript、React、CSS Modules、Cordis service/event、JSONL、SQLite、Vitest、Vite Web tests、Playwright 和 pnpm。

**规范：** `docs/superpowers/specs/2026-08-29-adaptive-harness-design.md`

## 全局约束

- 使用一个完整 mission plan；只有初始批准需要用户明确确认。
- 每个后续审批都有经过验证的有限期限和持久化自动结果。
- 高风险审批到期默认拒绝，并继续使用有界替代策略。
- 可执行产物只能通过现有 sandbox policy 或空 iframe sandbox 运行，默认不授予网络或父页面访问。
- 所有模型可见状态都由会话事件表示并可 replay。
- Specialist 进入 ready 必须有独立 judge 证据；retry 和 refresh 有界且可配置。
- 保留上游 `@phoenix-ai/cordis` 与 vendor 身份；Phoenix 自有包使用 `@phoenix-ai/*`。
- 英文与必需的 `.zh.md` 文档必须同步更新，并运行 pairing 检查。

### Task 1：持久化审批期限与单一计划策略

**文件：**

- Modify: `packages/interaction/user-approval/src/types.ts`
- Modify: `packages/interaction/user-approval/src/index.ts`
- Modify: `packages/host/apiproxy/src/api/approvals.ts`
- Modify: `packages/host/apiproxy/src/api/approvals.schema.ts`
- Modify: `packages/client/runtime/src/client/sessions/pending.ts`
- Modify: `packages/client/runtime/src/client/sessions/session.ts`
- Create: `packages/interaction/user-approval/tests/deadline.spec.ts`
- Create: `packages/host/apiproxy/tests/api-approval-deadline.spec.ts`

**接口：**

- 产生 `ApprovalRisk`、`ApprovalRecommendation` 与 `ApprovalDeadline` 类型。
- `ApprovalService.request` 在期限前解决并追加 `approval/decided`。
- 低风险且可逆的动作到期默认允许一次；其他动作到期默认拒绝。
- API approval frame 携带 deadline 并保留现有响应方法。

**步骤：**

- [ ] **Step 1：** 编写失败的 deadline 与 risk tests
- [ ] **Step 2：** 运行 focused tests 并确认缺少 deadline 的行为失败
- [ ] **Step 3：** 实现持久 deadline 与有界决策路径
- [ ] **Step 4：** 运行 focused tests 并确认通过
- [ ] **Step 5：** 将单一计划规则加入 goal prompt 与 tests
- [ ] **Step 6：** 提交 approval seam

### Task 2：自适应审批倒计时 UI

**文件：**

- Modify: `packages/client/ui-user-questions/src/client/UserQuestionComposer.tsx`
- Modify: `packages/client/ui-user-questions/src/client/contract/slots.ts`
- Create: `packages/client/ui-user-questions/src/client/ApprovalCountdown.tsx`
- Create: `packages/client/ui-user-questions/src/client/ApprovalCountdown.module.css`
- Modify: `packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx`
- Create: `packages/client/ui-user-questions/tests/approval-countdown.client.spec.tsx`
- Modify: `apps/web/tests/approval-composer.e2e.ts`

**接口：**

- `ApprovalCountdown` 接收 deadline、risk、recommendation、onExpire 与 onChoose。
- 通过文本与 aria label 暴露剩余秒数，并且每秒更新一次。
- 使用现有响应式断点，不创建第二个 approval panel。

**步骤：**

- [ ] **Step 1：** 编写失败的 component tests
- [ ] **Step 2：** 运行 tests 并确认组件缺失
- [ ] **Step 3：** 实现倒计时并挂载到现有 composer
- [ ] **Step 4：** 运行 unit tests 与 approval browser scenario
- [ ] **Step 5：** 提交 countdown UI

### Task 3：通用产物 envelope 与自适应 renderer

**文件：**

- Modify: `packages/client/ui-conversation/src/client/conversation-nodes/hardness-artifact.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/HardnessArtifactNodeView.tsx`
- Create: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.tsx`
- Create: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.module.css`
- Modify: `packages/client/ui-conversation/tests/hardness-artifact-node.client.spec.ts`
- Create: `packages/client/ui-conversation/tests/universal-artifact-surface.client.spec.tsx`
- Modify: `packages/client/ui-workspace/src/client/hardness-rpc.ts`
- Modify: `packages/api/gateway/src/hardness-rpc.ts`

**接口：**

- `ArtifactKind` 覆盖 json、table、html、code、markdown、text、image 与 execution。
- `UniversalArtifactEnvelope` 包含 id、title、kind、mime、data、language、executable、source、size 与 result。
- surface 从 kind 选择纯 renderer，并提供 run、stop、restart、copy、download 与 expand。

**步骤：**

- [ ] **Step 1：** 编写失败的 normalization 与 rendering tests
- [ ] **Step 2：** 运行 tests 并确认 universal surface 缺失
- [ ] **Step 3：** 实现 envelope adapter 与 surface
- [ ] **Step 4：** 增加持久 source/result RPC 字段
- [ ] **Step 5：** 运行 focused renderer、RPC 与 client type checks
- [ ] **Step 6：** 提交 universal artifact surface

### Task 4：沙箱执行与持久化产物结果

**文件：**

- Modify: `packages/hardness/adapters/src/visual-runtime.ts`
- Modify: `packages/hardness/adapters/src/sandbox-guard.ts`
- Modify: `packages/hardness/adapters/tests/visual-runtime.spec.ts`
- Modify: `packages/hardness/adapters/tests/sandbox-guard.spec.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.tsx`
- Modify: `packages/session/session/src/types.ts`

**接口：**

- `runArtifact` 只接受 executable 产物，并返回有配置上限的 status、stdout、stderr、files 与 durationMs。
- HTML/JavaScript 使用 browser sandbox；Python 与 process code 使用配置的 server sandbox。
- `artifact/source` 与 `artifact/result` 可 replay，重建时不重新运行代码。

**步骤：**

- [ ] **Step 1：** 增加 execution、timeout、cancellation 与 replay tests
- [ ] **Step 2：** 运行 adapter tests 并确认新 contract 失败
- [ ] **Step 3：** 实现一个受保护的 execution path
- [ ] **Step 4：** 运行 focused adapter 与 UI tests
- [ ] **Step 5：** 提交 sandbox execution

### Task 5：持久化 specialist laboratory capability

**文件：**

- Create: `packages/specialist/specialist/src/types.ts`
- Create: `packages/specialist/specialist/src/domain.ts`
- Create: `packages/specialist/specialist/src/fold.ts`
- Create: `packages/specialist/specialist/src/index.ts`
- Create: `packages/specialist/specialist/tests/domain.spec.ts`
- Create: `packages/specialist/specialist/tests/fold.spec.ts`
- Modify: `packages/session/session/src/types.ts`
- Modify: `packages/goal/goal-round-driver/src/prompt.ts`

**接口：**

- `SpecialistPhase` 覆盖 scoping、researching、hypothesizing、experimenting、evaluating、ready 与 blocked。
- `SpecialistProfile` 保存 id、subject、objective、criteria、riskClass 与 refreshPolicy。
- `SpecialistEvent` 保存 source、dataset、hypothesis、experiment、result、improvement 与 judge transition，并限制内容与 provenance。
- `foldSpecialist` 返回一个实验室的持久视图；非法 transition 在 append 前失败。

**步骤：**

- [ ] **Step 1：** 编写失败的 fold 与 transition tests
- [ ] **Step 2：** 运行 specialist tests 并确认 seam 缺失
- [ ] **Step 3：** 实现 domain、fold 与 plugin registration
- [ ] **Step 4：** 增加 specialist mission prompt contract
- [ ] **Step 5：** 运行 tests 与 host typecheck
- [ ] **Step 6：** 提交 specialist domain

### Task 6：specialist tools、自动实验与 judge loop

**文件：**

- Create: `packages/specialist/tool-specialist/src/index.ts`
- Create: `packages/specialist/tool-specialist/src/invariant.ts`
- Create: `packages/specialist/tool-specialist/tests/tool-specialist.spec.ts`
- Modify: `packages/goal/goal-round-driver/src/index.ts`
- Modify: `packages/goal/tool-goal/src/judge.ts`
- Modify: `packages/skill/skill/src/index.ts`

**接口：**

- specialist tools 使用 branded lab ids 管理 start、status、source、experiment 与 refresh。
- `selectNextLabAction` 选择有界的下一步，不立即重复失败动作。
- `judgeSpecialist` 返回结构化 verdict 与 required improvements；只有 pass 进入 ready。

**步骤：**

- [ ] **Step 1：** 编写失败的 tool 与 judge-loop tests
- [ ] **Step 2：** 运行 tool tests 并确认缺失行为
- [ ] **Step 3：** 实现有界 action selection 与 provider composition
- [ ] **Step 4：** 将 refresh scheduling 实现为显式 opt-in
- [ ] **Step 5：** 运行 specialist、goal 与 integration tests
- [ ] **Step 6：** 提交 specialist orchestration

### Task 7：自适应 specialist UI 与 assembled Web coverage

**文件：**

- Create: `packages/client/ui-specialist/src/client/SpecialistPanel.tsx`
- Create: `packages/client/ui-specialist/src/client/SpecialistPanel.module.css`
- Create: `packages/client/ui-specialist/src/client/index.ts`
- Create: `packages/client/ui-specialist/tests/specialist-panel.client.spec.tsx`
- Modify: `apps/web/tests/goal-multi-turn-actions.e2e.ts`
- Create: `apps/web/tests/specialist-lab.e2e.ts`
- Modify: `packages/client/ui-conversation/src/client/chat/UniversalArtifactSurface.module.css`

**接口：**

- panel 显示当前 phase、evidence count、active experiment、judge verdict、next action 与 refresh 状态。
- 宽屏使用 compact cards，窄屏使用单列 flow；不得用固定高度裁剪 active artifact。

**步骤：**

- [ ] **Step 1：** 编写失败的 panel tests
- [ ] **Step 2：** 运行 tests 并确认 panel 缺失
- [ ] **Step 3：** 实现自适应 panel 与 slot registration
- [ ] **Step 4：** 增加 assembled Web coverage
- [ ] **Step 5：** 运行 UI 与 Web tests
- [ ] **Step 6：** 提交 specialist UI

### Task 8：文档、gates 与 release evidence

**文件：**

- Modify: `packages/interaction/user-approval/README.md`
- Modify: `packages/interaction/user-approval/README.zh.md`
- Modify: `packages/client/ui-conversation/README.md`
- Modify: `packages/client/ui-conversation/README.zh.md`
- Create: `packages/specialist/README.md`
- Create: `packages/specialist/README.zh.md`
- Create: `.agents/notes/implemented/architecture/2026-08-29-adaptive-harness.md`
- Create: `.agents/notes/implemented/architecture/2026-08-29-adaptive-harness.zh.md`

**步骤：**

- [ ] **Step 1：** 记录已交付的 contract 与限制
- [ ] **Step 2：** 运行 focused 与 repository gates
- [ ] **Step 3：** 运行 browser verification
- [ ] **Step 4：** 检查最终 diff 与 status
- [ ] **Step 5：** 编写 implementation note 并提交文档
