# Agent Note：通过显式认知工作流路由 mission

Status: implemented

[English](2026-09-14-hardness-cognitive-workflows.md) | 中文

## 问题

PHOENIX 已经拥有强大的执行原语：HARDNESS capability routing 与 evidence、持久 mission state、独立 mission judge、workflow execution、subagents、skills、planning、goals、guards 和 durable sessions。缺失的是程序化选择层。一个模型可能知道如何 brainstorming、系统化调试、测试驱动、研究证据、委派、审查、恢复或创建 follow-up，但 harness 之前没有一份规范清单明确说明这些过程有哪些、何时适用、如何组合，以及新证据何时应该增强当前过程。把这些完全交给单一模型会让质量依赖模型是否记得某种流程，并使不同 provider 的行为不一致。

目标不是创建第二个 agent loop 或第二个 workflow runtime。Harness 应利用持久的过程知识与现有执行 authority 的组合，让整个系统比任何单一模型更强，同时保留 approval、verification、judge、audit 与 recovery gate。

## 决策

`@phoenix-ai/dsh-hardness` 持有一个确定性的第一方认知工作流目录和纯 router。`CognitiveMissionProfile` 只包含有限的 mission 事实：类型、复杂度、风险、新颖性、代码/证据要求、独立子任务、持久性、既往失败、重复模式、结果是否面向用户，以及是否存在明确未来义务。`selectCognitiveWorkflow()` 将该 profile 映射为不可变、有序的 `CognitiveWorkflowPlan`；`adaptCognitiveWorkflow()` 在出现执行失败、验证失败、新风险、范围扩大、新发现独立子任务、重复失败或新发现未来义务等有限 observation 时增强 profile 并重新选择。

目录包含 26 个 flow：intent framing、context recovery、experience recall、recovery checkpointing、brainstorming、research/evidence、causal reasoning、systematic debugging、counterfactual simulation、architecture/design、implementation planning、parallel decomposition、fresh-agent execution、safe change、security/risk review、proof-driven development、metacognitive review、quality escalation、adversarial critique、independent judge、verification gate、outcome evaluation、failure immunization、procedural learning、experience consolidation 与 autonomous follow-up。

选择使用统一 canonical order 与 prerequisite closure，因此依赖 flow 不会出现在 prerequisite 之前。每个 mission 都包含 intent framing、fresh verification 与 outcome evaluation。调试必须先定位 root cause；代码修改要求 proof-driven development；高风险和高复杂度工作增加 adversarial 与 independent review；只有显式独立的工作才启用 parallel decomposition 与 fresh-agent execution；持久和重复工作启用 recovery 与 learning 类流程。明确未来义务只有在 mission 变为 persistent 后才激活 `autonomous-follow-up`。Quality-gate 标签描述下游 orchestration 应获得的可观察证据，但不授予任何权限。

`renderCognitiveWorkflowGuide()` 向模型公开目录与组合规则。HARDNESS prompt adapter 会把该 guide 与 `renderHardnessProtocol()` 一起安装，因此通过正常 HARDNESS composition 挂载的每个模型都会知道这些流程，无需依赖模型记得加载某个 skill。Guide 明确禁止暴露 private chain-of-thought，只允许记录决策、证据、产物和审计所需的有用理由。

Model-facing preset 还会挂载纯 `hardness_workflow` tool。模型提供经过 schema 验证的 mission profile，并可选提供一个有限 observation；HARDNESS 返回有序 selected flows、reasons、skipped flows 与 quality gates。Operating protocol 要求非 trivial mission 在 execution planning 前调用此 tool，并在有限证据实质改变 mission 时再次调用。该 tool 从 host capability projection 中排除，因此 HARDNESS 不会递归把自己的 router 宣传为 execution capability。

## Authority 边界

认知 routing 只负责程序化 planning。它不会执行 capability、批准权限、创建 tasks、选择 credentials，也不会替代 `ctx.workflowEngine`、`ctx.subagents`、`ctx.skills`、goals、plan state、session persistence 或 HARDNESS mission kernel。现有 HARDNESS lifecycle 仍然拥有最终 authority：`inspect → resolve → plan → approve → execute → verify → present → audit`。任何选中的 flow 都不能绕过 approval、independent judge、quality gate、capability evidence、quarantine 或 WALL_PROTOCOL recovery。

学习类 flow 也不会声称模型悄悄修改了自身权重，或把未经验证的文本当作 memory。它们只表示经过验证的 outcome 何时有资格被提取为可复用 procedure 或固化为经验；现有 mission/session/skill 系统仍是 persistence authority。`future-obligation-discovered` 可以让 workflow 变为 persistent 并选中 `autonomous-follow-up`，但真正创建或执行未来工作仍只属于现有 scheduler/proactivity authority。

## 考虑过的替代方案

**仅使用 skills** —— 不作为主要机制。Skills 仍适合承载 procedure 内容，但如果依赖模型自己记得发现和加载 skill，就会重新产生原来的不一致。

**仅使用 prompt guidance** —— 经审查后拒绝。稳定 guidance 能让模型看见目录，但精确 selection 仍依赖模型临场判断。`hardness_workflow` 给 harness 一个确定性的结构化 selection surface，同时保持 execution authority 在其他既有系统中。

**固定的用户可见 mode** —— 拒绝。真实 mission 往往混合 design、research、debugging、execution、review 与 recovery；单一 mode 会增加不必要分支，并且在证据变化时适应性差。

**第二套 workflow 或 agent runtime** —— 拒绝。PHOENIX 已有 provider-neutral workflow 与 subagent seam。重复建设会产生相互竞争的执行 authority，并使 recovery 更困难。

**修改 agent loop** —— 拒绝。目录、router 与 model-facing tool 都适合现有 extension point；agent loop 应继续保持可替换。

## 后果

模型得到稳定的高质量工作词汇以及由 harness 持有的确定性 router，因此过程不再只依赖 provider 记忆。Provider 可以更换而无需改变目录。失败可以增强 workflow，而不是过早结束 mission。由于 selection surface 是确定性且 JSON 可序列化的，因此无需模型调用即可测试，也无需保存 private reasoning 即可审计。

第一版有意不从隐藏推理中推断 `CognitiveMissionProfile`，也不会自行执行返回的 plan。模型或更高层 mission orchestration 提供有限 profile；已有 workflow/subagent/skill service 去实现 selected procedures，而 mission kernel 仍是 completion authority。

## 自主 fast path

Router 现在会先把每个已提供的 mission profile 确定性分类为 `fast`、`standard` 或 `deep`，再组合具体 flow。范围明确、低风险、低新颖性且局部的变更使用 `fast`：HARDNESS 继续拥有过程 authority，但跳过 brainstorming、architecture 与 implementation-plan 仪式，只选择最小安全变更，并要求新的定向验证与结果对照。若出现失败、范围扩大、风险上升、需要外部研究、持久性或独立子任务等新证据，mission 会确定性升级为 `standard` 或 `deep`，并启用该证据真正需要的更强流程。

Generic skill catalog 不再因为某个 methodology skill 看起来“适用”就制造第二次 approval loop。HARDNESS guide 要求只有当 methodology skill 实现当前 HARDNESS 已选择的 flow 时才加载它。在已经授权的 active goal round 中，不会再次为日常过程请求 approval；可恢复的执行或验证失败会触发修复、替代 route、能力获取/构建或策略轮换，然后继续。只有真正的外部依赖——例如必需 permission、缺失 credential、safety policy、provider quota 已耗尽、明确拒绝，或无法安全解决的外部 dependency——才允许暂停自主推进。

这不会削弱安全或完成语义。Fast mode 仍保留 permission/account authorization、safe-change/rollback 预期、fresh verification 与 objective-versus-outcome comparison。某个 tool 成功、某个 test 通过、内部 retry/window 用尽或一次 turn 结束，都不能让 mission 自动完成；在已配置的场景中，独立 judge 与 mission kernel 仍拥有最终完成 authority。

## 验证

Unit coverage 检查目录唯一性与 prerequisites、轻量 trivial selection、build/design/TDD selection、root-cause-first debugging、高风险 research、parallelization 约束、持久/重复工作的 recovery 与 learning、持久未来义务 follow-up、失败或风险变化后的 monotonic adaptation、quality-gate 标签、英中 model guide、`hardness_workflow` schema 与输出、model-preset mounting、host-side recursive-index exclusion，以及 cognitive guide 注入 HARDNESS system-prompt section。现有 HARDNESS operating、mission、approval、judge 与 evidence 测试继续作为执行安全的 regression authority。

自主扩展还覆盖确定性的 `fast`/`standard`/`deep` 选择、fast path 跳过重型设计仪式、有限 observation 后的升级、`executionMode` 投影、fail-forward protocol 结果、active-goal continuation 文本，以及通过真实 Cordis Loader 组装的、无需密钥的 model-visible policy snapshot。
