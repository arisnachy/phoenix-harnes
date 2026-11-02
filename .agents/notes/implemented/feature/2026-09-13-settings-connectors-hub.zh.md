# Agent Note: Settings connectors hub

Status: implemented

[English](2026-09-13-settings-connectors-hub.md) | 中文

## Problem

外部账户和连接器遥测此前显示在 Models 设置页中，但 Gmail、Google Workspace、GitHub、MCP 服务器、协作工具、存储、数据库和金融集成都不是模型提供商配置。Phoenix 已经拥有实现真实连接状态所需的运行时权威：授权流程负责人工登录，`mcp-client` 将真实工具注册到 `ctx.tools`，`mcpConnectors` 发布不含秘密的实时 MCP 状态。缺少的是独立的浏览器界面和可发现目录。

## Decision

Models/Connectors 客户端插件注册第二个 `settings.section`：`connectors`，排序位于 Models 之后、Plugins 之前。旧的嵌入式 `AuthorizationPanel` 不再渲染，因此账户连接不会继续重复出现在 Models 中；模型提供商编辑器内部的专用 OAuth 控件保持不变。

Settings → Connectors 在不改变运行时权限的前提下合并三类信息：

1. 已注册授权流程提供真实的连接、重新连接、断开连接操作和账户遥测。
2. 实时连接器遥测提供真实的 installed/callable 状态和提供商管理链接。
3. 不含秘密的目录描述 Phoenix 可支持的集成和原生能力预设。没有注册适配器的目录项明确显示为未安装、需要 API Key/适配器或 MCP-ready；仅仅出现在目录中绝不会被标记为已连接。

目录包含 Google Workspace、Microsoft 365、Box/Dropbox/Notion、Slack/Teams/Zoom、GitHub/Linear/Jira/Vercel/Firebase、Supabase/Neon/MongoDB/Snowflake/BigQuery/PostHog、Hugging Face/OpenAI Platform、Canva/Figma/HeyGen/Magnific、Coursera/Devpost、CRM/销售服务，以及 Binance、Stripe、Plaid、QuickBooks 等金融服务。原生预设覆盖 Default、Development、Security / Codex Security、Data Analytics、Cloud & Data、Documents、PDF、Presentations、Meetings、Finance、Research & AI 和 AI & Media。

浏览器目录不包含凭据。OAuth 秘密仍由 Host 的 credential/authorization 服务持有。远程品牌图标只属于展示元数据。运行时工具可用性仍是权威事实：只有适配器真正注册工具后，Phoenix 才能调用连接器。因此现有 MCP 工具注册以及 HARDNESS/工具索引继续定义模型实际可以使用的能力。

## Alternatives considered

**继续把连接放在 Models 中。** 被拒绝，因为外部服务不是模型提供商，把两者混在一起会模糊“选择模型”和“授权能力”之间的区别。

**构建第二套 MCP/连接器运行时。** 被拒绝，因为 Phoenix 已经具备授权、MCP 工具注册、连接器遥测和能力索引。平行运行时会复制状态，并产生 UI 与模型真实可调用能力不一致的风险。

**把每个目录卡片都视为立即可用。** 被拒绝，因为那会让展示元数据冒充运行时能力。没有工作适配器的卡片继续明确显示为未配置，并且不会仅因存在于目录中就成为可调用工具。

**只发布较小的独立 superpower 目录。** 被拒绝，因为只有描述性元数据并不能把用户连接到实时 OAuth/MCP 状态，也不能提供独立的 Settings 界面。它有价值的 preset 思路被合并到这个 hub 中，而不是创建第二个目录权威来源。

## Consequences

Settings 现在清晰区分模型提供商和服务连接器，同时保留既有 OAuth 与 MCP 的所有权边界。目录可以继续扩展，而不假装每个列出的集成都自带适配器；未来提供商包只需注册授权和遥测，即可在此页面变为可操作，无需把凭据处理逻辑加入客户端。代价是部分目录项会有意保持为设置目标，直到适配器真正安装；这让能力状态更保守，但也更真实。
