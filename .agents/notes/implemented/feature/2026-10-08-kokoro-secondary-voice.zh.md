# Agent Note: Kokoro 次级语音和语言一致性

Status: implemented

[English](2026-10-08-kokoro-secondary-voice.md) | 中文

## Problem

原生实时语音并非始终可用。此前 Kokoro 回退请求未传递会话语言，使西班牙语文本落入英语默认设置，可能造成错误发音、重复或意外词汇。Windows 平台回退也未按请求语言选择声音。

## Decision

PHOENIX 保留 Codex Realtime 为首选、常驻 Kokoro ONNX 为第二选择，平台或浏览器语音为回退。客户端结合实际回复和界面文档语言生成 BCP 47 标签并传递至 Host。旧客户端的默认语言为 `es-DO`。助手的性别呈现方式逐次发送；西班牙语使用 `ef_dora` 或 `em_alex`，英语使用 `af_heart` 或 `am_michael`。

Windows supervisor 将模型安装在 `%LOCALAPPDATA%/Phoenix/voice/kokoro`，不随运行时重复下载。不支持的 Kokoro v1.0 语言会拒绝执行，而不是按英语朗读。异常过长的模型音频被拒绝，防止重复循环。Windows 系统语音只使用与请求语言匹配的已安装声音。

## Alternatives considered

**始终使用英语：** 错误的音素转换会破坏西班牙语。

**验证语言前改用其他声音：** 会导致回退语音与原始语言不一致。

**为每种语言自动下载额外模型：** Kokoro v1.0 模型没有覆盖所有语言，而且会浪费储存空间。

## Consequences

西班牙语使用正确的音素转换和符合助手资料的声音；未支持的语言切换到平台或浏览器。没有对应语音包的 Windows 系统必须依赖浏览器回退。Kokoro 声音的自然程度仍取决于模型，需要在目标 Windows 设备上实际试听才能验证。

## Testing

TypeScript 测试覆盖语言判断、客户端到 Host 的语言传递、西班牙语默认值与助手性别。守护进程的 `--self-test` 验证语音标识符和不支持语言的拒绝逻辑；Windows 安装的 `--check` 执行西班牙语模型合成。
