# PHOENIX Senses — 数字感知能力

[English](phoenix-senses.es.md) | 中文

PHOENIX Senses 以真实证据和明确权限连接音频、图像和语音。
此阶段不包含触觉、嗅觉、味觉或物理传感器。

## Oído

- `phoenix_audio_status`：不录音，仅检查扬声器和麦克风可用性。
- `phoenix_audio_listen`：采集 `output` 或 `microphone` 的 3 至 12 秒音频。
  每次调用都需要在 Windows 原生对话框中明确同意。
- `phoenix_audio_file_listen`：仅处理 `PHOENIX_AUDIO_ALLOWED_DIRS`
  允许目录中的 WAV、MP3、M4A、OGG、FLAC、WebM 和 MP4 文件；
  文件不超过 32 MiB，且不会扫描磁盘。
- `video_media_inspect` 和 `youtube_video_listen`：使用既有的浏览器
  视频授权流程；受版权保护的音频可能无法采集。
- 原生临时录音转写后会删除，旧临时文件会被清理；
  用户的原始媒体文件保持不变。

## Visión y autoconocimiento

- Desktop Live、Computer Use 和 MiniBrowser 提供经授权的可视内容。
- `phoenix_senses_status` 检查查看器和设备状态，
  但不能据此声称已看到图像或听到声音。
- 实际视觉必须来自 Desktop Live 或 Computer Use 的真实截图。
  浏览器视频沿用既有的授权工具。
- `phoenix_voice_status` 和 `phoenix_voice_speak` 提供语音输出。
  提供方的成功回执并不等于扬声器声音已被听到。

## Instalación y permisos

1. 在同一个 Windows 用户账户中更新 Host 与 `Phoenix.exe`。
   需要 .NET 8 和 `NAudio.Wasapi` 依赖。
2. 将 `PHOENIX_AUDIO_ALLOWED_DIRS` 设置为以分号分隔的具体目录；
   不要一次授权整个磁盘。
3. 安装 `uv` 以使用本地 `faster-whisper`，采用 CPU INT8，
   并在首次需要时下载相应模型。
4. 可要求 Kira 检查感知能力、监听扬声器或观察应用，
   并在实际采集前批准对应来源。

## Límites verificables

- 采集设备为默认多媒体设备，不能逐一隔离所有进程的声音。
- 转写可以识别语音，不能可靠识别全部环境声音和所有说话人。
- 录音只能短暂进行并需要授权；没有持续监听或连续视觉。
- 源码中存在工具不代表当前会话可用；
  必须检查实际加载状态。
