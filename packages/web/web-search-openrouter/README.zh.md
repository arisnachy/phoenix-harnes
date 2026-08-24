# @deepseek-ai/dsh-web-search-openrouter

[English](README.md) | 中文

PHOENIX 的 OpenRouter `WebSearchProvider`。它使用当前的 `openrouter:web_search` 服务器工具发送一次 Chat Completions 请求，然后把 OpenRouter 标准化的 `url_citation` 注释映射为提供方无关的 `ctx.web` 结果。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | 与 OpenRouter 模型路由共享的凭据引用。 |
| `baseURL` | `https://openrouter.ai/api/v1` | API 基址；会追加 `/chat/completions`。 |
| `model` | `openrouter/auto` | 决定并执行服务器工具搜索的模型。 |

每次请求都会通过凭据服务解析密钥，因此在 **设置 → 模型** 中保存的密钥无需重启 PHOENIX 即可生效。密钥值不会出现在设置描述或搜索结果中。

## 模型体验

### 辅助 OpenRouter 请求

#### 模型所见内容

独立的 OpenRouter 模型通过 Chat Completions 接收搜索查询，并启用 `openrouter:web_search` 服务器工具。该请求不属于对话模型的上下文。

#### Token 影响

辅助请求会消耗 OpenRouter 模型 token，并可能产生提供方搜索费用。最终计费由提供方控制。

#### KV Cache 影响

该请求独立于对话缓存。相同查询、路由与服务器工具配置可能复用提供方缓存；其中任一项改变都会建立不同前缀。

### 对话工具结果（间接）

#### 模型所见内容

通过 `dsh-tool-web`，对话模型会在稳定的 `web_search` 约定下看到提供方生成的答案与去重 URL 引用。无效的引用 URL 会被省略。

#### Token 影响

工具结果追加后，规范化答案与引用元数据会消耗对话上下文 token。

#### KV Cache 影响

追加工具结果会扩展对话前缀。此前未改变的请求内容仍可复用提供方缓存，而不同答案或引用集合会改变后缀。

## 限制

- OpenRouter 网络搜索可能产生搜索费用和模型 token 费用。
- 上游服务器工具目前处于 beta。本包使用单元测试固定已记录的请求与标准化引用结构。
- 返回答案由提供方生成；调用方必须引用并评估映射后的来源。
