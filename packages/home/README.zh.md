# Home

[English](README.md) | 中文

Home 组包含私有网络 Home Assistant 能力及其面向模型的工具。能力负责 HTTP 授权、端点验证、实体与服务 allowlist 以及有界状态投影；工具包负责面向模型的 schema 和呈现。

默认 bundle 会禁用这些插件。操作员通过 `PHOENIX_HOME_ASSISTANT_URL`、`PHOENIX_HOME_ASSISTANT_TOKEN_ENV`、`PHOENIX_HOME_ASSISTANT_ALLOWED_ENTITIES` 和 `PHOENIX_HOME_ASSISTANT_ALLOWED_SERVICES` 启用它们。端点必须是本地或私有端点，token 值保留在所引用的环境变量中。

请参阅 [`home-gateway`](home-gateway/README.zh.md) 中的提供方约定，以及 [`tool-home-gateway`](tool-home-gateway/README.zh.md) 中的模型行为。

## 已知限制与暂缓事项

- 此集成面向 Home Assistant REST API；其他家庭平台需要单独的能力提供方。
- 不提供自动 LAN 发现。设备和服务必须显式加入 allowlist。
