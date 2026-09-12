# @phoenix-ai/dsh-cognitive-runtime

[English](README.md) | 中文

`@phoenix-ai/dsh-cognitive-runtime` 为每个活动会话派生有界的进程内认知投影。原始会话事件日志仍是规范来源，[`@phoenix-ai/dsh-session-learning`](../session-learning/README.zh.md) 仍拥有认知记录；本包消费该日志，而不是创建第二个记忆权威。它扩展了现有的[认知记忆层决策](../../../.agents/notes/implemented/architecture/2026-09-01-cognitive-memory-layers.zh.md)。

## 组合

```yaml
- id: cognitive-runtime
  name: '@phoenix-ai/dsh-cognitive-runtime'
  config:
    maxCandidates: 64
    activeLimit: 8
    backgroundLimit: 16
    weights:
      importance: 1
      confidence: 1
      recency: 1
      urgency: 1
      goalRelevance: 1
      novelty: 1
```

服务需要 `sessions` 和 `learningMemory`，提供 `ctx.cognitiveRuntime`，在启动期间重建已有活动会话，并在持久会话事件之后刷新。它忽略 `assistant/chunk` 和标记为 `ignorable` 的事件，因此流式输出不会反复改变投影。会话释放后，该会话的进程内状态会被移除。

## 认知投影

每个快照包含准确的 `SessionId`、所表示的最高事件序号、候选数量、可选的项目来源，以及四个工作记忆分区：`focus`、`active`、`background` 和 `suppressed`。注意力分数结合日志记录的重要性、置信度、持久化时间戳的新近度、待处理或错误工作的紧迫性、任务或前瞻工作的相关性，以及观测频率的倒数。相同分数使用事件序号和代码点顺序打破平局，因此相同输入会产生相同排名。

`maxCandidates` 接受 1–128 条记录，默认值为 64。`activeLimit` 和 `backgroundLimit` 接受 0–128 条记录，默认值分别为 8 和 16。每个注意力权重都必须是有限的非负数；基础组合将所有权重设为 1。`suppressed` 表示候选超出配置的记忆预算；它不是安全抑制、权限拒绝或策略决策。

该投影不宣称具有意识、感知能力、与人等同，或具有人类式主观体验。它为后续消费者提供可检查的状态模型，同时将目标、权限、审批、凭据、工具、提示和 agent-loop 控制留给现有所有者。

## 失败和持久化行为

服务只读访问规范日志和认知日志。它的快照仅存在于进程内，重启后从持久化记录重建；快照本身不是第二个持久化存储。刷新失败时会保留上一次成功状态并记录失败。没有记录的活动会话会得到 `observedSeq: -1` 的空快照；缺失或已释放的会话不返回状态。

所有排名输入都来自持久化记录。服务不读取墙上时钟、不使用随机数、不调用 LLM，也不创建新的持久事件类型，因此重放相同日志会产生相同投影。

## 模型体验

### 进程内认知状态

#### 模型看到的内容

没有模型会直接看到本包的内容。本包不提供提示文本、模型请求字段、工具 schema、权限、审批或目标变更。未来消费者可以把 `ctx.cognitiveRuntime.get(sessionId)` 作为不可信的进程内证据读取，但本包不决定是否将证据展示给模型，也不使用证据授权操作。

#### Token 影响

无；运行时不会将状态附加到模型请求。

#### KV Cache 影响

无；运行时不会组装或发送提供方请求。

## 已知限制和后续工作

- 投影只排列 `session-learning` 已生成的记录，不推断新的语义记忆、不学习技能、不运行实验，也不替代规范事件日志。
- 注意力是确定性的日志排序，不是基于向量的排序，也不等同于人类认知。未来消费者可以增加更丰富的信号，但不会把持久记忆或权限的所有权移入本包。
- 状态不会独立持久化，目前也不是模型上下文或浏览器面板消费者。这些界面需要各自明确的契约、会话事件和安全评审。
