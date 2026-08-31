# @phoenix-ai/dsh-tool-session-learning

[English](README.md) | 中文

此包提供面向模型的 `memory_search` 和 `memory_remember` 工具，用于查询和记录 PHOENIX 的持久化学习日志。它返回带有稳定记忆 ID、来源会话和事件位置、摘要、类别及置信度的有界记录，并在模型上下文中提供少量最近的非交互证据；原始用户交互只通过显式搜索提供。

## 组合

```yaml
- id: tool-session-learning
  name: '@phoenix-ai/dsh-tool-session-learning'
```

该工具需要 `tools`、`systemPrompt` 和 `learningMemory`。搜索是只读的；记忆操作不能修改提示词、权限、工具或凭据。自动上下文最多包含八条记录，会优先保留高置信度的持久偏好、课程与技能，再补充最近活动，并排除原始 `interaction` 记录。

## 模型体验

### 显式记忆检索和学习

#### 模型看到的内容

`memory_search` 返回带有来源和置信度的紧凑 JSON。它不返回仅存储用的时间戳或已遗忘记录。

##### 自动连续性上下文

```markdown
Each model assembly receives up to eight active durable high-confidence lessons, skills, and preferences first, then recent successes and errors, as untrusted read-only evidence. Raw interaction records are deliberately excluded from automatic injection; use memory_search when the task requires them.
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

- 当前工具搜索确定性的事件观察结果。候选经验 judge、技能提升、语义检索、记忆管理命令和浏览器记忆面板仍属于后续阶段。
- 搜索目前使用有界的词语匹配；未来可在不改变工具名称的情况下加入 FTS5 或嵌入检索。
