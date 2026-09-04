# Agent Note: ChatGPT Web 设置卡片使用本地网桥

Status: implemented

[English](2026-09-03-chatgpt-web-tunnel-settings-card.md) | 中文

## Problem

Models 卡片把使用浏览器会话的 `chatgpt-web` 路由当成 API 密钥提供方，因此显示了本地网桥不应要求的凭据输入。

## Decision

`chatgpt-web` 编辑器会标明本地网桥、显示实际端点、跳过凭据查询和 API 密钥输入，同时保留模型列表可选。浏览器认证和生命周期仍由网桥负责；设置页不会声称网桥当前可达。

## Alternatives considered

**保留通用 API 密钥字段。** 否决，因为它与路由的浏览器会话认证相矛盾，还会诱导用户保存无意义的付费凭据。

**增加第二种通用提供方类型。** 否决，因为路由 id 已经标识适配器专属行为，现有 profile／编辑路径足够使用。

## Consequences

选择 `chatgpt-web` 时不再显示付费 API 密钥步骤。成功请求仍需要运行 `codex-chatgpt-web` 网桥并完成浏览器登录；可使用 `dsh chatgpt-web status` 检查可用性。
