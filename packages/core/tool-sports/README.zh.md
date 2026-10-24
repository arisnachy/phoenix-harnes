# @phoenix-ai/dsh-tool-sports

[English](README.md) | 中文

Kira 的体育工具直接在现有对话中运行，不会创建独立菜单。模型可以查询只读公开比赛数据和可选的博彩公司数据，并返回经过验证的声明式聊天卡片。工具不会下注。

## 数据源访问

ESPN Site/Core 和 MLB Stats 在数据源允许并可用时可不使用商业密钥查询。运营者可使用 `PHOENIX_SPORTS_ESPN_DISABLED=1` 或 `PHOENIX_SPORTS_MLB_DISABLED=1` 禁用数据源。`THE_ODDS_API_KEY` 可扩展获授权的赔率覆盖范围；缺失的赔率绝不编造。启用图片须先审查权利并单独设置 `PHOENIX_SPORTS_ESPN_IMAGES_ALLOWED=1`。凭证仅保留在主机端，HTTPS 请求使用固定的主机白名单。

## 模型体验

### 体育上下文与聊天内渲染

#### 模型看到的内容

模型收到 `sports_chat_catalog`、`sports_chat_discover`、`sports_chat_games`、`sports_chat_mlb_pitchers`、`sports_chat_odds` 和 `sports_chat_ticket` 的结果。比赛数据包含来源、圣多明各当地时间及结构化的 `sports_game_card` 数据。投注单仅为模拟，不执行交易。Phoenix 从经过验证的工具结果直接在对话中渲染体育卡片，模型无需重复 JSON 或生成 `generative-ui` 代码块；模型只需用自然语言解释发现与来源。

#### Token 影响

安装时六个工具定义和简短路由说明会占用上下文 token。工具调用会向对话添加有限长度的 JSON 结果；`sports_chat_games` 一次最多提供六张即时卡片，并显示剩余数量。数据缺失时明确解释，不捏造统计数据或赔率。

#### KV 缓存影响

注册的工具定义和系统说明在会话中保持稳定；在提供方支持时可作为提示前缀缓存。比赛数据、动态赔率和模拟投注单是变化的工具结果，不应当作为静态 KV 缓存重复使用。

## 已知限制与待完成工作

- ESPN 公开接口可能变更，公开可访问不代表授予数据或媒体再分发权；运营者必须审查条款。
- 并非所有联赛或市场都有赛果或可验证的赔率，也未包含经过校准的预测模型。
- 客户端从工具结果提取经过验证的卡片数据；仍需端到端测试验证实际显示，并防止重复渲染。
- 模拟投注单不会真实下注，模拟前必须重新查询报价。
