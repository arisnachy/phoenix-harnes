# @phoenix-ai/dsh-tool-home-gateway

[English](README.md) | 中文

基于 [`ctx.home`](../home-gateway/README.zh.md) 的面向模型 Home Assistant 工具。`home_list_devices` 读取已配置实体的当前状态。`home_control` 为已配置实体调用已配置服务，并转发调用方的取消信号。

插件注册一个系统提示词段，禁止直接 LAN 访问、臆造实体 id、网络发现以及 allowlist 之外的服务。其通用执行卡显示选定实体或读取操作，不暴露凭据。

## 模型体验

### Allowlisted device tools

#### What the model sees

模型看到两个稳定命名且输出有界的 JSON 工具。控制结果报告实体、完整服务名、HTTP 状态和成功标志。错误保持为工具失败，使 mission persistence 层能够重新规划，而不会把被拒绝的设备操作视为任务完成。

##### Tool schemas

```markdown
See the generated [home_control and home_list_devices catalog entries](../../../docs/tool-catalog.md#phoenix-aidsh-tool-home-gateway).
```

#### Token effect

两个稳定的工具 schema 和一个有界结果会增加少量固定请求成本；设备状态只会出现在明确调用的结果中。

#### KV Cache effect

只要此包已加载，工具定义就保持前缀稳定。设备状态和控制结果会追加到可复用的请求前缀之后。

## 已知限制与暂缓事项

- 只有在显式启用并配置 `home-gateway` 服务时才能使用此工具。
- 不提供语音命令、自动设备发现，也不直接支持 Home Assistant 之外的平台。
