# @phoenix-ai/dsh-tool-sports

## Provider access

Read-only sports tools return sourced results and declarative inline chat cards without introducing a new navigation menu. ESPN Site/Core and MLB Stats are read-only public endpoints and need no API key; explicit PHOENIX_SPORTS_ESPN_DISABLED=1 and PHOENIX_SPORTS_MLB_DISABLED=1 switches disable them. A paid odds key remains optional for extended bookmaker feeds. Public endpoints do not grant media or redistribution rights. No bets are placed and no winners are guaranteed. See [README.md](README.md) for details.

## Model Experience

### 有来源的体育赛事发现与卡片

#### What the model sees

体育工具按请求返回标注来源的赛程、球队、球员和报价；未获得的数据不伪造。卡片必须由模型在同一对话中生成，工具调用本身不会强制显示卡片。

#### Token effect

仅按需查询联赛和赛事资料，不在每次对话中注入实时体育目录。未变化的请求不应反复查询。

#### KV Cache effect

工具 schema 保持稳定；变化的赔率与比分仅作为当次工具输出追加，以维持可复用的提示词前缀。

## Known Limitations and Deferred Work

- ESPN 非官方端点可能变化，数据与媒体使用权需要核查。
- 未经验证的预测不构成获胜保证；本工具不会下注，所有模拟投注仅供分析。
- 完整跨赛事比较和所有球员数据仍依赖来源可用性；必须完成真实环境验证和客户端快照测试。
