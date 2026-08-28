# `@deepseek-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

## Model Experience

### 投影的 capability metadata

#### What the model sees

消费者可以向模型暴露稳定 capability 标识，例如 `tool:<name>`、`skill:<name>` 与 `openclaw:<id>`，以及 compatibility 和验证状态；执行仍由 PHOENIX approval 与规范 registry 控制。

#### Token effect

只有任务实际选择并呈现的 capability metadata 会增加模型 token；单纯索引源 registry 不会自行增加 prompt 文本。

#### KV Cache effect

只要源 schema、extension metadata 与验证状态保持不变，投影 catalog 就保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- 外部 extension 执行继续由 Capability Broker 与隔离 package-host contract 管理，不会在启动时被 eager activate。
