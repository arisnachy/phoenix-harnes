# Agent Note：通过显式认知工作流路由 mission

Status: implemented

[English](2026-09-14-hardness-cognitive-workflows.md) | 中文

## 问题

PHOENIX 已经拥有强大的执行原语：HARDNESS capability routing 与 evidence、持久 mission state、独立 mission judge、workflow execution、subagents、skills、planning、goals、guards 和 durable sessions。缺失的是程序化选择层。一个模型可能知道如何 brainstorming、系统化调试、测试驱动、研究证据、委派、审查或恢复，但 harness 之前没有一份规范清单明确说明这些过程有哪些、何时适用、如何组合，以及新证据何时应该增强当前过程。把这些完全交给单一模型会让质量依赖模型是否记得某种流程，并使不同 provider 的行为不一致。

目标不是创建第二个 agent loop 或第二个 workflow runtime。Harness 应利用持久的过程知识与现有执行 authority 的组合，让整个系统比任何单一模型更强，同时保留 approval、verification、judge、audit 与 recovery gate。

## 决策

`@phoenix-ai/dsh-hardness` 持有一个确定性的第一方认知工作流目录和纯 router。`CognitiveMissionProfile` 只包含有限的 mission 事实：类型、复杂度、风险、新颖性、代码/证据要求、独立子任务、持久性、既往失败、重复模式以及结果是否面向用户。`selectCognitiveWorkflow()` 将该 profile 映射为不可变、有序的 `CognitiveWorkflowPlan`；`adaptCognitiveWorkflow()` 在出现执行失败、验证失败、新风险、范围扩大、新发现独立子任务或重复失败等有限 observation 时增强 profile 并重新选择。

目录包含 26 个 flow：intent framing、context recovery、experience recall、recovery checkpointing、brainstorming、research/evidence、causal reasoning、systematic debugging、counterfactual simulation、architecture/design、implementation planning、parallel decomposition、fresh-agent execution、safe change、security/risk review、proof-driven development、metacognitive review、quality escalation、adversarial critique、independent judge、verification gate、outcome evaluation、failure immunization、procedural learning、experience consolidation 与 autonomous follow-up。

选择使用统一 canonical order 与 prerequisite closure，因此依赖 flow 不会出现在 prerequisite 之前。每个 mission 都包含 intent framing、fresh verification 与 outcome evaluation。调试必须先定位 root cause；代码修改要求 proof-driven development；高风险和高复杂度工作增加 adversarial 与 independent review；只有显式独立的工作才启用 parallel decomposition 与 fresh-agent execution；持久和重复工作启用 recovery 与 learning 类流程。Quality-gate 标签描述下游 orchestration 应获得的可观察证据，但不授予任何权限。

`renderCognitiveWorkflowGuide()` 向模型公开目录与组合规则。现有 HARDNESS prompt adapter 会把该 guide 与 `renderHardnessProtocol()` 一起安装，因此通过正常 HARDNESS composition 挂载的每个模型都会知道这些流程，无需依赖模型记得加载某个 skill。Guide 明确禁止暴露 private chain-of-thought，只允许记录决策、证据、产物和审计所需的有用理由。

## Authority 边界

认知 routing 只负责程序化 planning。它不会执行 tools、批准权限、创建 tasks、选择 credentials，也不会替代 `ctx.workflowEngine`、`ctx.subagents`、`ctx.skills`、goals、plan state、session persistence 或 HARDNESS mission kernel。现有 HARDNESS lifecycle 仍然拥有最终 authority：`inspect → resolve → plan → approve → execute → verify → present → audit`。任何选中的 flow 都不能绕过 approval、independent judge、quality gate、capability evidence、quarantine 或 WALL_PROTOCOL recovery。

学习类 flow 也不会声称模型悄悄修改了自身权重，或把未经验证的文本当作 memory。它们只表示经过验证的 outcome 何时有资格被提取为可复用 procedure 或固化为经验；现有 mission/session/skill 系统仍是 persistence authority。`autonomous-follow-up` 同样只识别未来义务，实际创建或执行仍需要现有 scheduler/proactivity authority。

## 考虑过的替代方案

**仅使用 skills** —— 不作为主要机制。Skills 仍适合承载 procedure 内容，但如果依赖模型自己记得发现和加载 skill，就会重新产生原来的不一致。

**固定的用户可见 mode** —— 拒绝。真实 mission 往往混合 design、research、debugging、execution、review 与 recovery；单一 mode 会增加不必要分支，并且在证据变化时适应性差。

**第二套 workflow 或 agent runtime** —— 拒绝。PHOENIX 已有 provider-neutral workflow 与 subagent seam。重复建设会产生相互竞争的执行 authority，并使 recovery 更困难。

**修改 agent loop** —— 拒绝。目录属于纯 planning data 与 model guidance，适合现有 extension point；agent loop 应继续保持可替换。

## 后果

模型得到稳定的高质量工作词汇，可以根据 mission facts 组合轻量或更强的 procedure，而不是每个 turn 都临时决定过程。Provider 可以更换而无需改变目录。失败可以增强 workflow，而不是过早结束 mission。由于 selection surface 是确定性且 JSON 可序列化的，因此无需模型调用即可测试，也无需保存 private reasoning 即可审计。

第一版有意不从隐藏推理中推断 `CognitiveMissionProfile`，也不会自行执行返回的 plan。更高层 mission orchestration 可以提供 profile、读取 selected flows，并使用已有 workflow/subagent/skill service 去实现它们。

## 验证

Unit coverage 检查目录唯一性与 prerequisites、轻量 trivial selection、build/design/TDD selection、root-cause-first debugging、高风险 research、parallelization 约束、持久/重复工作的 recovery 与 learning、失败或风险变化后的 monotonic adaptation、quality-gate 标签、英中模型 guide，以及 cognitive guide 注入 HARDNESS system-prompt section。现有 HARDNESS operating、mission、approval、judge 与 evidence 测试继续作为执行安全的 regression authority。
