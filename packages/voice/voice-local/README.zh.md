# @phoenix-ai/dsh-voice-local

[English](README.md) | 中文

为 [`@phoenix-ai/dsh-voice`](../voice/) 提供本地语音进程。Windows 上的后台安装脚本 `install-kokoro.ps1` 将 Kokoro ONNX 模型与独立 Python 环境放在 `%LOCALAPPDATA%\\Phoenix\\voice\\kokoro`，而非临时 Git worktree。安装完成前原生语音仍可使用。设置 `PHOENIX_KOKORO_AUTO_INSTALL=0` 可关闭自动安装。

## 配置

```yaml
- id: voice-local
  name: '@phoenix-ai/dsh-voice-local'
  config:
    kokoroCommand: null
    kokoroArgs: []
    kokoroPrewarm: false
    sttCommand: null
    sttArgs: []
    systemTts: true
```

显式设置 `kokoroCommand` 时会使用该命令；否则自动探测已安装的 Windows Kokoro 常驻守护进程，安装完成后运行时也会自动连接。客户端逐句发送文本语言；旧客户端在 Host 上默认使用 `es-DO`。不受 Kokoro v1.0 支持的语言不会被当作英语合成，明显过长的模型音频也会被拒绝。Windows 系统语音仅使用与指定语言匹配的已安装声音，避免错误地使用英语默认声音。

西班牙语女性助手使用 `ef_dora`，男性助手使用 `em_alex`；英语使用 `af_heart` 和 `am_michael`。Kokoro 通过隔离环境内的 eSpeak NG 实现西班牙语音素转换。对话的优先级为 Codex Realtime、Kokoro、平台语音，然后客户端浏览器语音回退。

进程通过 `shell: false` 启动，并通过 stdin/stdout 传递文本或语音请求。系统 TTS 在 Windows 使用 `System.Speech`，macOS 使用 `say`，Linux 使用 `espeak-ng`。

## 扩展点

`VoiceCommandRunner` 可以在测试或宿主适配器中注入。部署也可提供自定义 Kokoro 或 STT 命令。

## Model Experience

### 本地语音 provider

#### What the model sees

该服务运行于 Host，不向模型添加工具或上下文，也不负责判定任务完成。

#### Token effect

本地语音合成不会增加模型 token，模型生成完成后才通过进程管道处理文本。

#### KV Cache effect

音频生成不参与提示词组装，因此不影响 KV 缓存。

## 已知限制与暂缓事项

- 内置 Kokoro 安装与探测目前针对 Windows；首次安装需要 Python 3.12、足够磁盘空间与模型下载。
- 自定义命令的可用性检测不等于模型已安装；若运行失败会尝试其他可用语音。
- 不支持的 Kokoro 语言、STT 音频格式转换以及系统语音包的安装由对应平台处理。
