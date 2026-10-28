# PHOENIX Trading Cloud — PAPER 研究执行器

[English](README.md) | 中文

独立运行，不依赖 LLM 或本地 Windows。**仅限 PAPER 模拟交易**：绝不提交真实 Binance 订单，也不访问私人账户余额。此项目刻意放在 pnpm monorepo 工作区之外，避免构建时意外变成生产实盘交易代理。

## 当前范围
- 从 Binance 公共市场数据接口发现最多 300 个流动性较好的**活跃 Spot USDT 市场**。
- 按流动性筛选（24 小时计价成交量 >=500 万 USDT），排除杠杆代币，每分钟轮询分析 4 个市场（300 个约需 75 分钟完成一轮）。
- 四种确定性策略假设：Donchian 突破、EMA 趋势回撤、结合 RSI 的布林带式统计均值回归、成交量确认的动量延续。
- PAPER 虚拟成交计入手续费和不利滑点模拟，单仓上限为 5%，总敞口上限 20%，同时最多持有 2 个仓位。
- 基于 ATR 的止损、分批 TP1、最终 TP2；定期按市价估值、累计熔断、不可重复的交易日志 ID、数据库乐观锁保护。
- 可通过游标分页的 D1 持久事件日志，以及在重新连接后向 Kira 重放未读云端提醒的 PHOENIX Host 桥接器。事件本身**并不是**在云端运行的 Kira：电脑关机时本地代理不会唤醒。
- src/research.mjs 提供保守的下一根 K 线回测和训练集/留出集试验（不在免费层约 10ms CPU 的 Cron 中运行，也不据此宣称能够盈利）。
- 不承诺盈利；没有证据证明长期有效的历史超额收益或实盘交易执行。

## 前提条件 / 授权
需要已经获授权管理 Workers/D1 的 Cloudflare 账户、部署权限，以及由所有者设定的至少 32 字符 ADMIN_TOKEN，并通过 Cloudflare Secrets 保存。Phoenix 的托管目录中有 Cloudflare MCP 端点，但目录中存在该端点不意味着用户已完成 OAuth 授权或服务商允许创建资源。

**不要默认启用 Worker 交易。** D1 初始状态为停用，只能通过经过身份验证的控制调用启动。不支持无人值守的真实资金订单。

## 配置指南（必须先取得明确的基础设施授权）
1. 使用已授权的 Cloudflare 工作流创建名为 phoenix-trading-paper 的 D1 数据库。
2. 将 wrangler.toml 中的占位 D1 ID 替换为经服务商核实的资源 ID。
3. 使用 Wrangler 应用迁移：npx wrangler d1 migrations apply phoenix-trading-paper --remote。
4. 通过 Cloudflare 密钥管理设置管理员密钥，**不要**提交到仓库：npx wrangler secret put ADMIN_TOKEN。
5. 使用 npx wrangler deploy 部署 Worker。验证 /health，随后使用令牌读取 /snapshot（绝不记录 Bearer 令牌）。
6. 至少运行一次测试 Cron，验证版本号变化，且 /snapshot 显示最近一次成功扫描。
7. 在 PHOENIX Host 中配置 PHOENIX_TRADING_CLOUD_URL，并在 Host 凭证库保存 PHOENIX_TRADING_CLOUD_ADMIN_TOKEN。绝不将密钥放入 Git 仓库或提示词。URL 必须使用专用 .workers.dev HTTPS 主机名。
8. Host 配置并验证服务后，Kira 可使用 binance_cloud_status 和 binance_cloud_control。本地 Host 轮询将积压的云端 PAPER 事件转发至已有唤醒规则，无需每分钟调用 LLM。
9. 用有效的 Bearer 令牌向 POST /admin/control 发送 {"action":"start"} 启动 PAPER，并确认持久状态。云端服务与本地 PAPER 是两个独立的虚拟投资组合。停止使用 action=stop。

不要自动购买收费资源或录入付款信息；权限不足时应明确返回需要配置的结果。Cloudflare Workers 免费层对每次触发的 CPU 时间和子请求数量有严格限制。该任务故意每分钟最多分析 4 个市场，可能需要进一步减少负载或转移到虚拟机；依赖全天候运行之前必须实测 CPU 使用量。

## 接口
- GET /health — 最小公共可达性检查，不证明交易机器人正在运行
- GET /snapshot — 私有的、经身份验证的 PAPER 账户日志与状态
- GET /events?after=SEQ — 私有的、经身份验证的追加式 D1 事件日志，每页 100 条，包含 nextCursor
- POST /admin/control — 私有的、经身份验证的启动/停止接口

Bearer 令牌是管理员密钥：若泄露应轮换；绝不放在聊天、URL 或源代码中。

## 边界与后续工作
这**不是**使用真实资金的自主交易。实现之前必须具备服务商允许的无人值守执行接口、经过验证的下单权限、交易所过滤规则/精度、订单幂等性及对账、风险测试、基础设施故障切换、用户明确同意和真实订单回执。官方 Binance Agentic MCP 可能要求逐单交互确认，不得绕过。

若要在 Windows 关机时让 Kira 进行推理，须部署独立认证的云端代理运行时或独立通知服务。仅有 Host 桥接器并不意味着远程 Kira 正在运行。未经显式迁移及对账，不要将本地 PAPER 与云端 PAPER 日志显示为同一个投资组合。

可使用 node --test services/phoenix-trading-cloud/test/*.test.mjs 在本地运行确定性测试。
