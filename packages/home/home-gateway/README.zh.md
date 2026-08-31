# @phoenix-ai/dsh-home-gateway

[English](README.md) | 中文

面向私有或本地端点的 Home Assistant 能力。`HomeAssistantGateway` 接收 token 提供方，按配置的实体和服务 allowlist 验证每个请求，并返回有界状态或控制结果。`HomeAssistantGatewayService` 通过 `ctx.home` 暴露相同操作。

配置必须包含 `baseUrl`、`tokenEnv`、非空的 `allowedEntities`、非空的 `allowedServices` 和正数 `requestTimeoutMs`。URL 不得包含内嵌凭据，并且必须解析到 localhost、`.local` 主机、私有 IPv4 范围或没有公共后缀的主机。服务只在发起请求时读取 token。

## Model Experience

### Home Assistant state and control capability

#### What the model sees

配套的 [`tool-home-gateway`](../tool-home-gateway/README.zh.md) 提供 `home_list_devices` 和 `home_control`。模型只能看到 allowlist 中的实体，不能扫描 LAN 或调用未批准的服务。

#### Token effect

此包本身不直接添加 prompt 文本或工具 schema；配套工具添加两个稳定名称和有界 JSON 结果。

#### KV Cache effect

不会直接使缓存失效；配置 allowlist 的变化影响工具结果，不影响请求前缀。

## 已知限制与暂缓事项

- 提供方仅实现 Home Assistant 的状态和服务调用 REST 端点。
- 响应属性会投影为 JSON，不包含提供方专用的设备历史记录。
