# Agent Note: Kira 使用独立的 Code Mode 加快多工具任务

Status: implemented

[English](2026-10-16-kira-universal-code-mode-fast-execution.md) | 中文

## Problem

Kira 原本直接调用工具，每个有依赖关系的步骤都可能需要新的模型往返。已有的 `code` 代理预设采用经过测试的独立 TypeScript `run_code` 展示方式，但 `kira-max` 未使用。一次十二字段网页表单测试中，浏览器工具本身耗时远低于模型的重复决策与播报。

## Decision

Kira Max 预设现在配置独立的 `@phoenix-ai/dsh-agent-tool-presentation`，使用 `mode: code`。现有 Web 主机提供 `@phoenix-ai/dsh-code-runtime-worker-thread`；无需在代理配置内重复创建运行时或工具注册表。Kira 的指令要求通过类型化 SDK，在一次 `run_code` 内完成已确定的顺序步骤；结构化表单优先使用 `complete_form`，桌面截图之前先尝试 DOM，仅并行处理独立且并发安全的读取，并在足够的验证后结束任务。

每个内部工具仍通过现有 Phoenix 注册表执行，保留原本的人工授权、策略检查、持久化操作日志、并发规则与取消机制。其他代理预设保持现状。已有 Code Mode 预设与隔离集成测试；新增 Kira CLI 配置测试确保生产预设以及 Web 运行时依赖正确。

## Alternatives considered

**启用 `both`**：同时向模型发送原生工具 schema 与生成的 SDK，增加上下文大小，也无法阻止模型继续逐次直接调用工具。

**全局设置 `DSH_TOOLS_MODE=code`**：影响所有代理，可能破坏专用预设。

**重新开发浏览器或桌面引擎**：重复已有的受权限管理的执行桥接，且无法解决其他领域的任务。

## Consequences

Kira 可以在浏览器、文件、研究和桌面任务中减少不必要的模型往返。`run_code` 并不提升权限；原有需要人工批准的操作仍需批准。脚本不能猜测选择器或悄悄重复外部操作。生成的 SDK 说明可能增大提示长度，需要实测总 token、耗时与正确率，才能证明效率提升。如果某个预设宿主未提供 `codeRuntime`，Kira 的 Code Mode 行会按设计报告不可用。

## Testing

CLI 预设测试验证唯一独立 Code Mode 配置、Web TypeScript 运行时依赖与执行指导。现有 Code Mode 及各代理工具展示测试覆盖隔离和执行。真实 Chrome/Windows 性能仍需验收。
