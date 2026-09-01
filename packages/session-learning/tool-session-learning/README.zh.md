# @phoenix-ai/dsh-tool-session-learning

[English](README.md) | 中文

此包提供面向模型的 `memory_search` 和 `memory_remember` 工具，用于访问 PHOENIX 的持久化认知日志。搜索返回有界的层、稳定 ID、项目、实体、关系、来源 URI、时间坐标以及可解释的置信度和排序信号。自动上下文按项目隔离，并在注入前保护不可信文本中的提示变量分隔符。

## 组合

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

该工具需要 `tools`、`systemPrompt` 和 `learningMemory`。搜索是只读的；记忆操作不能修改提示词、权限、工具或凭据。搜索支持项目、层、时间窗口和已替代历史过滤。自动上下文最多包含八条当前项目的认知记录，并排除原始对话记录。

## 模型体验

### 显式记忆检索和学习

#### 模型看到的内容

`memory_search` 返回包含 `id`、`session_id`、`event_seq`、`kind`、`layers`、`project_id`、`entities`、`relations`、`source_uri`、`confidence`、`importance`、`frequency`、`score` 和 `reasons` 的有界 JSON。显式遗忘的记录不会返回。

##### 自动连续性上下文

```markdown
Each model assembly receives up to eight active project-scoped cognitive records as untrusted read-only evidence. Raw conversation records remain excluded from automatic injection; use memory_search with a project or time filter when the task requires them.
```

##### 显式学习记录

```markdown
memory_remember stores one bounded preference, lesson, or skill from the current session. The ledger applies the same provenance, retention, and credential-redaction rules used for automatic observations.
```

#### Token 影响

只有模型调用工具时才会增加 token；结果数量受配置上限限制。

#### KV 缓存影响

结果作为普通工具消息追加到当前请求之后，不会改写较早的对话历史。

## 已知限制和后续工作

- 经验评判、技能提升、记忆管理命令和浏览器记忆面板属于后续阶段。
- 检索是结合归一化词法、实体、关系、元数据和新近度的确定性混合检索；未来可以在不替换规范日志的情况下增加向量提供者。
