# Phoenix MCP：官方端点和认证审查（2026-10-07）

[English](phoenix-mcp-endpoints-2026-10-07.md) | 中文

本文根据提供商公开的配置说明审查 `packages/host/plugin-inventory/src/mcp-managed.ts` 中由 Host 固定配置的连接器。**核对文档并不等于已经完成用户账户的实时认证。** 运行时仍可能需要提供商批准、客户端注册、本地可执行程序、登录或工作区权限。

| Phoenix 连接器 | MCP 传输 URL／运行程序 | 认证与要求 | 官方参考 |
| --- | --- | --- | --- |
| **GitHub 官方远程服务**（来自注册表，不随精选连接器自动启动） | `https://api.githubcopilot.com/mcp/` | 支持的 MCP Host 可使用 OAuth；GitHub 同时支持 PAT／应用令牌的 Bearer 认证。不同客户端可能需要分别登录或配置令牌。GitHub 的代码／议题 MCP 工具不同于本地 GitHub CLI。 | https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md | |
| **Cloudflare API** | `https://mcp.cloudflare.com/mcp` | 优先使用 **OAuth**：登录 Cloudflare 并选择权限；API 令牌仅对无人值守或 CI 访问可选。请**勿**在设置中以普通 Cloudflare API 密钥条目替代授权。Cloudflare Code Mode 是默认的省 token 模式；`?codemode=false` 会暴露大量工具，并非默认。 | https://github.com/cloudflare/mcp and https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/ |
| Cloudflare 文档（独立服务，不自动安装） | `https://docs.mcp.cloudflare.com/mcp` | 提供商的文档 MCP，必须视为独立服务器身份。 | https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/ |
| Cloudflare 可观测性（独立服务，不自动安装） | `https://observability.mcp.cloudflare.com/mcp` | Cloudflare 托管的日志和分析 MCP；需要时使用 OAuth。 | https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/ |
| **Supabase** | `https://mcp.supabase.com/mcp` | 用户 OAuth 和动态客户端注册；交互式授权无需 PAT。项目、只读和功能限制是可选 URL 查询参数，不得编造。 | https://supabase.com/docs/guides/ai-tools/mcp |
| **Notion** | `https://mcp.notion.com/mcp` | 用户 OAuth。`/sse` 的 SSE 端点仅用于兼容旧客户端。 | https://developers.notion.com/guides/mcp/get-started-with-mcp |
| **Linear** | `https://mcp.linear.app/mcp` | 支持 OAuth 2.1 与动态客户端注册，也可选择 Bearer/API 密钥。提供只读端点 `/mcp/readonly`。 | https://linear.app/docs/mcp |
| **Canva** | `https://mcp.canva.com/mcp` | 需要 **OAuth 和受认可的客户端**。Canva Developer Portal 可为登记的重定向 URI 签发 `client_id` 与 `client_secret`。DCR 只为向后兼容而存在，不能保证未经注册的任意客户端都被允许。 | https://www.canva.dev/docs/apps/mcp/access/ and https://www.canva.dev/docs/apps/mcp/verify-app/ |
| **HeyGen** | `https://mcp.heygen.com/mcp/v1/` | MCP 使用用户 OAuth，无需直接提供 HeyGen API 密钥；套餐和额度可能限制使用。 | https://www.heygen.com/blog/generate-ai-videos-with-claude and https://www.heygen.com/es-es/integrations |
| **Figma Desktop** | `http://127.0.0.1:3845/mcp` | 本地连接需要正在运行且已启用 MCP 的 Figma Desktop，不使用浏览器 OAuth。远程 MCP 为另一端点 `https://mcp.figma.com/mcp`，不可与桌面运行时混用。 | https://developers.figma.com/docs/figma-mcp-server/local-server-installation/ and https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/ |
| **Slack** | `https://mcp.slack.com/mcp` | 使用已注册 Slack 应用及已知客户端 ID 的 OAuth；定制客户端通常还需要客户端密钥和获批的回调 URI。**不支持动态客户端注册。** 工作区政策可能阻止访问。 | https://docs.slack.dev/ai/slack-mcp-server/ |
| **Brave Search** | `npx -y @brave/brave-search-mcp-server --transport stdio` | 必须提供 API 密钥 `BRAVE_API_KEY`；这**不是**浏览器 OAuth。 | https://github.com/brave/brave-search-mcp-server |
| **Filesystem** | `npx -y @modelcontextprotocol/server-filesystem .` | 本地 stdio 服务，不使用浏览器 OAuth。访问范围由配置的根目录限制。 | https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem |
| **Memory** | `npx -y @modelcontextprotocol/server-memory` | 本地 stdio 知识图谱，无需浏览器 OAuth。 | https://github.com/modelcontextprotocol/servers/tree/main/src/memory |
| **Fetch** | `uvx mcp-server-fetch` | 本地 stdio 进程，需要安装 `uvx`，不使用浏览器 OAuth。 | https://github.com/modelcontextprotocol/servers/tree/main/src/fetch |
| **Devpost** | `https://devpost.com/mcp` | Phoenix 将其作为远程 OAuth 集成配置；必须实际授权并检查工具后才能宣称可用。提供商公开文档及实时授权仍需单独核验。 | https://devpost.com/ |
| **Binance Agent OS** | `https://agent.binance.com/mcp/agentic` | 可选的受限连接器；账户活动和真实交易必须获得用户明确批准，不属于自动安装的核心连接器。 | https://developers.binance.com/en/docs/agent-native/mcp-server |

## 界面与生命周期要求

1. MCP 的 `auth-required` 表示应通过该 MCP 专属的 `mcp-client/<server>` 流程执行 `Authorize`，而不是使用名字相似的旧版 API 令牌流程。对于 **Cloudflare** 尤其重要。
2. 浏览器 OAuth 必须使用提供商给出的有效授权 URL。预先打开的浏览器标签本身并不是同意页面；发现和注册期间应给出解释，收到提供商 HTTPS URL 后再导航。
3. 缺少 OAuth URL 代表失败或条件尚未满足，**不是**登录成功；应显示可操作的诊断，不应留下无法解释的空白标签。
4. `installed` 仅表示配置已经持久保存；只有达到 `ready` 状态并获得非空工具列表，才能宣称工具可用。
5. 不要在每次启动时静默安装所有可选远程连接器；也不要宣称注册表中全部项目都支持一键安装。
