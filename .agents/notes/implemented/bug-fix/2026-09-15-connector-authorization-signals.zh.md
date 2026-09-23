# Agent Note：连接器授权信号

Status: implemented

[English](2026-09-15-connector-authorization-signals.md) | 中文

## 问题

两个彼此独立的缺陷掩盖了连接器是否已获得授权。

拒绝未认证请求的远程 MCP 服务器会返回 401。MCP SDK 抛出 `StreamableHTTPError`，其中 HTTP 状态位于 `code` 字段；连接监督器只读取 `status`，因此该拒绝落入通用失败路径。连接器被发布为 `failed`、原因为 `connection-failed`，耗尽全部重连预算后以 `retry-exhausted` 结束——该状态既不请求用户授权，也不保留可操作的原因。面向模型的清单无法区分“需要授权”与“已损坏”。

另一方面，pi-ai 提供方授权流只注册了 `key`、`label`、`methods` 与 `run`，没有注册 `inspect`。只有检查返回遥测时，授权流才会被发布为已连接，因此用户已经存有凭据的每个提供方仍读作 `not-connected`，包括持有已存 API 密钥或 OAuth 授权的提供方。

## 决定

MCP 客户端中的 `httpStatus` 先读取数字型 `status`，再回退到数字型 `code`，因此无论抛出方使用哪个字段，Streamable HTTP 拒绝都会被归类为授权请求。非数字 `code`——例如 Node 网络码 `ECONNREFUSED`——不是 HTTP 状态，仍报告为连接失败。401 与 403 保持既有含义：连接器变为 `auth-required`，原因为 `authorization-required`，且不再为在用户授权前会持续拒绝的服务器消耗重连预算。

每个 pi-ai 提供方授权流现在声明 `inspect`，它读取凭据记录，并且只为该授权流自身拥有的记录返回账户遥测：api-key 记录的 `accountType` 为 `apiKey`，授权的为 `oauth`。没有记录即没有遥测，因此未认证的提供方仍读作未连接。遥测只说明提供方与凭据类型，不携带任何机密材料，符合授权接缝已强制执行的封闭遥测契约。

## 影响

远程 MCP 连接器所需的授权现在通过既有 `auth-required` 状态与 `authorization-required` 原因码在连接器清单中可见，这也是状态界面与模型共同读取的内容；没有引入新的状态或原因码。凭据已存储的提供方不再被报告为未连接，因此按已连接条目过滤的设置界面不再隐藏用户已认证的路由。

该分类仍取决于失败以拒绝对象的形式到达监督器；自行吞掉 401 的传输仍会报告连接失败。`UnauthorizedError` 处理未变，仍覆盖传输持有 OAuth 提供方的路径。

## 验证

`packages/mcp/mcp-client/tests/apply.spec.ts` 覆盖 SDK 形式的拒绝（`code: 401`）应为 `auth-required`，以及非数字网络码应为 `connection-failed`，并与既有 `status: 401` 用例并列；该文件以 24 个测试通过。

`packages/llm/llm-pi-ai/tests/login.spec.ts` 新增授权用例与 api-key 用例，断言检查遥测，并包含存储任何凭据之前的空回答。由于该包依赖树中的 `typebox` 与 `zod-to-json-schema` 副本不完整，pi-ai 包测试无法在撰写环境中执行；这些用例是针对先前实现会失败而编写的。

## 考虑过的替代方案

- **把每个 transport failure 都视为 authorization failure** — 拒绝，因为 `ECONNREFUSED` 等网络错误必须与 HTTP 401/403 保持可区分。
- **只根据已配置的授权方法推断 provider 已连接，而不检查已存凭据** — 拒绝，因为存在授权 flow 并不能证明用户已经完成认证。
- **在 authorization telemetry 中暴露 credential material** — 拒绝，因为 connected-state telemetry 只需要 provider identity 与 credential kind，不需要 secret 本身。
