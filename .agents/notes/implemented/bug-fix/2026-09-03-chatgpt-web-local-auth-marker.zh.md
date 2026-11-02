# Agent Note: ChatGPT Web 为 pi-ai 提供本地认证元数据

Status: implemented

[English](2026-09-03-chatgpt-web-local-auth-marker.md) | 中文

## Problem

本地 `chatgpt-web` 路由在回环桥接中使用浏览器会话认证，因此有意不配置模型 API 密钥。但 pi-ai 的 OpenAI Responses 实现仍要求请求带有 API 密钥或认证标头，否则会在网络请求前拒绝请求，适配器于是把 `No API key for provider: chatgpt-web` 包装为 `PI_AI_ERROR`。

## Decision

当 `chatgpt-web` 路由没有非空的 `Authorization` 或 `cf-aig-authorization` 标头时，适配器添加 `Bearer phoenix-chatgpt-web`。该值只是 pi-ai 预检所需的非秘密回环标记；桥接仍使用浏览器会话认证，已配置的标头保持优先。

## Alternatives considered

**要求在设置中填写虚拟 API 密钥。** 否决，因为这会错误表示浏览器会话认证，增加不必要的凭据存储，并且值缺失时仍可能触发相同的预检错误。

**全局放宽 pi-ai 的验证。** 否决，因为其他 OpenAI 兼容路由可能确实需要凭据；全局修改会隐藏配置错误并削弱明确失败行为。

## Consequences

ChatGPT Web 请求无需 API 密钥即可通过 pi-ai 的本地验证，并继续限制在回环桥接中。聚焦适配器回归测试覆盖无密钥路由，包 README 记录了这一例外；桥接可用性和浏览器登录仍是独立的运行时要求。
