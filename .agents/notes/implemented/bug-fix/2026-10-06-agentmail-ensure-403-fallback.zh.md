# Agent Note：AgentMail ensure 403 回退

Status: implemented

[English](2026-10-06-agentmail-ensure-403-fallback.md) | 中文

## 问题

当 AgentMail 在带所有者邮箱的 `POST /v0/agent/sign-up` 首次注册中返回 HTTP 403 时，Kira 的邮箱创建仍可能在第一个 `phoenix_mail_identity action=ensure` 调用就失败。Phoenix 会把这个拒绝当成终止错误，因此后续恢复逻辑根本没有机会运行，因为邮箱和凭据尚未持久化。

## 决策

继续把带所有者邮箱的注册作为首选且可恢复的路径。当这个未认证注册被明确以 HTTP 403 拒绝时（显式的服务商配额限制除外），Phoenix 自动切换到 AgentMail 已记录的两阶段注册：先仅用用户名调用 `POST /v0/agent/sign-up` 创建只接收邮件的 inbox，立即持久化一次性 API key 和 inbox 身份，然后使用该 key 调用 `POST /v0/agent/human` 绑定已保存的人类所有者，使 AgentMail 发送六位 OTP。

回退路径必须在绑定人类之前保存 key，因为没有 human_email 的 AgentMail 注册无法恢复丢失的 key。如果绑定步骤失败，Phoenix 会保留并返回刚创建的 receive-only inbox，而不是把已经成功的邮箱创建变成失败的 `ensure`；之后用户再次显式调用 `ensure` 时，会通过已有恢复路径继续绑定所有者。未认证注册的裸 403 也会和旧凭据被拒绝分开分类，避免诊断错误地声称不存在的 key 已失效。

## 考虑过的替代方案

拒绝把所有注册都改成无邮箱注册，因为如果在 key 持久化之前丢失响应，就会产生无法恢复 key 的组织。拒绝在明确 403 后盲目重复带所有者邮箱的注册，因为这只会重复同一个失败路径。也拒绝要求用户手工粘贴提供商 API key，因为 AgentMail 的 agent onboarding 本身支持无预置 key 的程序化注册。

## 影响

原有带所有者邮箱注册上的服务商 403 不再阻止 Kira 获得 inbox。普通路径仍保持幂等并可按所有者恢复，回退路径则使用 AgentMail 官方支持的 receive-only + attach-human 流程。明确的配额错误仍会停止，而不会额外创建邮箱。

## 测试

传输层测试区分未认证 signup 403 与旧凭据失效。onboarding 测试覆盖 receive-only 回退成功并绑定人类，以及绑定失败时仍保留新 inbox/key。
