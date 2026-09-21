# @phoenix-ai/dsh-quality-policy

[English](README.md) | 中文

这是一个低延迟的完成质量 guard。它不会自行调用模型、扫描文件系统或运行测试；它只观察 PHOENIX 已经在执行的工作：成功修改后使旧验证证据失效，只接受修改之后观察到的新证据，并利用现有的工具结果和轮次停止流程，避免模型把过期证据误当成完成证明。

正常路径不会增加模型轮次：第一次成功修改只把一条短的、带来源的上下文附加到本来就必须消费该工具结果的下一步。如果模型在停止前已经验证，guard 保持沉默。只有试图在仍然“脏”的状态下结束轮次时，才可能收到有上限的纠正 steer。

## 配置

~~~yaml
- id: quality-policy
  name: '@phoenix-ai/dsh-quality-policy'
  config:
    maxStopNudges: 1
~~~

maxStopNudges 是延迟预算，不是质量评分。0 关闭停止纠正；有效范围是 0 到 3。每个直接用户提示都会开启新的任务级账本。每次成功修改都会增加内部 generation；成功验证只让当前 generation 变为新鲜，之后任何修改都会立即使它失效。因此不会无意义地重复测试，也不会在产物变化后错误复用旧证据。

## 活动分类

guard 只根据工具名称和 JSON 参数在本地分类。原生文件修改工具，例如 write、edit、str_replace_editor，以及常见 create/update/delete/move/upload/deploy 名称，算作修改。Shell、PowerShell 和 Code 调用使用有界命令模式分类：常见 test/build/lint/typecheck 命令算作验证，常见文件系统、包管理和 git 修改命令算作修改。read/search/fetch/screenshot 算作检查。

产物领域根据触碰的路径推断为 code、web、docs、data、config 或 generic。code、web 和 config 需要自动化证据；docs、data 和 generic 可以由检查满足。策略刻意保持保守和便宜：它不会为了分类而解析源码树或启动另一个评审模型。

## 证据与延迟行为

- 验证新鲜度，而不是重复。验证在下一次成功修改之前一直有效；策略不会要求对完全未变化的状态重复运行。
- 便宜检查优先。提醒优先使用确定性检查，再考虑 LLM judge，并鼓励一个聚焦、高信号的命令而非重复整套测试。
- 能并行就并行。独立检查应合并到一个命令或并发执行。
- 真实边界。领域提示优先真实 build/start/render/read-back 入口，而不是只测内部 helper。
- 有界纠正。一次直接用户任务最多收到 maxStopNudges 个纠正步骤；默认一个。新的直接用户提示会重置预算。
- 不假装副作用回滚。成功修改即使随后被 post-execute 策略阻止展示，也仍然保持“脏”，因为工具副作用不会回滚。
- 并发下的新鲜度正确。并行调用按实际完成顺序记录：先完成的验证不能证明之后才完成的修改；之后完成的验证可以。

## 模型体验

### 修改后的上下文

#### 模型看到的内容

第一次成功修改使此前的新鲜证据失效时，会把下面这条带来源 notice 附加到本来就会跟随该工具结果的下一次请求。证据已经失效期间继续修改，不会重复追加 notice。

##### 新鲜度 notice

```markdown
Fresh verification evidence is now stale because the artifact changed. <domain-specific hint> Reuse still-fresh evidence for unchanged inputs, choose cheap deterministic checks before a model judge, and batch independent checks in one command or run them in parallel when possible.
```

#### Token 影响

修改前为零 token。只有从“新鲜”变为“脏”的一次转换会追加一条有界 notice，并保留在该 session 历史中；持续处于脏状态的后续修改不会增加 notice。

#### KV Cache 影响

内容只追加在已经可缓存的请求前缀之后。它不改变稳定 system prompt 或工具 schema，因此既有前缀缓存仍可复用。

### 轮次停止纠正

#### 模型看到的内容

如果轮次准备结束，但成功修改比已接受证据更新，PHOENIX 可以 steer 下面的有界 notice。默认每个直接用户任务最多纠正一次；存在新鲜验证时完全不会触发。

##### 停止 notice

```markdown
This task has successful mutations after its latest accepted verification. Before presenting it as complete, <domain-specific hint> Prefer the existing production/user entrypoint and the smallest high-signal check; do not rerun evidence that is still fresh. If no meaningful automated check exists, inspect the final artifact and state the verification limit.
```

#### Token 影响

合规路径为零 token。只有过早在脏状态结束时才付出最多 maxStopNudges 条 notice 的成本；base 默认配置为一次。

#### KV Cache 影响

纠正作为新的 next-step context 追加在可复用前缀之后，不会重写更早的 prompt 或工具 schema token。

## 已知限制与暂缓事项

- 分类刻意采用本地启发式。新的可修改 MCP 工具如果名称和参数都不匹配当前模式，在其适配器声明质量元数据前可能不会使证据失效。
- 新鲜度按 generation 管理，而不是内容 hash。这样保守且 O(1)；等文件系统和工具元数据 seam 能在不增加 I/O 的情况下提供权威输入 hash 后，再引入内容寻址证据。
- 策略按 agent 跟踪一个直接用户任务，而不是跨 session 的全局失败学习数据库。持久工具和 session 历史仍保存失败供模型使用；紧凑的跨任务失败索引应属于 learning 子系统，而不是这个 guard。
- 视觉质量仍需要浏览器或渲染能力产生证据；本 guard 只判断观察到的证据是否足够新鲜。
