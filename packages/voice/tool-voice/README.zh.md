# @phoenix-ai/dsh-tool-voice

[English](README.md) | 中文

PHOENIX 为 Kira 提供音频感知和语音工具。基础包在运行时注册这些工具； 采集 Windows 音频需要重启 Host，并保持原生桌面程序运行。

## Tools

- `phoenix_voice_status`：检查本地语音提供方、队列和 Codex Live 状态。
- `phoenix_voice_speak`：使用授权的服务合成用户明确要求播放的语音。
- `phoenix_audio_status`：不录音，仅检查 Windows 输出设备和麦克风是否可用。
- `phoenix_audio_listen`：在用户批准后采集 3–12 秒的扬声器或麦克风音频。
- `phoenix_audio_file_listen`：仅转写明确允许的目录中的本地媒体文件。
- `phoenix_senses_status`：查看真实的查看器、设备与语音状态。

## Configuration

PHOENIX 使用 `PHOENIX_VOICE_ENABLED`、`PHOENIX_VOICE_LANGUAGE` （默认 `es-DO`）以及现有本地语音服务。原生音频需要 Windows 上的 `Phoenix.exe` 桥接，并且每段音频都要用户明确授权。可选的 `PHOENIX_AUDIO_ALLOWED_DIRS` 环境变量以分号分隔被批准的媒体目录。 本地转写通过 `uv` 按需安装 `faster-whisper` 并在 CPU 上执行。

## Model Experience

### Consent-gated perception tools

#### What the model sees

`phoenix_audio_listen` 和 `phoenix_audio_file_listen` 返回真实的带时间标记的语音片段或明确的失败结果。`phoenix_senses_status` 仅返回能力元数据，不会冒充已获取图像或音频。

#### Token effect

只有简短转写和结构化回执进入模型上下文；原始 WAV 字节仅暂存在 Host 中，模型输出长度受到限制。

#### KV Cache effect

精简、稳定的工具描述和提示说明可跨轮次复用；捕获的音频转写会变化，不形成可复用的固定前缀。

## Known Limitations and Deferred Work

- 这些工具不能持续监听，不能识别所有环境声音或确认说话人，也不能绕过受保护媒体。
- 语音合成回执不证明用户听到了声音；查看器处于可用状态也不证明已收到图像。
- 每次 Windows 音频采集都要人工批准。
