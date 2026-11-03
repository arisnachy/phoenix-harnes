# Business Mission：可验证的意图与连接器

[Español](phoenix-business-intent-routing.md) | 中文

**范围：** 商业任务规划，不会发布或花费资金。目前位于开发分支，不代表已完成生产环境集成。

## 启动

```powershell
pnpm business:mission intent --request "Kira, crea un SaaS de reservas"
pnpm business:mission plan --request "Investiga y crea un curso y publícalo en Shopify"
pnpm business:mission plan --request "Crea una novela y publícala en Amazon KDP" --inventory mcp-snapshot.json
pnpm test:business:mission
```

MCP 目录取自 Host 的 `pluginInventory.mcpConnectorHubState` 返回值，且必须**先去除敏感信息**：

```json
{"runtime":[{"serverName":"shopify","status":"ready","toolNames":["mcp__shopify__create_product"]}]}
```

示例目录**不能证明** Shopify 已连接，也不能保证该工具的 schema 能正常运行。规划器仅返回分类和工具候选项，**不会调用它们**。

## 故障与恢复策略

- 区分任务意图：`opportunity`（机会研究）、`create`（创建）、`validate`（验证）、`package`（打包）、`publish`（发布）、`market`（推广）、`analytics`（数据分析）。
- 识别商品类别：`book`、`course`、`software`、`game`、`design`、`research`、`video`、`audio`、`service`。
- 用户同时请求互不相容的领域或多个明确平台时，Kira 必须先解决歧义，不得误向商店提交。
- 执行前重新查询 Host：`ready` 是候选条件，`auth-required` 表明需要 OAuth；任何调用前都必须检查 schema 和权限。不能仅凭名称相似就信任连接器。
- `minibrowser-candidate` 仅表示可能需要检查浏览器可用性、登录状态与店铺规则；**不**表示已经填写或提交表单。
- `business:commerce` 队列对草稿采用幂等设计，**不会向外部提交**。正式发布仍需真实 API 调用、授权、收据、安全重试、对账与目标确认。
- 连接器失败时保留商品及其证据。重新执行发布前必须检查远程状态，避免重复发布。
- 不能保证所有操作都成功：外部错误、会话失效或平台政策变化可能需要恢复步骤或人工介入。

## 测试与限制

规划器包含 23 个自动化测试用例：九类商品、西班牙语识别、命令与疑问的区别、否定指令、MCP 路由、授权状态、不安全工具、敏感属性注入，以及拒绝目录文件的符号链接。`pnpm test:business` 目前包含这些测试。连接器不会自行安装或获得授权；与 UME、内嵌浏览器、真实端点和 Windows/CI 部署之间的自动集成仍需验证。
