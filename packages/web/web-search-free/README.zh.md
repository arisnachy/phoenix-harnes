# @phoenix-ai/dsh-web-search-free

[English](README.md) | 中文

PHOENIX 的无密钥搜索提供程序。按顺序查询 Bing HTML 和 DuckDuckGo HTML，规范化来源并遵守 `maxResults`。它用于主提供程序因配额、余额、速率限制、认证、超时或不可用而失败时的显式回退。

不存储凭据，也不会把反机器人页面当作引用。

## Model Experience

### Conversation tool result, indirectly

#### What the model sees

通过 [`dsh-tool-web`](../tool-web/README.zh.md)，模型会在稳定的 `web_search` 契约下收到受 `maxResults` 限制的 URL、标题和规范化摘要；Bing 或 DuckDuckGo 的失败不会暴露凭据或原始 HTML。

#### Token effect

规范化结果和引用会在加入历史记录时消耗上下文令牌。

#### KV Cache effect

结果会向上下文追加后缀；未改变的前缀仍可复用缓存。

## Known Limitations and Deferred Work

- 公共 HTML 搜索可能返回 CAPTCHA、地区化结果或变化的标记；提供程序会尝试下一个引擎并有界失败。
- 它不替代有可用性保证的 API，也不提供 JavaScript 导航；独立的 Chrome 提供程序可以补足这一能力。
- 使用返回内容作为证据前必须核验页面。
