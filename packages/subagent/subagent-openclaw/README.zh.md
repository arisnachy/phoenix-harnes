# OpenClaw Gateway 客户端

[English](README.md) | 中文

`@phoenix-ai/dsh-subagent-openclaw` 是面向公开 OpenClaw Gateway WebSocket 协议的可移植 TypeScript 客户端。它等待文档规定的 `connect.challenge`，使用默认的 `operator.read` 与 `operator.write` 最小声明范围发送有界 `connect` 请求，并提供不含凭据的健康、能力、会话、代理、事件以及只读自动化结果。

客户端使用文档规定的线协议，因为工作区没有公开的 `@openclaw/gateway-client` 包，而独立的主机管理器负责官方 Gateway 运行时。它不导入 OpenClaw 私有 SDK，也不安装或启动 OpenClaw。

```ts
import { OpenClawGatewayClient } from '@phoenix-ai/dsh-subagent-openclaw'

const gateway = new OpenClawGatewayClient({
  url: 'ws://127.0.0.1:18789',
  credentials: { token: process.env.OPENCLAW_GATEWAY_TOKEN },
})

try {
  const capabilities = await gateway.capabilities()
  const result = await gateway.executeAgent({
    message: 'Run the approved local operation.',
    idempotencyKey: 'phoenix-execution-0001',
  })
  console.log(capabilities.protocol, result)
} finally {
  await gateway.dispose()
}
```

明文 `ws:` 只接受回环地址（`localhost`、`127.0.0.1` 和 `::1`）。加密的 `wss:` 用于单独保护的部署。凭据只保留在主机拥有的客户端实例中，不会进入握手结果、RPC 结果、错误详情或事件负载。该客户端不会配对频道、登录频道、安装技能、修改配置，也不会提供 cron、技能或频道写入方法。

`executeAgent` 和 `executeSession` 要求调用方提供原生幂等键。`request` 限制 UTF-8 帧大小，支持每请求超时、`AbortSignal` 取消以及释放后的请求拒绝。`onEventGap` 报告缺失的 Gateway 序列；`reconcile()` 读取新的 `health` 与 `sessions.list`，由所属的 Phoenix 运行时决定恢复还是报告不确定执行。

包还导出 `subagent-openclaw` Cordis 插件和 `OpenClawExecutionAdapter`。配置明确的 `url`、`agentId`、`provider` 与 `model`（可选的主机凭据引用 `tokenRef` 和 `sessionKey`）后，才会向 Agent Teams 注册 `openclaw` 引擎。没有完整配置或尚未验证 Gateway 路由时，引擎仍会注册但报告未连接。派发前会把 Phoenix 快照与 `agents.list` 报告的精确模型及匹配的 `sessions.list` 行进行比较；不会向 `agent` 发送未在公开协议中声明的模型覆盖字段。只有 `agent.wait` 和会话记录确认完成，恢复也只等待持久化的原生绑定。

在可信 Host authority 提供受管路由、私有客户端工厂和当前会话策略证据之前，内置插件保持不可用。预留、派发和恢复前会根据所属 Phoenix 工作区与 sandbox 检查策略，缺省权限为只读。工具策略变化或原生会话无法验证时阻止执行。生产 Host authority 与真实模型 Gateway 验收仍待完成。传输认证不等于任务授权；未关联到 run 的会话历史不会作为结果返回。

## Model Experience

### 原生执行结果

#### What the model sees

传输本身不增加工具定义或系统指令。所属 Team 执行消费者提供已授权的任务、固定路由和有界参考记忆，接收关联到持久原生绑定的 `team/execution` 完成、失败或不确定结果；不包含 Gateway 原始历史或凭据。

#### Token effect

原生代理任务使用独立模型上下文。Phoenix 只传入有界任务、选定参考资料和关联结果；只读 Gateway 查询不生成模型 token。

#### KV Cache effect

任务结果追加到所属对话。传输不改写可复用提示前缀，也不宣称原生缓存命中。

## 已知限制和延期工作

- 当前包不负责配置或监管 OpenClaw 进程，不持久化设备身份，不自动重连，也不宣称兼容某个具体 Gateway 版本。真实官方 Gateway 检查仍属于部署验证，必须使用单独配置的本地 Gateway；包测试使用本地 `ws` 服务器，不能证明生产就绪。

- 模型、工具、频道、配对、审批和凭据策略仍由 Gateway 与 Phoenix 负责。该传输不会根据模型提供的数据扩大范围。

- 该传输不会选择 provider 或 model。`models.list` 只是目录，不能证明代理正在使用某条路由。只有当配置的原生代理和会话都报告 Phoenix 选定的精确 provider/model 时，适配器才会执行；否则会安全拒绝。频道配对、登录和投递设置仍是包外的显式部署操作。
