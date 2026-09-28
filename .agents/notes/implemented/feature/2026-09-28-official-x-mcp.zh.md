# Agent Note: Official X MCP integration

Status: implemented

[English](2026-09-28-official-x-mcp.md) | 中文

## Problem

X 提供两个官方 MCP surface，但认证模型不同。Docs MCP `https://docs.x.com/mcp` 是无需凭据的 Streamable HTTP server。X API MCP `https://api.x.com/mcp` 不提供 Phoenix 为普通远程 MCP 使用的通用 MCP OAuth discovery flow；X 文档把官方本地桥接器 `@xdevplatform/xurl` 定义为带用户上下文 API 访问的 OAuth 2.0 PKCE 路径。因此，如果把 API endpoint 当作普通的 `oauth: true` remote，Phoenix 会得到一个看似已配置但无法完成 X 所需授权流程的 connector。

现有 stdio MCP config 也只能接受字面环境变量值。若直接把 X developer credential 放进去，秘密会进入 Loader configuration 与 owner overlay，这与 Phoenix 的 credential-reference 设计冲突。

## Decision

MCP client 现在为 stdio server 支持 `envCredentialRefs`。映射中只保存子进程环境变量名与 Phoenix credential reference。每一代连接建立时，MCP client 从 `ctx.credentials` 解析这些引用，只把实际值注入该子进程环境；引用缺失时在 spawn 前直接标记为 `auth-required`。环境中其他 credential-shaped 变量仍会被清理。

Host managed-MCP controller 只允许一个脱离通用 registry 路径的精确 stdio 配置：server `x-api`、command `npx`、参数 `-y @xdevplatform/xurl mcp https://api.x.com/mcp`、空字面环境，以及 `CLIENT_ID -> X_CLIENT_ID`、`CLIENT_SECRET -> X_CLIENT_SECRET` 两个 credential reference。启动预算为 300 秒，因为 X 文档说明首次授权可能打开浏览器并等待用户完成。Controller 还允许精确固定的免凭据 `x-docs` remote：`https://docs.x.com/mcp`。持久化 managed overlay 在接纳前会严格验证这两套配置。

完整 model-tool scope 会暴露 `x_mcp_activate`。它要求用户明确请求、存在 active agent，并完成一次中风险批准。激活只安装两个固定 connector，不执行任何 X 账户操作。返回值只报告 connector lifecycle 以及两个 credential reference 是否已配置。Settings → Connectors 目录中也会显示 X 这一 MCP integration。

## Alternatives considered

**直接使用 Phoenix 通用 MCP OAuth provider 连接 `https://api.x.com/mcp`。** 被拒绝，因为 X 没有公布该 provider 所需的标准 discovery flow。

**把 `CLIENT_ID` 和 `CLIENT_SECRET` 直接写入 managed stdio config。** 被拒绝，因为 Loader configuration、diagnostics 与持久 overlay 都不能成为秘密存储。

**只使用 X Docs MCP。** 被拒绝，因为它只能满足文档检索，不能满足用户对可操作 X API access 的需求。

**允许通用 registry installer 执行任意 package-based MCP command。** 被拒绝，因为这会扩大所有 registry result 的可执行安装边界。X 仍是范围狭窄、由厂商固定且严格验证 command 与 endpoint 的例外。

## Consequences

Phoenix 可以无需凭据查询 X 文档，并可通过厂商支持的 xurl authorization bridge 激活官方 X API MCP。Developer credential 继续保存在现有 human-only Phoenix vault 中，不进入 model argument，也不写入 managed MCP persistence。首次 X API authorization 仍可能需要交互，并且耗时会长于普通 MCP startup。移除 managed X bundle 只会删除 Phoenix 的 connector row，不会声称撤销 X/xurl 持有的 credential 或 grant；provider 端 revoke 仍是独立操作。
