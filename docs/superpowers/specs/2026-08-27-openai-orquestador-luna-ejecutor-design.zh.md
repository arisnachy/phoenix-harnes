# OpenAI 模型作为编排器、Luna 作为执行器的临时试验

[English](2026-08-27-openai-orquestador-luna-ejecutor-design.md) | 中文

## 目标

验证当用户选择的 OpenAI 模型保留编排职责，而委派任务由 `openai-codex/gpt-5.6-luna` 使用 `reasoningEffort: high` 执行时，PHOENIX 的质量和执行时间是否会改善。

该试验不隐藏供应商，不改变选择器中选择的模型，也不改变非 OpenAI 供应商的行为。

## 范围

当根模型使用 `openai-codex` 供应商时，实验规则生效：

- 用户选择的根模型（`gpt-5.6-sol`、`gpt-5.6-luna`、`gpt-5.6-terra` 或该供应商公布的其他模型）继续接收请求并决定是否委派。
- 每个 `subagent` 和 `subagent_fork` 子任务都使用 `provider: openai-codex`、`model: gpt-5.6-luna` 和 `reasoningEffort: high` 创建。
- 每个 `workflow` worker 都接收相同的执行路径。
- 最大深度继续为 `1`，以阻止递归链。
- `subagent` 和 `subagent_fork` 的委派仍保持串行。
- `workflow` 继续保持两个并发 agent 和两个总 agent 的限制。

根模型保留自己的选择和事件。执行路径只影响子任务。

## 不在范围内

- 更改、过滤或隐藏选择器选项。
- 用户选择模型后更改根模型。
- 将 Luna 应用于根供应商不是 `openai-codex` 的会话。
- 添加新的指标页面。
- 更改根模型决定委派数量的策略。
- 引入静默 fallback 的替代供应商。
- 更改 Ralph 的固定行为，除非其当前合约证明它属于本试验覆盖的委派路径。

## 技术设计

标准 preset 保留基于 `whenProvider: openai-codex` 的条件子任务路径。该路径必须存在于以下位置且保持一致：

1. `@phoenix-ai/dsh-tool-subagent` 的 `spawn` 供应商。
2. `@phoenix-ai/dsh-tool-subagent` 的 `fork` 供应商。
3. `@phoenix-ai/dsh-workflow-worker-thread`。

通用配置为：

```yaml
childRoute:
  whenProvider: openai-codex
  provider: openai-codex
  model: gpt-5.6-luna
  reasoningEffort: high
```

不会添加 `whenModel` 条件：当前合约只支持按供应商判断；对于本试验，这让 Sol、Luna 和 Terra 保持根模型角色，同时共享 Luna 执行器。

## 测量

将复用现有会话事件，这些事件已经保留每个响应的真实来源和每一步的使用情况。每次执行收集：

- 选择的根模型/供应商；
- 子任务的实际模型/供应商；
- 生效的 `reasoningEffort`；
- `inputTokens` 和 `outputTokens`；
- 适配器报告时的缓存 token；
- 已启动和已完成的委派数量；
- 每次委派和整体委派的持续时间；
- 完成原因和错误。

比较将使用等价任务，并分别记录：

- 根响应成本；
- 子任务总成本；
- 总执行成本；
- 最终响应前的时间；
- 观察到的质量和重试次数。

假设不预先认定节省成本：`high` 可能增加每项任务的 token。评判标准是每个 token 和每单位时间的质量，同时计入可能避免的重试。

## 可逆性

试验必须隔离在实验 preset 的配置中，或置于显式配置标志之后。停用它应恢复普通路径，不需要迁移会话或更改持久化数据。不更改凭据，也不写入秘密。

## 测试

将新增或调整聚焦测试以证明：

1. `openai-codex` 父任务使用 `high` 创建 `openai-codex/gpt-5.6-luna` 子任务。
2. `subagent_fork` 也遵循相同的行为。
3. workflow worker 应用相同的路径。
4. 其他供应商的父任务不会被重定向到 Luna。
5. 根模型的选择保持不变。
6. `maxDepth: 1` 以及当前并发限制不会放宽。
7. 使用事件仍然暴露 token 和模型来源，以便比较结果。

最终验证包括聚焦单元测试、preset 验证，以及在重建受影响 artifact 并刷新现有 URL 后对现有 GUI 进行 smoke test。

## 验收标准

试验完成的条件是：

- Sol、Luna 和 Terra 仍可正常在选择器中选择。
- 选择的模型负责编排根请求。
- 当根任务为 OpenAI 时，所有覆盖的委派都使用 `gpt-5.6-luna` 和 `high` 执行。
- 非 OpenAI 供应商仍不发生重定向。
- 可以从执行证据中提取 token、延迟、委派数量和错误。
- 配置可以通过一个变更恢复。
- 聚焦测试和 GUI 验证通过，且不改变已有的本地变更。
