# Agent Note: Adaptive approvals, artifact execution, and persistent specialist labs

Status: implemented

[English](2026-08-29-adaptive-harness-control-plane.md) | 中文

## Problem

Phoenix 的长任务可能会因为重复确认而停止，产物也没有统一的执行界面；此外，专家模式的描述没有可重放的研究和评估记录。因此，界面、审批通道、沙箱运行时和会话日志需要一个明确的控制平面。

## Decision

审批请求携带有限期限、风险等级、可逆性和策略版本。客户端每秒渲染倒计时，过期时应用服务器建议；只有策略版本仍然有效时才会自动决定，高风险或不可逆请求默认拒绝。工具的 ask 决策会把风险元数据传入审批 seam。

HARDNESS 产物统一为一个自适应界面。HTML 仍然在带限制 CSP 的唯一来源 iframe 中运行。代码执行使用 loopback `artifact/run` 端点和已挂载的隔离 `CodeRuntime`；运行时缺失或不兼容时明确失败。停止操作会中止传给运行时的同一个信号。可用 `ResizeObserver` 时测量高度，并把结果限制在有界的响应式范围内。

专家实验室使用持久会话事件。`SpecialistLedger` 记录主题、目标、标准、来源、假设、实验、迭代上限和 judge 结果。通过评估进入 `ready`；失败进入 `improving`，直到达到上限后进入 `blocked`。`specialist_lab` 工具向模型公开整个生命周期。

目标续行提示在第一轮要求一个完整主计划，之后复用该计划；续行协议不要求逐步确认。现有目标 supervisor checkpoint 和 judge 反馈仍然是恢复依据。

## Alternatives considered

**仅在客户端运行审批计时器** — 拒绝：浏览器时钟不能安全决定由服务器拥有的操作，尤其是在重连或策略变更之后。期限和策略版本由主机持久化并作为权威。

**直接在浏览器执行代码** — 拒绝：浏览器求值不能提供 harness 沙箱、工作区身份和运行时取消保证。HTML 用于隔离展示；代码执行属于已挂载的主机运行时。

**把专家状态保存在 React 或外部缓存中** — 拒绝：重启后状态会消失，也无法从会话记录重建。`specialist/change` 使用现有事件溯源 goal 模式保存完整快照。

## Consequences

界面不再要求每个目标续行步骤都确认，后续审批决定有时间上限并可审计。只有生产者明确标记低风险且可逆时才会自动允许；未标记的请求仍然失败关闭。统一界面可以立即展示代码和 HTML，但 Python 执行只有在挂载兼容 Python runtime provider 时可用；本实现不会把只有协议的 Python 包假装成执行器。专家学习是持久且受 judge 门控的，但数据获取和领域实验仍由 web、MCP、沙箱和工具 provider 负责。
