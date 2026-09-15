# @phoenix-ai/dsh-session-learning

[English](README.md) | 中文

PHOENIX 的持久化认知记忆会观察每个持久会话事件。原始会话日志仍是自传式记忆的规范归档，旁边的脱敏认知 JSONL 索引提供工作、情景、语义、程序、前瞻、联想和时间层。

## 组合

```yaml
- id: session-learning
  name: '@phoenix-ai/dsh-session-learning'
  config:
    path: /absolute/path/to/learning-memory.jsonl
```

路径必须显式配置，因为记忆记录包含用户提供的文本。服务需要 `sessions`，暴露 `ctx.learningMemory`，并写入相邻的 `<path>.cognitive.jsonl` 日志。认知记录按来源事件去重，按主题巩固，并结合词法、实体、关系、项目、时间、重要性、置信度和频率排序。`forget()` 只追加可审计墓碑；自动上限不会删除规范记录。

## 安全和模型体验

该日志不会静默改变权限、凭据或可信插件。“this is important”“remember this”“always”“I prefer”等明确持久信号会自动提升为高置信度语义记忆；普通事件保持为较低置信度的自传式和情景历史。矛盾的语义值保留旧记录及其有效时间，新记录指向被替代值。摘要和内容有界，并在持久化前脱敏 bearer token、常见凭据赋值、URL 和电子邮件地址。认知搜索默认限制在当前项目；定向的自传式消费者必须显式启用 `includeCrossProject`，因此跨项目历史查询不会削弱普通项目隔离。

## 模型体验

### 持久化观察来源

#### 模型看到的内容

服务本身不会添加提示词或工具 schema。单独组合的记忆消费者可以调用 `searchCognitive()`、`recallCognitive()`、`timeline()`、`cognitiveForSession()` 和 `workingMemory()`。`searchCognitive()` 与 `recallCognitive()` 默认继承当前项目，只有调用方显式请求时才跨项目检索。`cognitiveForSession()` 是指定 `SessionId` 的只读活动记录投影，最多返回 128 条按持久化顺序排列的最新记录，不会修改规范会话日志或认知日志。消费者仍负责选择有界记录，并把它们呈现为不可信证据而不是指令。

#### Token 影响

观察器本身不增加 token；组合的记忆消费者只花费其选中的有界记录。

#### KV 缓存影响

日志本身不会改变模型请求；显式记忆读取会追加到下一次请求，因此从新的动态上下文后缀开始。

## 已知限制和后续工作

- 候选经验评判、技能综合、实验和浏览器记忆面板仍由后续消费者负责。
- 当前排序器是确定性的混合检索，不宣称等同于向量语义检索；未来可以在不替换规范日志或工具名称的情况下增加向量提供者。
