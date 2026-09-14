# `@phoenix-ai/dsh-hardness`

[English](README.md) | 中文

PHOENIX HARDNESS 的 provider-neutral 能力 registry、Tool Atlas 与认知工作流规划服务。

它记录声明的 capability descriptor、所需权限、生命周期状态、验证证据和声明式 modality route；不会授予权限、保存凭据、执行 tools，也不会替换 tool、skill、workflow、subagent、goal 或 plan registry。

只有 resolver 返回当前可用的 capability，且其声明的 modality 与请求偏好相交时，才会选择 route。`unknown` 表示无法对 need 分类；`missing` 表示 need 已知但没有经过验证的 capability 与 modality 可以满足它。所需权限只会作为声明传给后续 broker，不会在此处授予。

`CapabilitySurface` 会把 route 投影为稳定的预览数据（`id`、输入、输出、modality、验证状态和声明权限）。它可序列化为 JSON，不包含 callback、凭据、sandbox handle 或 workspace mutation；missing 与 unknown 不会生成 surface。

## 认知工作流引擎

HARDNESS 还提供确定性的第一方认知工作流目录。`CognitiveMissionProfile` 描述 mission 的类型、复杂度、风险、新颖性、持久性、代码/外部证据需求、独立子任务、重复模式、既往失败、是否产生用户可见成果，以及是否存在明确未来义务。`selectCognitiveWorkflow()` 会把该 profile 映射为保持质量所需的最轻量有序 `CognitiveWorkflowPlan`；`adaptCognitiveWorkflow()` 会在执行失败、验证失败、出现新风险、范围扩大、发现独立子任务、失败重复或发现未来义务时，单调增强已有计划。

目录包含：意图锁定、上下文恢复、经验召回、brainstorming、研究与证据、因果推理、系统化调试、反事实模拟、架构设计、实现规划、证据驱动开发、并行分解、fresh-agent 执行、对抗式审查、独立 judge、验证 gate、恢复 checkpoint、安全变更、安全/风险审查、质量升级、结果评估、程序化学习、经验固化、失败免疫、元认知审查与自主 follow-up。

认知选择只是程序化指导，不是执行权限。它不会执行 capability、授予权限、安排任务或保存私有推理。现有 `ctx.workflowEngine`、`ctx.subagents`、`ctx.skills`、goals、sessions、approval broker 与 HARDNESS execution gates 仍然拥有最终权限。面向模型的 guide 明确禁止暴露 private chain-of-thought，只允许记录决策、证据、产物和审计所需的有用理由。

计划附带的 quality gate 是可观察标签，例如 `objective-locked`、`root-cause-evidence`、`design-approved`、`failing-proof-observed`、`independent-review`、`risk-reviewed`、`rollback-ready`、`fresh-verification` 和 `outcome-compared`。现有 HARDNESS approval、verification、presentation、judge 与 audit 规则保持不变，并且比这些规划标签拥有更强约束力。

### 面向模型的结构化 router

Model preset 会在 `hardness_run` 旁挂载一个纯 read-only 的 `hardness_workflow` tool。模型提供经过验证的 `CognitiveMissionProfile`；该 tool 返回有序 selected flows、activation reasons、skipped flows 与 quality gates。可选的有限 observation 会增强 profile 并重新计算 workflow。这个 tool 不会调用其他 tool、不会授予权限，并且从 host Tool Atlas 中排除，因此 HARDNESS 不会把自己的 router 递归宣传为可执行 capability。

对于非 trivial mission，operating protocol 要求模型在制定 execution plan 前调用 `hardness_workflow`；当风险、范围、任务独立性、failure evidence 或明确未来义务发生变化时再次调用。`future-obligation-discovered` 会把 mission 转成 persistent 并激活 `autonomous-follow-up`；真正创建或执行未来工作仍只属于已授权的 scheduler/proactivity runtime。

## Model Experience

### Capability Atlas 元数据

#### What the model sees

消费者可以向模型暴露声明式 HARDNESS 字段，例如 `capabilityId`、modality、验证状态、输入、输出和声明权限；registry 本身不会暴露凭据或可执行 handle。HARDNESS adapter 会注入认知工作流目录并挂载 `hardness_workflow`，因此每个挂载模型都知道有哪些 procedural flows，并拥有由 harness 确定性选择、组合与增强它们的结构化方式。

##### Cognitive routing 与 operating protocol

```markdown
Classify the mission, call hardness_workflow for non-trivial work, and use the returned ordered pipeline and quality gates before execution planning. Debugging is root-cause-first; only independent work may be parallelized; high-complexity/high-risk work separates implementation, adversarial critique, and independent judgment. New evidence may strengthen the workflow. The shared execution lifecycle remains inspect → resolve → plan → approve → execute → verify → present → audit, and no flow selection grants execution authority.
```

#### Token effect

安装 HARDNESS protocol 的消费者会向 system prompt 添加一个稳定的认知目录与 lifecycle guide。目录是确定性的，便于缓存；mission plan 由 `hardness_workflow` 结构化计算，而不是保存或嵌入私有推理轨迹。

#### KV Cache effect

只要 capability metadata、routing、验证状态或内置认知流目录不变，稳定 descriptor 与认知 guide 都保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- 认知选择由调用方提供的 mission profile 确定；第一版不会从隐藏的模型推理中推断 profile。
- 学习类 flow 只规定何时应提取或固化经过验证的经验；存储仍由现有 mission/session/skill 系统负责，不创建第二套 HARDNESS memory database。
- `autonomous-follow-up` 现在可以通过结构化方式被选择，但本身仍不会安排任务；实际执行继续由现有 scheduler/proactivity capability 授权。
- capability resolver 与内存 provider 仍是基础层；持久化、source adapter、外部获取、视觉渲染和生成式 UI 属于其上的独立消费者与 provider。
