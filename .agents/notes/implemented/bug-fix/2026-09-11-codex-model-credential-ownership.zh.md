# Agent Note：让 Codex 模型 OAuth 归模型提供商所有

状态：已实现

[English](2026-09-11-codex-model-credential-ownership.md) | 中文

## 问题

原生 Codex 登录与 Codex 模型请求使用不同的凭据存储。原生网桥只写入不含令牌的 `subagent-codex/account` 标记，而模型请求读取并刷新 `llm-pi-ai/openai-codex`。禁用后一个记录的授权流程后，即使原生 Codex 账户已连接，过期的模型授权也没有受支持的替换方式。

## 决策

`OpenAI Codex` 授权条目运行 pi-ai 的 ChatGPT OAuth 流程，并写入 Codex 模型请求使用的授权。独立的 `ChatGPT / Codex` 条目继续表示子代理和遥测使用的原生 Codex 账户，不暴露或复制其令牌。

## 考虑过的替代方案

**把原生 Codex 令牌复制到模型凭据记录。** 这会耦合两个独立的刷新所有者，并让 PHOENIX 解析和持久化原生网桥刻意留给 Codex 控制的机密。

**把原生账户标记视为模型授权。** 该标记不含凭据，pi-ai 请求路径无法使用它进行认证，因此把它显示为足够会保留原有故障。

**通过 Codex app-server 运行主要模型请求。** App-server 拥有完整的代理运行时，而不是 harness LLM 流式 API；把它当作令牌代理会混合两个工具循环并改变会话语义。

## 结果

Codex 模型用户会授权模型请求实际使用的凭据，过期授权可以在不复制原生 Codex 机密的情况下替换。这两个账户条目有意保持独立，因此登录原生 Codex 不会授权模型路由。聚焦登录测试固定了 `llm-pi-ai/openai-codex` 会通过组装后的授权服务提供 OAuth。
