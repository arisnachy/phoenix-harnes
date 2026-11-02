# Agent Note：Telegram 等待 Kira 的第一条回复

Status: implemented

[English](2026-10-10-telegram-kira-first-reply.md) | 中文

## 问题

Telegram 对每个提示词都先发送固定的“Recibido”确认消息。即使在普通聊天中，这条自动消息也会出现在 Kira 的回复之前，使用户误以为机器人脱离了已配置的 Phoenix Agent 独立应答。

## 决策

Telegram Host 接收器在授权提示词进入及执行期间，使用 Bot API 的临时 `sendChatAction(typing)` 状态，并持续刷新直到任务结束。首条正式聊天回复来自已配置 Agent 的可见文本，或者明确且经过安全处理的执行失败信息。输入状态采用尽力发送的方式，不得阻碍 Agent 执行或回复。

## 考虑过的替代方案

拒绝根据用户输入拼装个性化模板回复，因为它不是模型生成的 Kira 回复。长任务中完全不显示状态也不合适，因为 Telegram 提供临时输入状态。暂不传送未完成的 Agent 内部消息：当前 Host 接口仅在整个 Agent 空闲后选取结果，安全归属中间输出需要单独的逐轮传输设计。

## 影响

普通对话不会收到重复的自动确认。长任务显示 Telegram 临时输入状态，而不是伪造的 Kira 消息。Agent 生成的进度消息不保证在最终回复前送达；真正的流式进度和跨渠道共享会话仍需单独设计。配对令牌和授权聊天机制不变。

## 测试

Telegram 收件箱测试确认：Agent 空闲前没有自动确认消息、执行完成后停止输入状态、模型回复是第一条聊天消息，以及 Telegram 输入状态发送失败不会阻止真实回复。仍需在 Windows Host 与 Telegram 实际网络上进行冒烟测试。
