# Agent Note：首次运行认证、语音执行与邮箱恢复

Status: implemented

[English](2026-10-04-first-run-auth-voice-mail-recovery.md) | 中文

## 问题

全新 Phoenix 组合暴露了 Codex 模型管线，却没有挂载原生 ChatGPT 账户所有者，因此 Settings 可能显示 OpenAI API 配置，而基于订阅的 Codex 路由没有首次运行授权入口。OAuth 流还把提供方正常关闭同意弹窗解释为取消，即使 Host 仍可能正在交换回调代码。原生实时语音把自己的转录直接写入 Session 事件，没有唤醒实时 Phoenix Agent，从而绕过正常 harness。AgentMail 会安全停放结果不确定的注册，但界面只允许恢复可能已经创建的邮箱，重新安装或提供方结果不明确后无法显式选择新邮箱。

## 决策

基础 bundle 挂载原生 Codex 账户提供方，并把 `openai-codex` 路由列在通用云路由之前；Settings 将 OpenAI Codex 标记为 OAuth/Auth，并与 OpenAI Platform 的 API key 配置分开。OAuth 浏览器只负责弹窗呈现：同意页关闭不会取消 Host 尝试，只有显式 Cancel 操作才调用取消，同时继续轮询直到后端给出终态。

Codex realtime 的最终用户转录解析精确的实时 Phoenix Agent，并进入其普通 follow-up inbox。该 Agent 仍是唯一的规划与执行来源，因此工具、hardness 策略、持久化、验证和聊天输出与键盘输入走同一路径。浏览器 realtime 通道关闭 VAD 自动创建的独立响应，并把 Phoenix 最终助手响应交给实时音频渲染；没有实时 Agent 的独立 voice 组合仍保留转录日志作为兼容降级。

AgentMail 的歧义注册仍不会自动重试，但所有者可以显式选择 **Crear otro buzón**。该操作在执行一次新的随机邮箱注册期间继续保持 enrollment 为歧义状态，从而避免首次运行的自动 pump 与所有者明确选择的第二次尝试发生竞争；如果要保留之前的邮箱，高级恢复路径仍然可用。

## 考虑过的替代方案

把 Codex 当成另一个 OpenAI API key 提供方被拒绝，因为原生 Codex 认证由 ChatGPT/Codex 会话拥有，不能回退到 `OPENAI_API_KEY`。根据弹窗关闭推断 OAuth 取消被拒绝，因为成功的提供方通常会在 Host 完成 token 交换之前关闭弹窗。把 realtime 保留为第二个会话 Agent 被拒绝，因为直接转录事件会绕过 Phoenix 工具，并可能与真实执行结果不一致。自动重复歧义邮箱注册被拒绝，因为未知的提供方结果可能已经创建了可用邮箱。

## 影响

全新安装无需手工组合插件即可显示原生 Codex 授权，同时 OpenRouter 仍作为独立路由存在。OAuth 连接器能够承受提供方正常关闭弹窗。语音请求通过常驻 harness 执行，完成后的 harness 答案通过原生 realtime 音频返回，而不是形成第二个事实来源。邮箱恢复继续保持禁止自动重复创建的安全规则，同时增加由所有者明确控制的新邮箱路径。回归测试固定弹窗生命周期、realtime Agent 调度与音频回传，以及歧义后显式替换 AgentMail 邮箱的行为。
