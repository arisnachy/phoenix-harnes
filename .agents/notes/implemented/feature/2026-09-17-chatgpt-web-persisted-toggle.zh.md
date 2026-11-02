# Agent Note: ChatGPT Web 持久化开关

Status: implemented

[English](2026-09-17-chatgpt-web-persisted-toggle.md) | 中文

## Problem

Phoenix 已经拥有 `chatgpt-web` 模型配置和用于本地回环 `codex-chatgpt-web` 桥接器的 CLI 控制器，但 Settings 无法控制该桥接器。因此，已配置的模型路由可能在桥接器停止后继续存在，而手动启动的桥接器也可能在产品界面中没有任何可见状态。重启时同样缺少一个持久化的用户选择来告诉 Host 此桥接器应保持开启还是关闭。

## Decision

Host 的 plugin inventory 拥有唯一的 ChatGPT Web 生命周期实现，CLI 门面和 Settings 都使用这份实现。该生命周期把浏览器认证保留在 Phoenix 之外，只接受回环端点，把进程所有权记录与一个很小的 enabled 偏好分别持久化，并且只在该偏好为 ON 时于 Host 启动阶段恢复桥接器。

Settings → Connectors 通过类型化 Host Remote 暴露 ChatGPT Web 开关。启用时先启动桥接器，并要求 `/v1/models` 返回健康结果，之后才写入 `llm-pi-ai.providers.chatgpt-web`。如果 settings 写入失败，桥接器会再次关闭。禁用时先移除 provider 路由，再停止 Phoenix 拥有的桥接器进程，因此模型选择器不会继续展示一个被 Phoenix 明确关闭的路由。

现有的 `llm-pi-ai` ChatGPT Web 默认值继续作为路由权威：provider 配置保留本地回环 Responses 端点以及非秘密的本地授权标记，而桥接器继续负责浏览器会话资格与实时模型可用性。

## Alternatives considered

**让浏览器 UI 直接启动桥接器。** 拒绝，因为子进程所有权属于 Host，浏览器界面无法安全地负责重启、清理和机器路径。

**让 CLI 与 Settings 分别维护生命周期实现。** 拒绝，因为两个进程控制器可能对所有权状态、健康状态和停止行为产生分歧。

**先暴露模型路由，再在后台启动桥接器。** 拒绝，因为一个由不可达回环端点支撑的可选 provider 会在用户已经选择它之后才失败。

## Consequences

ChatGPT Web 成为明确的可选集成，并具有持久化的 ON/OFF 状态。ON 会跨 Phoenix 重启保留，OFF 不会在后台启动桥接器；缺少 Browser-only 设置时会给出提示而不会暴露 provider 路由；健康检查失败也不会留下 enabled 持久状态。CLI 仍可用于诊断和手动生命周期命令，但它与 Settings 使用同一个控制器。
