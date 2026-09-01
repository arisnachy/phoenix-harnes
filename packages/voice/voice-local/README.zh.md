# @phoenix-ai/dsh-voice-local

[English](README.md) | 中文

为 [`@phoenix-ai/dsh-voice`](../voice/) 提供本地进程 provider。该包不会在启动期间下载模型或启动进程。

## 配置

```yaml
- id: voice-local
  name: '@phoenix-ai/dsh-voice-local'
  config:
    kokoroCommand: null
    kokoroArgs: []
    sttCommand: null
    sttArgs: []
    systemTts: true
```

配置 `kokoroCommand` 后，`kokoro` provider 会通过 stdin 接收规范化的 UTF-8 文本，并优先于系统 provider。`sttCommand` 通过 stdin 接收音频字节，并必须将一个转写结果写入 stdout。系统 provider 在 Windows 使用 PowerShell `System.Speech`，在 macOS 使用 `say`，在 Linux 使用 `espeak-ng`。

命令使用 `shell: false`、明确参数、隐藏的 Windows 窗口、有界 stdin/stdout 管道和取消处理运行。该包不会把 secret 放入命令参数或日志。

## 扩展点

在测试或 host wrapper 中注入 `VoiceCommandRunner`。部署可以提供由官方本地 pipeline 支持的 Kokoro 命令；该包有意不选择模型权重、下载策略或 shell 脚本。

## Model Experience

### 本地语音 provider

#### What the model sees

该包只运行在 host 端。它不会提供模型可见工具或上下文，也不会决定任务完成；`VoiceCommandRunner` 保持为 host 扩展点。

#### Token effect

本地 provider 不增加模型 token；它们在面向模型的工作完成后，通过主机管道接收文本或音频。

#### KV Cache effect

没有缓存影响，因为命令执行和音频播放保持在提示组装之外。

## 已知限制与暂缓事项

- 可用性检查只检查配置；命令安装状态会在第一次请求时验证。
- STT 格式转换、麦克风采集和音频播放策略属于 client 或部署适配器。
