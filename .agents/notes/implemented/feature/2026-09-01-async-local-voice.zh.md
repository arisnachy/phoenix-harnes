# Agent Note: Asynchronous local voice side channel

Status: implemented

[English](2026-09-01-async-local-voice.md) | 中文

## Problem

连续叙述会把音频延迟和 provider 失败耦合到 PHOENIX 执行中，而格式化的显示内容不适合自然语音。

## Decision

PHOENIX 通过 `@phoenix-ai/dsh-voice` 提供 `ctx.voice`。它只接受明确的重要事件，将显示输出规范化为有界的口语文本，并异步排空可取消队列，执行路径不会等待它。持久会话事件会映射授权请求、已验证的目标完成和真实目标阻塞；其他执行事件保持静默。`@phoenix-ai/dsh-voice-local` 提供可选的命令驱动 Kokoro、STT provider 和平台语音 fallback。命令不经过 shell，并通过 stdin 接收文本或字节。

Kokoro 是配置的 provider，而不是必需依赖。host 不会在启动时下载模型权重或启动进程，因此缺少本地安装不会阻止 Phoenix 加载。

## Alternatives considered

**仅使用浏览器语音：** 不作为唯一实现，因为 host 端的重要事件播报和本地 STT 需要与特定浏览器无关的 provider-neutral 服务。

**在执行循环中进行语音：** 不采用，因为 provider 延迟、音频取消或设备不可用会造成错误的执行失败。

**强制捆绑模型：** 不采用，因为模型下载会增加启动时间和资源消耗；部署在本地性能合适时可以选择 Kokoro。

## Consequences

执行路径与语音保持独立，界面可以继续显示 Markdown、代码和 emoji，而语音接收纯文本。需要这些 provider 时，部署必须配置本地 Kokoro 或 STT 命令。启用音频的产品界面需要披露语音由 AI 生成。
