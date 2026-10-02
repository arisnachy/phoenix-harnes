# @phoenix-ai/dsh-voice-codex

[English](README.md) | 中文

这是 PHOENIX Kira Live 的 Host-only Codex CLI realtime 语音传输层。它复用本机已认证的 Codex 安装以及实验性的 `thread/realtime/*` app-server API 来协商浏览器 WebRTC 音频。Phoenix 仍然拥有推理和执行权威。

## 配置

```yaml
- id: voice-codex
  name: '@phoenix-ai/dsh-voice-codex'
  config:
    enabled: true
    command: codex
    model: null
    voice: null
    requestTimeoutMs: 15000
```

适配器按需启动一个能力缩减的 Codex `app-server`，创建临时 thread，协商仅接收音频的 WebRTC session，并且只通过 `thread/realtime/appendSpeech` 发送 PHOENIX assistant 文本。它启用 `clientManagedHandoffs`、关闭 startup context，并向 realtime session 提供仅渲染语音的指令，因此它不会变成第二个 agent。

浏览器直接通过 WebRTC 接收远端 SDP answer 和音频。Codex credential、OAuth 状态以及 `CODEX_HOME` 都保留在 Host，绝不会返回浏览器。Windows teardown 会终止完整的 app-server 进程树。

`PHOENIX_CODEX_VOICE=0` 可禁用该 provider。`PHOENIX_CODEX_COMMAND`、`PHOENIX_CODEX_REALTIME_MODEL` 和 `PHOENIX_CODEX_VOICE_NAME` 可覆盖命令或 Codex 公布的 realtime 默认值。省略 model 和 voice 会有意让已安装的 Codex 版本选择当前默认值。

## Model Experience

### Kira Live 语音渲染器

#### What the model sees

普通 PHOENIX 推理/执行模型不会收到额外提示内容。Codex realtime 语音 session 只看到渲染器指令和通过 `appendSpeech` 交付的已规范化 assistant 文本；该适配器不会向其提供 PHOENIX 工具、startup context 或任务权威。

#### Token effect

主 PHOENIX 轮次不会增加 prompt token。Codex realtime 音频渲染可能产生独立的 provider 侧 realtime 用量。

#### KV Cache effect

主 PHOENIX session 缓存不变。临时 realtime thread 仅属于传输状态，在 Kira Live session 关闭或 Host 退出时丢弃。

## 已知限制与暂缓事项

- Codex 将 `thread/realtime/*` 标记为实验性，因此适配器必须进行 capability probe，并随上游协议变化演进。
- Kira Live 需要本机已认证的 Codex CLI 和浏览器 WebRTC；任一不可用时，PHOENIX 会 fallback 到 PHOENIX Natural 和浏览器语音。
- 麦克风语音识别仍使用现有浏览器适配器。在上游 realtime 事件契约足够稳定、可以承载持久输入语义之前，不把麦克风音频和转写完全迁移到 Codex realtime。
