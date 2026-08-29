# Agent Note: Model connector inventory

Status: implemented

[English](2026-08-29-model-connector-inventory.md) | 中文

## 问题

PHOENIX 可以暴露已连接的 MCP tools 和浏览器 authorization panel，但模型没有只读操作来确定在选择 connector capability 之前哪些 authorization flows 或 provider services 可用。MCP tools 也没有面向模型的生命周期状态，因此无法区分正在 reconnect 的 server、永久失败的 server 和已就绪的 server。

## 决策

只要挂载 authorization seam，HARDNESS adapters 就注册 `connector_list`。该 tool 将 flow identifiers、labels、methods、in-flight 状态以及 provider 自己提供的 connector telemetry 投影到封闭的 model-facing result。成功 telemetry 报告为 `connected`，成功但为空的 inspection 报告为 `not-connected`，inspection 失败报告为 `unknown`。

该 tool 只负责 inventory。它不会调用 `authorization.begin()`、断开账户、授予权限或复制 credential records。服务 telemetry 按封闭的 authorization type 重新构建，排除账户身份、usage、URLs 和任意 provider payload。

base composition 在 `ctx.mcpConnectors` 挂载 `McpConnectorRegistry`。每个 MCP client 通过可逆 registration 发布 transport、生命周期状态、稳定 reason code 和公开 tool 名称。supervisor 在有界恢复期间保留名称，在 retry exhaustion 后清除名称，并且只在明确的 Streamable HTTP 401 或 403 时发布 `auth-required`。配置、credentials、URLs、headers、environment variables 和 provider 原始错误不会进入 registry 或 `connector_list`。

## Alternatives considered

**让模型从 tool 错误中推断 connector 状态。** 否决：credential 不可用和 provider 不可用将无法区分，而且模型必须尝试 action 才能知道一个只读事实。

**暴露完整 authorization telemetry 对象。** 否决：browser contract 允许账户和 usage metadata，但 model inventory 只需要服务可用性，该表面应更窄。

**让 `connector_list` 启动 OAuth。** 否决：authorization 是 browser/API surface 管理的人类交互；model-facing read operation 不得把 discovery 变成 authority grant。

**从已注册的 tool 名称推断 MCP 状态。** 否决：名称无法表示没有发现 tool 的 server，也无法区分 ready generation 与正在 reconnect 或已失败的 transport。

## 影响

每个带 authorization 的普通 base profile 现在都会向模型提供稳定、可审计的 connector inventory，并与 `hardness_run` 并列。已连接的 MCP tools 仍沿用现有的 tool、approval、sandbox 和 session-log 路径。没有安全 telemetry 的 provider 仍以 `unknown` 可见，因此模型不能仅根据 flow registration 声称 connector 已就绪。

即使 MCP 不可用，MCP entry 仍会显示，因此模型可以解释有界失败而不会盲目 retry。处于恢复过程中的 disconnected entry 可能保留上一次的 tool 名称；模型在选择这些 tool 之前必须遵守生命周期状态。
