# @phoenix-ai/dsh-tool-sports

[English](README.md) | 中文

Kira 的原生只读体育工具包括 `sports_chat_catalog`、`sports_chat_discover`、`sports_chat_games`、`sports_chat_mlb_pitchers`、`sports_chat_odds` 和 `sports_chat_ticket`。这些工具在现有聊天中返回有来源的赛事数据和声明式卡片，不增加新的导航菜单。

## 数据源访问

ESPN Site/Core 和 MLB Stats 是无需密钥的公开只读接口；公开访问不代表获得数据或图片转载许可。运营者可使用 `PHOENIX_SPORTS_ESPN_DISABLED=1` 或 `PHOENIX_SPORTS_MLB_DISABLED=1` 停用相应数据源。`THE_ODDS_API_KEY` 是用于获授权的商业赔率数据的可选密钥。没有该密钥时，仅呈现 ESPN 实际提供的报价；缺失的价格和盘口不会被虚构。`PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1` 须先经过媒体使用权审核。密钥保存在主机环境中，工具不会输出密钥；请求仅发往固定的可信域名。

## Model Experience

### Verified sports fixtures and inline cards

#### What the model sees

Kira 从 `sports_chat_games` 获取有来源的赛事数据和声明式 `sports_game_card`，其中包含本地时间、球队、数据源以及仅在已核实时提供的首发投手、阵容和牛棚信息。`sports_chat_odds` 可以提供真实盘口，`sports_chat_ticket` 只进行票据模拟。

#### Token effect

每次请求仅将有限数量、有明确来源的赛事字段与卡片内容加入模型上下文；缺失的球员统计和赔率仍保持缺失，不会填入虚构数值。

#### KV Cache effect

实时赛事与赔率随请求而变化，因此工具返回内容可能改变上下文前缀并降低 KV 缓存的复用率；稳定的工具结构和静态指令仍可缓存。

## Known Limitations and Deferred Work

- ESPN 公开接口并非正式承诺的稳定服务，可能变更或中断；数据条款和图片再分发权限须单独核实。
- 所谓热门球队只是按已公布战绩推导的描述性趋势，既不是经过校准的胜率，也不保证胜出。
- 只有数据源确实提供的庄家赔率才可显示；系统不执行真实下注，也不支持直接交易。
- 助手必须在消息中输出有效的声明式 UI 卡片；单独获取工具结果不能保证卡片自动渲染。
- 某些项目没有逐球员比较、确认的首发阵容或牛棚数据；这些字段必须明确显示为不可用。
## 每日 4–6 组盘口研究清单

当用户请求当天彩票时，Kira 默认寻找五组**研究候选**（范围四到六），覆盖当天有赛程的 NBA、WNBA、MLB、NHL、NFL 和足球。 `sports_chat_daily_scan` 最多检索 36 场已验证的未来比赛。 `sports_chat_daily_market_shortlist` 使用获授权供应商的胜负、让分和大小分报价，核对联赛、双方球队、开赛时间、博彩公司与盘口线，拒绝过时或不完整报价，且不混合不同博彩公司。 `sports_chat_ticket` 现在支持查询六个运动键和多个基础盘口类型。

该清单**不是经过训练的预测或最终投注建议**：`marketNoVigShare` 只来自博彩公司的价格。Kira 还须核实官方伤病与首发资料、球员和对手表现、新闻、赛场背景及具体结算规则。球员特殊盘口、特定时段盘口和基础扫描外的全球足球仍需单独授权接入。若没有至少四组足够证据支撑的候选，系统会说明缺失，不编造赔率或保证中奖。工具不会自动下注。
