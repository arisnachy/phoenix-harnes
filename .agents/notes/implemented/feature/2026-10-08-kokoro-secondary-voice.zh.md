# Agent Note: Kokoro 次级语音和语言一致性

Status: implemented

[English](2026-10-08-kokoro-secondary-voice.md) | 中文

## Problem

原生实时语音并非始终可用。此前 Kokoro 回退请求未传递会话语言，使西班牙语文本落入英语默认设置，可能造成错误发音、重复或意外词汇。Windows 平台回退也未按请求语言选择声音。

## Decision

PHOENIX 保留 Codex Realtime 为首选，其次使用已配置的 PHOENIX Natural 神经语音引擎，再使用常驻 Kokoro ONNX；对话最后回退到浏览器的匹配语音。由于 Windows SAPI 默认声音机械感较重，对话不再使用它；Windows 的后台提醒也只有明确设置 `systemTts: true` 时才启用传统系统语音。客户端结合实际回复和界面文档语言生成 BCP 47 标签并传递至 Host。旧客户端的默认语言为 `es-DO`。助手的性别呈现方式逐次发送；西班牙语使用 `ef_dora` 或 `em_alex`，英语使用 `af_heart` 或 `am_michael`。

文本清理适配器和 Kokoro 守护进程在音素转换前删除商标、注册、版权以及不可见 Unicode 控制符号，以免将标记读成额外的词汇（例如西班牙语“marca registrada”）。但神经模型自身产生的额外发音仍属于独立风险。

Windows supervisor 将模型安装在 `%LOCALAPPDATA%/Phoenix/voice/kokoro`，不随运行时重复下载。不支持的 Kokoro v1.0 语言会拒绝执行，而不是按英语朗读。异常过长的模型音频被拒绝，防止重复循环。Windows 系统语音只使用与请求语言匹配的已安装声音。

## Alternatives considered

**始终使用英语：** 错误的音素转换会破坏西班牙语。

**验证语言前改用其他声音：** 会导致回退语音与原始语言不一致。

**为每种语言自动下载额外模型：** Kokoro v1.0 模型没有覆盖所有语言，而且会浪费储存空间。

## Consequences

西班牙语使用正确的音素转换和符合助手资料的声音；未支持的语言切换到平台或浏览器。当所有 Host 神经引擎都不可用时，浏览器尝试匹配语言的语音，而不再默认使用 Windows SAPI。如果没有高质量语音引擎或浏览器语音，合成结果仍可能不够自然甚至无法播放；不能保证接近真人。Kokoro 声音的自然程度仍取决于模型，需要在目标 Windows 设备上实际试听才能验证。

## Testing

TypeScript 测试还覆盖注册商标符号移除、对话排除 Windows 机械语音，以及优先选用已配置的自然神经语音。其他测试覆盖语言判断、客户端到 Host 的语言传递、西班牙语默认值与助手性别。守护进程的 `--self-test` 验证语音标识符和不支持语言的拒绝逻辑；Windows 安装的 `--check` 执行西班牙语模型合成。
