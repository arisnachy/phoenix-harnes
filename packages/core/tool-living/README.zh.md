# `@phoenix-ai/dsh-tool-living`

[English](README.md) | 中文

Universal Living Creations 的模型侧 Consumer。它安装一条与领域无关的规则，并通过 `ctx.living` 提供注册、连接器生成、检查、列出、读取、操作、验证以及显式遗忘创建物的工具。

## Model Experience

### System prompt

#### What the model sees

本插件注册 scope 中的每个 request 都会收到下方 standing universal-living policy；tool visibility 的变化不会移除独立注册的 prompt section。

##### Universal living creation policy

```markdown
Universal Living Creation policy：用户请求的 deliverable 是 mission；除非用户明确要求、此前已为该 creation 选择连接，或 connector 本身是请求功能所必需，否则 Phoenix connectivity 只是可选增强。不要仅因为创建了 artifact 就注册或安装 connector。需要连接且偏好未知时，只询问一次，不要静默启用。Connector setup 必须 fail-soft：每个 creation 最多进行两次有界 connect/repair attempt，并且 foreground wall time 约十秒；遇到 transport、contract 或 authorization failure 时，保留任何 offline manifest，将连接标记/报告为 degraded，并继续所有独立任务步骤。绝不能让 connector repair 消耗主任务、tests 或 final delivery。若用户要求 skip、forget、ignore 或 finish without connector，立即停止 connector 工作并继续任务；同一 turn 不再重试。不要把 living_verify_creation 当作通用 completion gate；只有 Phoenix connectivity 是明确 acceptance criterion 时才使用。控制 handshake 优先使用生成的 JavaScript/Python connector kit 或原生 Living tools；不要为 /connect 合成交互式 Invoke-WebRequest 或其他 PowerShell loop。绝不暴露或提交 bearer token。Agent 必须保持可选并由用户批准；connectivity 不代表 background worker。使用 connector 时，只暴露最小且有意义的 state/actions/events，保持 telemetry 有界，并在 manifest 中保留足够 resources 以便日后重连。
```

#### Token effect

插件启用期间，每个 request 都有固定 guidance 成本。

#### KV Cache effect

只要 plugin scope 与 policy text 不变，prefix 保持稳定。插件启用、卸载或 policy 变化可能从该 section 起使 cache reuse 失效。

### Tool schemas

#### What the model sees

工具可见时，模型看到生成的 [`living_register_creation`、`living_get_connector_kit`、`living_inspect_creation`、`living_list_creations`、`living_read_state`、`living_act`、`living_verify_creation` 与 `living_forget_creation` schemas](../../../docs/tool-catalog.md#phoenix-aidsh-tool-living)。

#### Token effect

Living tools 可见的 request 承担固定 schema 成本；manifest、state、connector descriptor 与 action result 的大小随数据变化。

#### KV Cache effect

definitions 与 visibility 不变时 prefix 稳定。tool lifecycle 或 scoped restriction 可能从第一个变化的 schema token 起使 reuse 失效；tool result 追加在可复用 prefix 之后。

## Known Limitations and Deferred Work

- 生成的 connector kit 有意保持 transport-light 与 owner-local。公共浏览器 bundle 不得包含 bearer token；面向浏览器的产品应把 Phoenix connector 放在服务端进程或 sidecar 中，或使用其他安全 provider 实现。
