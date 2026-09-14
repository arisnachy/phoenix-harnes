# 设置连接器中心

## 状态

已实现。

## 背景

外部账户和连接器遥测此前显示在 Models 设置页中，但 Gmail、Google Workspace、GitHub、MCP 服务器、协作工具、存储、数据库和金融集成都不是模型提供商配置。Phoenix 已经拥有正确的运行时权威：授权流程负责人工登录，`mcp-client` 将真实工具注册到 `ctx.tools`，`mcpConnectors` 发布不含秘密的实时 MCP 状态。缺少的是独立的浏览器界面和可发现目录。

## 决策

Models/Connectors 客户端插件现在注册第二个 `settings.section`：`connectors`，排序位于 Models 之后、Plugins 之前。旧的嵌入式 `AuthorizationPanel` 不再渲染，因此账户连接不会继续重复出现在 Models 中；模型提供商编辑器内部的专用 OAuth 控件保持不变。

Settings → Connectors 在不改变运行时权限的前提下合并三类信息：

1. 已注册授权流程提供真实的连接、重新连接、断开连接操作和账户遥测。
2. 实时连接器遥测提供真实的 installed/callable 状态和提供商管理链接。
3. 不含秘密的目录描述 Phoenix 可支持的集成和原生能力预设。没有注册适配器的目录项明确显示为未安装或 MCP-ready；仅仅出现在目录中绝不会被标记为已连接。

目录包含 Google Workspace、Microsoft 365、Box/Dropbox/Notion、Slack/Teams/Zoom、GitHub/Linear/Jira/Vercel/Firebase、Supabase/Neon/MongoDB/Snowflake/BigQuery/PostHog、Hugging Face/OpenAI Platform、Canva/Figma/HeyGen/Magnific、Coursera/Devpost、CRM/销售服务，以及 Binance、Stripe、Plaid、QuickBooks 等金融服务。原生预设覆盖 Development、Security/Codex Security、Data Analytics、Documents、PDF、Presentations、Meetings、Finance 和 Research & AI。

## 安全与模型行为

浏览器目录不包含凭据。OAuth 秘密仍由 Host 的 credential/authorization 服务持有。远程品牌图标只属于展示元数据。运行时工具可用性不变：只有适配器真正注册工具后，Phoenix 模型才能调用连接器。因此现有 MCP 工具注册以及 HARDNESS/工具索引仍是模型实际能力的权威来源。

## 结果

Settings 现在清晰区分模型提供商和服务连接器。目录可以继续扩展，而不假装每个列出的集成都自带适配器。未来提供商包只需注册授权和遥测，即可自动在此页面变为可操作，无需把凭据处理逻辑加入客户端。
