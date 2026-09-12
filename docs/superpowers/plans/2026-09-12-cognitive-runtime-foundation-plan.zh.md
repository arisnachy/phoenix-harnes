# PHOENIX 认知运行时基础实施计划

[English](2026-09-12-cognitive-runtime-foundation-plan.md) | 中文

> **面向 agent（智能体）工作者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 子技能执行此计划。步骤使用复选框（`- [ ]`）进行跟踪。

**目标：** 增加一个确定性的只读认知投影，从 PHOENIX 现有的 `session-learning` 记录派生注意力、有界工作记忆和全局工作区。

**架构：** 扩展 `dsh-session-learning`，增加一个有界的会话范围读取，由现有 `packages/session` 分组中的新 `dsh-cognitive-runtime` 服务使用。保持注意力、分区和快照构造为纯函数；让 Cordis 服务只拥有生命周期、会话查找、刷新串行化和上一次成功状态的保留。在不增加模型上下文或持久事件类型的前提下，将服务挂载到 `dsh-base` 的 `session-learning` 之后。

**技术栈：** TypeScript ESM 工作区包、Cordis `Service`、Schemastery 配置、Vitest、YAML 组合包配置和生成式文档目录。

**规范：** [`2026-09-12-cognitive-runtime-foundation-design.md`](../specs/2026-09-12-cognitive-runtime-foundation-design.zh.md)

## 全局约束

- 原始会话日志仍是规范来源；不增加 `SessionEventMap` 成员。
- `session-learning` 仍是唯一的认知记忆权威；新服务只读取其有界记录。
- 注意力排名使用持久化时间戳和稳定的平局处理；不会调用 `Date.now()`、随机数、进程顺序或 LLM。
- 服务是只读的，不能授予权限、执行工具、改变目标或修改 `agent-loop`。
- 每个新包都必须有包 README、不变量配套插件、严格 TypeScript 和聚焦的 100% 源码覆盖率。
- 保留已有的脏 checkout 和无关的 auth／voice 改动；所有编辑都发生在 `codex/cognitive-runtime-foundation`。

---

### Task 1：增加按会话限定的认知记忆读取

**文件：**
- 修改：`packages/session/session-learning/src/index.ts`
- 修改：`packages/session/session-learning/tests/service.spec.ts`
- 修改：`packages/session/session-learning/README.md`
- 修改：`packages/session/session-learning/README.zh.md`

**接口：**
- 消费：现有的 `CognitiveMemoryLedger.timeline()` 和带品牌的 `SessionId`。
- 产出：`LearningMemoryService.cognitiveForSession(sessionId: SessionId, limit?: number): CognitiveMemoryRecord[]`，返回准确会话的活动记录，按持久化发生顺序排列并由 `limit` 限制。

- [ ] **步骤 1：编写失败测试**

增加服务测试，在两个会话中创建记录，使用小的 limit 调用 `cognitiveForSession()`，并断言只返回请求会话的活动记录且顺序确定。按照包现有校验风格，断言非正数、小数和超过上限的请求会拒绝或抛出。

- [ ] **步骤 2：运行聚焦测试确认失败**

运行：`pnpm exec vitest run packages/session/session-learning/tests/service.spec.ts`

预期：失败，因为 `cognitiveForSession` 尚未定义。

- [ ] **步骤 3：实现有界读取**

增加有文档说明的方法，校验正的安全整数 limit，调用 `this.cognitive.timeline({ sessionId: String(sessionId), includeHistory: false })`，并返回最新的 `limit` 条记录，同时保留时间顺序。不要将服务的当前项目默认值应用于此方法；调用方已经提供了准确的会话身份。

- [ ] **步骤 4：更新消费者文档**

说明该方法是只读的会话范围投影读取，不替代规范会话归档。在中文 README 中同步简短契约，并在仓库门禁要求时重新生成配对元数据。

- [ ] **步骤 5：运行聚焦测试并提交**

运行：`pnpm exec vitest run packages/session/session-learning/tests/service.spec.ts packages/session/session-learning/tests/cognitive.spec.ts`

预期：通过。提交信息为 `feat(cognition): expose bounded session memory reads`。

---

### Task 2：实现纯注意力和工作记忆投影

**文件：**
- 创建：`packages/session/cognitive-runtime/src/types.ts`
- 创建：`packages/session/cognitive-runtime/src/attention.ts`
- 创建：`packages/session/cognitive-runtime/src/working-memory.ts`
- 创建：`packages/session/cognitive-runtime/src/workspace.ts`
- 创建：`packages/session/cognitive-runtime/tests/attention.spec.ts`
- 创建：`packages/session/cognitive-runtime/tests/working-memory.spec.ts`

**接口：**
- 消费：来自 `dsh-session-learning` 的 `CognitiveMemoryRecord` 值。
- 产出：`AttentionWeights`、`AttentionCandidate`、`WorkingMemoryPartition`、`CognitiveState`、`scoreAttention()`、`partitionWorkingMemory()` 和 `createGlobalWorkspace()`。

- [ ] **步骤 1：编写确定性评分测试**

覆盖重要性／置信度／新近度、pending／error 紧迫性、mission／prospective 目标相关性、基于频率的新颖性、配置权重、只使用持久化时间的评分，以及按 `eventSeq`、`provenance.sourceUri`、再按 `id` 的平局处理。

- [ ] **步骤 2：运行纯测试确认失败**

运行：`pnpm exec vitest run packages/session/cognitive-runtime/tests/attention.spec.ts packages/session/cognitive-runtime/tests/working-memory.spec.ts`

预期：失败，因为新的源模块尚不存在。

- [ ] **步骤 3：实现纯投影**

在不使用环境时间的前提下实现信号提取和加权归一化。构造脱离引用的候选值，只排序一次，选择一个焦点候选，填充活动／后台预算，并将其余值分类为预算抑制。将 forgotten、superseded 和 obsolete 记录排除在活动候选之外。

- [ ] **步骤 4：增加边界测试**

断言空输入、相同时间戳、零可选预算、全部被过滤的记录、有限分数，以及投影后改变输入数组不会改变返回快照。

- [ ] **步骤 5：运行纯测试并提交**

运行：`pnpm exec vitest run packages/session/cognitive-runtime/tests/attention.spec.ts packages/session/cognitive-runtime/tests/working-memory.spec.ts --coverage --coverage.include='packages/session/cognitive-runtime/src/attention.ts' --coverage.include='packages/session/cognitive-runtime/src/working-memory.ts' --coverage.include='packages/session/cognitive-runtime/src/workspace.ts'`

预期：通过，选定源文件的语句、分支、函数和行覆盖率均为 100%。提交信息为 `feat(cognition): add deterministic attention workspace projection`。

---

### Task 3：增加 Cordis cognitive-runtime 服务

**文件：**
- 创建：`packages/session/cognitive-runtime/package.json`
- 创建：`packages/session/cognitive-runtime/tsconfig.json`
- 创建：`packages/session/cognitive-runtime/src/index.ts`
- 创建：`packages/session/cognitive-runtime/src/invariant.ts`
- 创建：`packages/session/cognitive-runtime/tests/service.spec.ts`
- 创建：`packages/session/cognitive-runtime/tests/invariant.spec.ts`

**接口：**
- 消费：`ctx.sessions`、`ctx.learningMemory`、纯投影函数、`session/created` 和 `session/event`。
- 产出：`ctx.cognitiveRuntime.get(sessionId)`、`refresh(sessionId)`、`ready()` 和解析后的只读 `config`。

- [ ] **步骤 1：编写服务生命周期测试**

使用包含 `SessionStore`、`LearningMemoryService` 和新服务的真实 `Context`。断言启动后会重建已有会话，相关事件追加会刷新快照，`assistant/chunk` 不会刷新，重复传递不会产生问题，缺失会话返回 `undefined`，并且失败刷新会保留上一次快照，后续刷新仍然可用。

- [ ] **步骤 2：运行服务测试确认失败**

运行：`pnpm exec vitest run packages/session/cognitive-runtime/tests/service.spec.ts packages/session/cognitive-runtime/tests/invariant.spec.ts`

预期：失败，因为包和服务尚不存在。

- [ ] **步骤 3：实现包配置和导出**

按照现有 session 包清单模式使用 `@phoenix-ai/dsh-cognitive-runtime`，添加对 Cordis、invariants、session、session-learning 和 schemastery 的 peer／dev 依赖，并提供明确的 ESM 导出。增加指向相同源码包的严格 `tsconfig.json` 引用。

- [ ] **步骤 4：实现生命周期所有权**

使用 `static inject = ['sessions', 'learningMemory']`。为当前会话播种，订阅 `session/created` 和相关持久事件，通过一个操作尾部串行化刷新，等待 `learningMemory.ready()`，并只在纯投影成功后更新状态映射。捕获刷新失败，通过宿主 logger 发出警告，并保留上一状态。通过 `ctx.invariants` 注册包不变量，并断言返回快照具有请求的会话身份及有界项目数量。

- [ ] **步骤 5：运行服务覆盖率并提交**

运行：`pnpm exec vitest run packages/session/cognitive-runtime/tests/service.spec.ts packages/session/cognitive-runtime/tests/invariant.spec.ts --coverage --coverage.include='packages/session/cognitive-runtime/src/**/*.ts'`

预期：可执行包源码覆盖率为 100%。提交信息为 `feat(cognition): add replayable cognitive runtime service`。

---

### Task 4：注册包并挂载只读服务

**文件：**
- 修改：`tsconfig.host.json`
- 修改：`packages/bundle/base/package.json`
- 修改：`packages/bundle/base/cordis.patch.yml`
- 修改：`packages/bundle/base/tests/base.spec.ts`

**接口：**
- 消费：已构建的包清单和 Cordis 服务注册。
- 产出：一个名为 `cognitive-runtime` 的基础组合包行，在 `session-learning` 之后加载，并不提供 prompt、tool、permission 或持久事件贡献。

- [ ] **步骤 1：增加 Host 项目引用和基础依赖**

在 `session-learning` 附近插入新包引用，并在基础组合包依赖中加入 `@phoenix-ai/dsh-cognitive-runtime: workspace:^`。

- [ ] **步骤 2：增加基础 patch 行**

在 `session-learning` 行之后立即插入 `cognitive-runtime` 服务。保持配置明确且有界；不要加入 opt-in prompt consumer 或任何 API key／配置密钥。

- [ ] **步骤 3：扩展组合包测试**

断言解析后的基础 patch 恰好包含一行 `cognitive-runtime`，并且它的位置紧跟在 `session-learning` 之后。断言该行没有 `disabled`、`tools` 或权限配置。

- [ ] **步骤 4：运行组合检查并提交**

运行：`pnpm exec vitest run packages/bundle/base/tests/base.spec.ts packages/session/cognitive-runtime/tests/service.spec.ts`；然后运行 `pnpm run verify-cordis-config`。

预期：通过。提交信息为 `feat(bundle): mount cognitive runtime foundation`。

---

### Task 5：记录已交付的决策并运行仓库门禁

**文件：**
- 创建：`packages/session/cognitive-runtime/README.md`
- 创建：`packages/session/cognitive-runtime/README.zh.md`
- 创建：`packages/session/cognitive-runtime/README.i18n.yaml`
- 创建：`.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.md`
- 创建：`.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.zh.md`
- 创建：`.agents/notes/implemented/architecture/2026-09-12-cognitive-runtime-foundation.i18n.yaml`
- 重新生成：由 `doc-sync` 负责的配置和 API 目录。

**接口：**
- 消费：已实现的包和批准的设计。
- 产出：维护者文档，说明当前所有权、确定性重放、无 prompt 效果、有界性、失败保留和延后的消费者。

- [ ] **步骤 1：编写包 README 和已实现 Agent Note**

描述组合、配置、服务方法、评分语义、失败行为、无模型可见效果和延后工作。Agent Note 必须使用已实现格式，包含 `Problem`、`Decision`、`Alternatives considered` 和 `Consequences`；记录为何拒绝新的持久事件总线、直接修改 `agent-loop` 和使用 LLM 评分注意力。

- [ ] **步骤 2：运行文档生成和检查**

运行：`pnpm run doc-sync`；检查生成的差异；然后运行 `git diff --check`。

预期：没有过期目录、配对、链接、文案预算或新鲜度错误。

- [ ] **步骤 3：运行相关的出站检查**

运行：`pnpm run change-scope --base origin/main`；`pnpm run typecheck`；`pnpm run lint`；`pnpm run build`；`pnpm run hygiene`；以及 Task 1–4 中的认知、session-learning 和基础组合包聚焦测试。

预期：所有选定检查通过；任何平台专属跳过都要记录准确命令和原因。

- [ ] **步骤 4：提交文档和可验证源码**

只有在检查生成文件和完整差异后，才以 `docs(cognition): document runtime foundation` 提交。

---

### Task 6：以准确 SHA 证据发布

**文件：**
- 仅在所有本地检查通过后修改 Git refs。

- [ ] **步骤 1：验证干净的 feature worktree 并记录 `HEAD`**

运行：`git status --short --branch`；`git rev-parse HEAD`；`git rev-parse origin/main origin/stable`。

- [ ] **步骤 2：正常推送 feature branch**

运行：`git push -u origin codex/cognitive-runtime-foundation`；验证 `git rev-parse HEAD origin/codex/cognitive-runtime-foundation`。

- [ ] **步骤 3：仅使用租约保护将变更整合到两个活动分支**

再次获取两个分支头。若已验证的 feature 基础仍是祖先，则从该基础快进 `main`；从已验证的 `stable` 头将同一组提交应用到 stable，只解决源码上下文差异。使用准确观测到的旧 OID 租约推送每个分支；如果远端移动或分支保护拒绝操作则停止。

- [ ] **步骤 4：验证远端包含关系**

运行 `git ls-remote origin refs/heads/main refs/heads/stable refs/heads/codex/cognitive-runtime-foundation`，并使用 `git merge-base --is-ancestor <commit> <remote-ref>` 证明认知提交可以从两个分支头到达。

- [ ] **步骤 5：分别报告本地、远端和 LIVE 证据**

说明准确提交、运行的测试、分支头和待处理的 GitHub 检查。没有与该 SHA 绑定的独立远端／CI 或运行时观察时，不要称 GitHub 分支已经 LIVE 验证。
