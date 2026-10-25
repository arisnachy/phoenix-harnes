# Phoenix 中的 Meta：DevTools、Facebook、Instagram 与 WhatsApp Business

[English](meta-mcp.md) | 中文

本文件区分 **Meta 官方集成**，避免将开发者应用与 Facebook 主页、Instagram 账号或 WhatsApp 号码混淆。**安装连接器不意味着所有操作免费，也不会自动授予权限。** 切勿在聊天中粘贴令牌。

## 1. Meta Social Technologies / Developer Tools MCP

- 来源：[Meta 官方文档](https://developers.facebook.com/documentation/mcp/devtools-mcp) 与 [Meta Agentic Tools 官方仓库](https://github.com/facebook/agentic-tools)。
- 远程服务器：`https://mcp.facebook.com/devtools`。
- Phoenix → **设置 → 连接器 → Meta Social Technologies (DevTools) → 安装**。
- Phoenix MCP 身份：`meta-devtools`；流程为 `mcp-client/meta-devtools`。
- 认证：Meta Developer OAuth，授权访问用户拥有或管理的应用。
- Kira 可执行：查看应用清单、App Review、权限、API 配额、合规信息、API 更新、检查和管理 webhook。
- **它不是** Facebook Pages、Instagram Feed、Messenger 或 WhatsApp Business 的发布 API。发布功能需要以各产品的凭证和权限连接 Graph API 或 WhatsApp Business 专用 MCP。

授权后的安全测试包括列出自己拥有的应用、读取 API 用量或当前 webhook 订阅。未获许可不得修改 webhook。

## 2. WhatsApp Business Tools MCP

- 官方远程服务器：`https://mcp.facebook.com/whatsapp_business_tools`。
- Phoenix → **设置 → 连接器 → WhatsApp Business Tools (Meta) → 安装**。
- Phoenix MCP 身份：`meta-whatsapp-business`；流程为 `mcp-client/meta-whatsapp-business`。
- 必须拥有或管理 Meta 商业账户／资产组合，以及已启用 WhatsApp Business 且由用户管理的 Meta 应用；还须接受 **WhatsApp Business Platform / Cloud API** 条款并批准 Meta OAuth。这不代表能够访问个人 WhatsApp 或手机应用。
- Kira 可读取企业、账户和 WhatsApp 号码，检查或配置模板及 webhook，准备号码接入和客服任务。实际发送仍须遵守 Meta 权限和要求。
- 首次**无写入、无费用**测试：列出获授权企业，例如服务器确实提供的 `whatsapp_biz_businesses` 工具。
- 不得虚构工具名称或假定可用；必须检查真实 MCP 清单、`ready` 状态和 `toolNames`。

### 费用与批准规则

**使用 MCP 或查询账户不意味着所有消息免费。** WhatsApp Business Platform 的 Meta 费用取决于消息类型、目的地、服务窗口及数量。依据 2026 年 10 月的政策，每个号码每月最多可有 1,000 条免费服务消息；营销、认证或实用模板消息可能收费。发送前必须检查 [WhatsApp Business Platform Pricing](https://developers.facebook.com/docs/whatsapp/pricing) 的最新官方价格。

**Kira 必须遵守：** 未获用户明确批准，不得代为发送消息、开展营销活动、修改支付信息、注册号码或修改 webhook。每次发送前展示收件人、内容、消息类型和费用风险，等待批准。无法确认免费时视为可能产生费用；不得自动群发。

## 3. Facebook 与 Instagram：官方 API

Meta DevTools 服务**本身不能**进行主页或个人资料的有机运营。要让 Kira 管理用户资产：

- **Facebook Pages**：需要 Meta 应用、合适的主页角色与权限，如适用的 `pages_show_list`、`pages_read_engagement` 和 `pages_manage_posts`。发布和回复可能需要特定权限及 Meta 审核。
- **Instagram Professional**：需要 Business／Creator 专业账户以及针对读取、发布、评论或消息等用途的 Instagram API 权限。个人账户不能通过 Graph API 完整访问这些功能。
- **消息**：WhatsApp Business Cloud API 使用上文专用企业连接器；Messenger 与 Instagram Direct 有各自独立的权限和规则。
- **Facebook／Instagram 广告**：属于单独的付费功能，不会随这个免费连接器自动启用。

**Phoenix 状态：** 包含两个可选官方 MCP：DevTools 与 WhatsApp Business。本次变更**尚未实现**通过 Graph API 全面管理 Facebook Pages 和 Instagram 的有机运营，不得宣称或伪造发布结果。

## 4. 自定义 MCP 客户端的已知 OAuth 问题

Meta OAuth 可能要求 HTTPS 回调 URI；有些仅使用 `http://127.0.0.1` 的客户端无法完成同意流程。部分客户端也遇到 Meta 发布的 `issuer` 元数据不一致。**安装并不证明已授权或实际可用。** 不得隐藏错误，也不能降低 `issuer` 或 `state` 的验证要求。

安全诊断：
1. 检查 Host 是否注册了 `mcp-client/meta-devtools` 或 `mcp-client/meta-whatsapp-business`。
2. 启动 **授权** 并验证 Meta 是否提供且允许完成同意页面；不得编造登录 URL。
3. 只有 `runtime.status === 'ready'` 且具有真实工具时才显示为正常运行。若 Meta 拒绝回调，应显示阶段，说明自定义客户端兼容性限制，而不是标记授权完成。
4. 切勿分享令牌、应用密钥或完整 OAuth 返回数据。

Meta 对 Claude、Cursor、Codex 和 ChatGPT 的连接文档，并不能保证任意自定义 Host 都符合其 OAuth 要求。

## 5. 与 Phoenix Social Engine 协调

如果 Meta DevTools 在自定义 MCP 客户端无法认证，不要无限重试，也不要假定其 OAuth 可用于 Graph 发布。`meta-devtools` 精选卡片可以不查询 MCP Registry 就安装；真实 OAuth 会话是独立阶段，需要应用配置和用户同意。

创建 Phoenix 自己的社交账户时，应使用本地 MCP `social-engine` → `social_phoenix_onboarding`，配合浏览器打开官方 Facebook／Instagram 表单并接受人工验证。Developer App、Facebook 主页、Instagram 专业账户和 Graph 发布权限，必须在账号注册**以后**再确认。Facebook／Instagram 账户并不等于获授权的 Meta Developer 应用，反之亦然。

## 6. 使用保险库的 Meta Graph 发布器（不同于 DevTools）

精选连接器 **Meta Graph Publishing**（`meta-publishing`）使用 Phoenix 本地 MCP 和官方 Graph API；只在用户对 Facebook 主页或 Instagram Professional 拥有合法权限时才发布。它不再依赖公开 MCP Registry，也不使用 `meta-devtools` 的 OAuth。

在 **设置 → 连接器 → Meta Graph Publishing → 安装** 后，Phoenix 注册本地服务器。点击 **授权** 时，MCP 经原生安全凭证流程请求以下四个值。只能在 **Phoenix 授权对话框** 输入：

- `PHOENIX_SOCIAL_FACEBOOK_PAGE_ID`：获授权主页的数字 ID。
- `PHOENIX_SOCIAL_FACEBOOK_PAGE_TOKEN`：从 Meta 获取的 Page Access Token。
- `PHOENIX_SOCIAL_INSTAGRAM_USER_ID`：Instagram 专业用户的数字 ID。
- `PHOENIX_SOCIAL_INSTAGRAM_TOKEN`：具有 IG 发布权限的 Access Token。

Host 将值保存在凭证存储中，运行时通过 `envCredentialRefs` 注入私有 MCP 进程。`managed.patch.yml` 只保存引用而不是密钥值。权限缺失时 Graph 请求必须明显失败；没有真实发布 ID 或回执，Kira 不得声称已发布。

它**不会创建** Facebook／Instagram 账户，也不会自动授予 Meta 权限。Meta 应用、资产所有者、主页或专业账户、审核和人工验证仍然必要。有机发布权限不代表具有付费广告活动权限。
