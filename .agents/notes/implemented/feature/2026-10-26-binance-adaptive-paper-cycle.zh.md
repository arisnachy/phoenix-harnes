# Agent Note: Binance 自适应模拟策略选择

Status: implemented

## Problem

Binance 集成已有公开 K 线、虚拟账本及需要批准的官方 Agent OS 连接器。过去若要为多种资产选择策略，每次运行都需要语言模型决策，且缺乏有上限的确定性组合分配器。

## Decision

HARDNESS Binance 适配器提供 `binance_adaptive_cycle`，一次最多处理五个 USDT Spot 交易对。工具根据已收盘、按时间排序且及时的 K 线，对突破、趋势回调、均值回归、防御退出或不交易的信号进行排序。选择 `scan` 时仅报告评估；选择 `paper-step` 时最多执行一笔虚拟订单，优先处理防御退出。新仓位不超过虚拟权益的 5%，总敞口不超过 20%，同时最多持有两种资产；峰值回撤达到 5% 后拒绝新建仓。模拟成交在现有日志中记录策略标识。

策略计算在 Host 内完成，不需要每根 K 线调用 LLM；公共市场请求有上限，返回摘要而非原始 OHLCV 数组。同一 broker 的计算周期串行化，以免并行虚拟分配互相冲突。

Host 工作进程只进行虚拟交易。聊天内面板无需模型调用即可读取 PAPER 账户快照，也能通过同源且只接受 POST 的端点处理用户明确点击的开始、停止和立即检查操作。端点拒绝不匹配的 Origin、过大或无效 JSON，以及 REAL 参数。执行路径不访问 Binance Agent OS，也不授权真实订单。正式账户操作继续要求用户明确批准、OAuth 范围和 Binance 下单确认。

## Alternatives considered

**让 LLM 逐一评估每个交易对和 K 线。** 这种方式持续消耗模型 token，且结果难以复现，无法适用于确定性风险限制。

**由新策略扫描器自动真实下单。** 虚拟策略评分尚非经过生产环境验证的优势，且官方 Agent OS 要求资金操作由用户确认。

**让 LLM 持续保持活动以轮询行情。** 这种方式的 token 用量会随轮询次数增长。改为由 Host 拥有的 PAPER 工作进程持久保存用户的明确启用选择，按配置周期进行检查，连续错误时停止，并通过只读聊天面板展示结果。

## 官方 MCP 和测试环境的区别

Binance Agentic MCP 使用官方 OAuth Streamable HTTP 地址
https://agent.binance.com/mcp/agentic。安装成功不代表同步了工具或取得 Trade
权限，也不证明账户符合条件、余额充足。每笔真实 Agentic 订单仍需用户确认，
Agentic 子账户必须由用户自行在 Binance 中转入资金。Phoenix 提供显式的
重连与修复，同时保留 Host 持有的独立 OAuth 授权记录。

Binance Spot Testnet 是另一个仅使用模拟资金的环境。它使用 Host 独立保存
的测试 API 密钥和固定签名地址 https://testnet.binance.vision，并不使用
Agentic MCP。测试订单要求用户明确提出、通过 Phoenix 单次批准，并受到
金额上限限制。Kira 在启用前会询问 Testing 或 Real，再区分 PAPER 与
Spot Testnet。

## Consequences

Phoenix 可使用确定性计算检查小型关注列表，并在无需每根 K 线消耗模型 token 的情况下执行可复现的虚拟操作。分数是启发式排序，并非经过校准的盈利概率。broker 采用既有的 Spot 模拟成交与手续费模型；滑点、交易所过滤规则、汇率约束、组合相关性、全面策略学习、Settings 控制、Testnet 和自主真实交易仍需独立实现。PAPER 重复周期由用户明确启用后的 Host 工作进程驱动；真实账户操作仍不在此工作进程内。
