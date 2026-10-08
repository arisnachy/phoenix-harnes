# @phoenix-ai/dsh-voice

[English](README.md) | 中文

PHOENIX 的 provider 中立异步语音服务。只有经确认的任务完成、重要发现、真实阻塞、帮助请求和授权请求才会触发旁路语音，普通工具事件与进度保持静默。

## 配置

```yaml
- id: voice
  name: '@phoenix-ai/dsh-voice'
  config:
    enabled: true
    language: es-DO
    maxQueue: 3
    maxChars: 480
    ttsProvider: kokoro
```

`announce()` 立即返回 receipt，有限队列在后台完成语音输出。重复事件受到抑制，`cancel()` 与 `stop()` 取消活动任务。provider 出错不会终止 Phoenix 的任务执行。

`displayOutputToVoiceText()` 去除 Markdown、代码、URL、HTML、emoji 和疑似密钥，并按照句子截断。

## Provider

实现 `VoiceTextToSpeechProvider` 或 `VoiceSpeechToTextProvider` 后即可注册 provider。对话首选原生 OpenAI/Codex Realtime，其次是本地 Kokoro，最后是平台语音。新客户端从实际文本和界面语言决定 BCP 47 标签并逐段传递；旧客户端的 Host 默认语言为 `es-DO`。助手资料中的女性或男性呈现方式逐段传递给语音提供方，保证其身份一致。

## Model Experience

### 语音旁路

#### What the model sees

语音不会自动添加模型上下文。只有显式事件 `voice/important` 可以请求语音播放，音频不进入提示词上下文。

#### Token effect

语音输出由 Host 后台处理，不产生额外模型 token。

#### KV Cache effect

队列状态、语言选择与音频播放均在提示词组装之外，不影响 KV 缓存。

## 已知限制与暂缓事项

- Kokoro 模型在 Windows 单独安装，不能保证每个语言都有模型声音。
- 浏览器麦克风采集与 Host STT 是独立适配器，需要相应权限或命令。
- AI 生成的音频应由启用该功能的产品界面作出披露。
