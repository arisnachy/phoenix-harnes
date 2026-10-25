# Phoenix 中的 Microsoft MCP（2026 年 10 月）

[English](microsoft-mcp.md) | 中文

Phoenix 将 Microsoft Learn、按服务划分的免费 Graph（Phoenix 本地实现）、Work IQ 和 Azure 作为独立连接器。官方 Microsoft Learn、Work IQ、Azure MCP 均可从设置 → 连接器安装。**Microsoft Learn Docs** 默认作为免费公共 MCP 准备；**Work IQ 和 Azure** 属于可选能力，不得在用户未确认其要求时自动安装或使用。Windows Host 必须更新才能获得这些功能。

## 1. Microsoft Learn Docs MCP — 公共且免费

- 官方说明：https://learn.microsoft.com/en-us/training/support/mcp-developer-reference
- 服务器：`https://learn.microsoft.com/api/mcp`，采用 Streamable HTTP，无需 OAuth。
- 更新后的 Phoenix 免费基础包会自动安装 **Microsoft Learn (Docs)**；如果不可用，须检查并修复连接，不得无证据宣称已就绪。
- Kira 可以检索 Microsoft 365、Windows、Azure、Graph 与开发文档，并核对来源。
- 此服务器**不**授予 Outlook、私人文件、日历或消息访问权限。
- 公共文档服务本身免费。

## 2. Microsoft 365 Work IQ MCP — 统一套件，需要计费

- 官方说明：https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/cli
- 官方包：`@microsoft/workiq`；MCP 启动命令：`npx -y @microsoft/workiq mcp`。
- Phoenix 安装路径：**Microsoft 365 Work IQ** → 查看成本提示 → **安装**。
- 根据租户与许可情况，可查询 Outlook 邮件、会议、日历、OneDrive/SharePoint 文档、Teams 和人员；不保证全部数据或写权限可用。
- 必要条件包括 Node.js、与 Azure 订阅及资源组关联的 Copilot Studio 按量计费计划、已分配计费的用户、管理员对 Entra 权限的批准。
- Phoenix **不得自动接受 EULA**。用户应在受信终端阅读并自行执行 `npx -y @microsoft/workiq accept-eula`。
- Work IQ **并非免费**：即使持有 Microsoft 365 Copilot 许可，超出许可覆盖的请求仍可能按量收费。未经用户授权与预算核实，不得持续调用。
- 安装了软件包不等于 Microsoft 会话已经认证；必须核实真实工具。

## 3. Azure MCP — 本地统一入口，云资源可能收费

- 官方说明：https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/concepts
- 官方包：`@azure/mcp@latest`。
- 启动：`npx -y @azure/mcp@latest server start --mode consolidated`。
- 安装前需要接受费用提示；通过 `az login` 在用户会话中认证。
- MCP 软件本身没有额外授权费，但 Azure 的计算、存储、数据库及其他实际资源可能收费。
- 采用 `consolidated` 模式，避免一次暴露超过 200 个工具而浪费 token。
- 创建、删除资源或启动收费服务必须再次得到明确许可并检查价格。

## 4. 为什么不单独自动安装 Outlook、Teams、OneDrive、SharePoint？

官方仓库 https://github.com/microsoft/mcp 中的许多企业服务器托管在 Agent 365，需要租户 ID、Microsoft Entra 应用注册、组织身份、订阅及相应授权。**没有适用于所有 Microsoft 应用的匿名免费通用 MCP 入口**。

因此，在目录中单独显示的 Outlook、Teams、OneDrive 和 SharePoint 卡片不能因为 Work IQ 已安装就标成已连接。Kira 必须实际检查目标服务的连接、可用工具和权限；Graph 管理与写入权限需独立开通。SharePoint Embedded 另有 https://github.com/microsoft/SharePoint-Embedded-MCP-Server，但它需要独立应用注册、租户及 Embedded 资源，不代替普通 SharePoint。

## 5. 安装后如何验证

1. 验证更新后的 Host 确实提供 Microsoft Learn、Work IQ 和 Azure 三个入口。
2. 安装 **Microsoft Learn (Docs)** 并检查 `microsoft-learn` 是否真正 `ready` 且能列出工具。
3. Work IQ 需要先确认成本、租户许可、EULA、安装及认证。
4. Azure 可先执行 `az login`，安装后检查工具列表，再做其他操作。
5. 不要把 `managed.patch.yml` 中的定义当作成功连接的证据，也不要将 token 发到聊天中。

## 6. 隐私及费用

身份和权限由服务提供方管理。**Microsoft Learn** 只读取公共技术文档，不需要凭据；**Work IQ 和 Azure** 需要认证并可能产生账单。三者有独立状态；Work IQ、Azure 都**不**属于自动启动的 `CORE_MCP_PACK_IDS`。

## 7. Microsoft 个人账户（Outlook、日历、联系人、OneDrive）— 免费

Phoenix 另外提供本地 `microsoft-personal` MCP，与 Learn、Work IQ、Azure 分开。它使用 Microsoft Graph 的 OAuth 委托式**设备代码授权**，不需要付费 Microsoft 365、Copilot 或替用户接收邮件的第三方服务器。

**初次设置不可省略：** 必须在 [Microsoft Entra](https://entra.microsoft.com/) 注册自己的公共客户端应用，获得公开的 Application/client ID（UUID）。在 App registrations → New registration 允许个人 Microsoft 账户，在 Authentication 启用 **Allow public client flows**。配置 Graph 委托权限 `User.Read`、`Mail.Read`、`Calendars.Read`、`Contacts.Read`、`Files.Read`；如需写入，再配置 `Mail.ReadWrite`、`Mail.Send`、`Calendars.ReadWrite`。参见 [Microsoft 官方应用注册指南](https://learn.microsoft.com/en-us/graph/auth-register-app-v2)。受组织管理的企业账号不属于此个人端点，应使用正确的企业身份流程。

### 在 Phoenix 中激活

1. 更新 Phoenix，打开设置 → 连接器 → 基础 MCP 包，或安装 `microsoft-personal`。
2. 让 Kira 以公开的 Application/client ID 调用 `microsoft_setup`，或者在 Host 环境中配置 `PHOENIX_MICROSOFT_CLIENT_ID` 并重启；不要在聊天里发送私密凭据。
3. Kira 以 `mode: "read"` 调用 `microsoft_login_start`，用户在**Microsoft 官方网址**输入返回的设备代码。
4. Kira 根据 `retryAfterSeconds` 重试 `microsoft_login_complete`，直到确认 `authorized`，然后用 `microsoft_profile` 验证账户。确认前不能声称完成。
5. 需要发送邮件或修改日历时，必须以 `mode: "write"` 额外授权。

可用工具包括邮件收件箱、个人资料、日历、联系人及 OneDrive 文件夹读取；获写权限后可创建草稿、发送邮件与日历事件。真实发送前须获得用户的**明确批准**，`microsoft_mail_send` 中的 `confirm` 参数不能取代批准。此版本 OneDrive 仅提供读取，不能据此承诺编辑 Office 文件，也不解锁付费企业 Teams/SharePoint。

**持久化与隐私：** token 不返回给模型或 MCP 库存。Windows 使用 **DPAPI CurrentUser** 将刷新凭据保存为 `~/.dsh/microsoft-personal/refresh.dpapi`；macOS/Linux 只在进程运行期间保留，不将其明文写盘。`microsoft_disconnect` 删除本地 token，彻底撤销授权还需要在 Microsoft 端操作。通常 Graph 基本操作不单独计费，但仍受配额、限流与提供方政策约束。

本地 MCP 用 Node 从活动 Phoenix 版本目录中的 `scripts/phoenix-microsoft-personal-mcp.mjs` 启动。应检查 Node 版本和脚本存在，再验证工具与认证，不得混淆“已安装”和“已登录”。

## 8. Outlook 和 Microsoft Graph 独立服务：六个连接器

**设置 → 连接器** 可以分别安装下列服务，不依赖 Work IQ：

| 连接器 | 内部 MCP | 申请的委托权限 |
| --- | --- | --- |
| Outlook 邮件 | `outlook-mail` | `User.Read`, `Mail.Read`; 草稿与发送另外需要 `Mail.ReadWrite`, `Mail.Send` |
| Outlook 日历 | `outlook-calendar` | `User.Read`, `Calendars.Read`; 创建事件需要 `Calendars.ReadWrite` |
| Microsoft 联系人 | `microsoft-contacts` | `User.Read`, `Contacts.Read` |
| OneDrive 文件 | `onedrive` | `User.Read`, `Files.Read` |
| Microsoft Teams 频道 | `microsoft-teams` | `User.Read`, `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All` |
| SharePoint 网站 | `sharepoint` | `User.Read`, `Sites.Read.All` |

所有服务请求 `offline_access`。**六张卡片不等于自动完成六次授权。** 每个服务都有独立 MCP 进程、工具集、委托同意和 Windows DPAPI 加密的 `~/.dsh/microsoft-personal/refresh-<service>.dpapi`。各服务仅共享 `client.json` 中的公开 client ID，不共享 token。

**真实授权，没有伪造的 OAuth 窗口：**

1. 在 [Microsoft Entra](https://entra.microsoft.com/) 注册公共客户端应用，选定个人账户、组织账户或两者，允许设备代码流程并配置服务需要的委托权限。
2. 在 Phoenix 安装相应卡片，或告诉 Kira“连接 Outlook 邮件”“连接 Outlook 日历”“连接 OneDrive”等；`connector_install` 为这些 MCP 提供独立入口。
3. 如缺少公开 client ID，Kira 请求该 ID，调用 `microsoft_setup`，然后在**对应服务的 MCP** 中调用 `microsoft_login_start` 获取 Microsoft 官方链接及临时代码。
4. 用户在 Microsoft 网站输入代码并同意权限；Kira 遵守 `retryAfterSeconds` 调用 `microsoft_login_complete`，最后通过 `microsoft_profile` 验证。密码从不传入聊天。
5. 每个新服务都需要单独同意。授权 Outlook 邮件不等于 Outlook 日历也已连接。`microsoft_status` 只能说明本地存储的认证状态，不能单独证明 Graph 当前访问成功。

个人或企业兼容服务采用 Microsoft `common` 授权域；**Teams 和 SharePoint** 使用 `organizations`，不能用个人 Outlook.com 免费账户接入，企业管理员可能需要额外批准。Teams 只读取团队、频道和频道消息，不读取私聊或通话；SharePoint 只搜索网站并列出文档库；OneDrive 只列举文件夹和文件，均不承诺文档编辑。

旧版 `microsoft-personal` 保持兼容，但其授权不会自动解锁六个新服务。该套件属于 Phoenix 的通用能力，不是特定模型模式。

**测试：** `node --test scripts/phoenix-microsoft-personal-mcp.test.mjs scripts/phoenix-microsoft-scoped-mcp.test.mjs`。自动测试不能代替 Windows 上真实 Microsoft 账号的端到端授权；真实账号 token 不会出现在 GitHub CI 中。
