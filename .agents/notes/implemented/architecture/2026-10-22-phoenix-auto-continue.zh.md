# Agent Note：短输出模型路由的 Phoenix 自动继续

Status: implemented

[English](2026-10-22-phoenix-auto-continue.md) | 中文

## Problem

模型以 `length` 结束时虽然已留下持久化的助手文本前缀，但代理循环以前会直接用 `max-tokens` 结束回合，迫使用户在生成长代码、报告或研究内容时自己输入“continue”。常规最大步骤检查点与此不同，不能修复输出截断。

## Decision

在模型步骤边界对真正的输出长度限制进行继续操作，保留部分助手消息并注入正常且被记录的插件消息。默认每条真人请求最多继续三次，该限制跨内部回合检查点和恢复后的会话生效。若输出重复，则提前停止，以免在同一段文字上浪费更多 token。后续继续成功时可清除此前的 `max-tokens` 终止原因；无关的用户指示不会清除。取消和用户干预仍优先。

只有 `autoContinueProviders` 配置中的路由有资格使用此功能（默认 `openrouter`、`deepseek`、`qwen`）。在提供商和模型 ID 两级都始终排除 Codex；除非模型确实因输出长度上限终止，否则不会再调用模型。设置 `autoContinueMaxSegments: 0` 可禁用自动继续。

不能仅因网关的单模型输出上限低于目录中公布的 `maxTokens`，就把 OpenRouter 的输出 `length` 误判为上下文溢出。真正的上下文窗口溢出仍然优先处理。

## Verification

专门的模型循环测试覆盖部分文本前缀完整重放、Codex 排除、重复内容抑制和有界重复截断。真实 Phoenix 环境还必须使用有提供商密钥的 OpenRouter 响应，以及部署的常规类型检查和快照测试。不应仅因为模型继续运行就声称工具调用或任务成功。

## Consequences

只有配置中的非 Codex 路由在确实遇到输出长度上限时才会继续；继续本身不代表任务完成。

## Alternatives considered

拒绝要求用户在每次真正的输出长度限制后都自行键入 continue，因为符合条件的路由可以依照有界策略安全继续。
