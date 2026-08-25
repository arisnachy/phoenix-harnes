# @arisnachy/phoenix-continuity

[English](README.md) | 中文

PHOENIX Continuity 在复用 DeepSeek Harness 原生存储的前提下，负责持久化 **Memory Genome** 与 **Mission Graph** 状态。它不会创建第二套数据库、agent loop、workflow engine 或后台 job runtime。

## 它负责什么

- `ctx.phoenixContinuity` — 内存与任务状态的 host service。
- `phoenix_continuity` — 原生 `storageDomain`，包含 `memories` 与 `missions` 两张表。
- Memory Genome — 有界、显式写入、带来源的记忆，并提供确定性的本地词法检索。
- Mission Graph — 经过 DAG 校验的任务图，持久化 ready/running/succeeded/failure/pivot 状态转换。
- Never-Stop 历史 — 任务耗尽尝试次数后进入 `pivot-required`；pivot 会保留旧任务为 blocked 历史，并把依赖者重连到替代任务，而不是删除失败路径。

部署必须显式配置记录字节数、记忆数量、任务图数量、recall 结果数、单任务图任务数、任务尝试次数和查询字节数上限。达到容量限制时失败关闭；记忆不会静默淘汰。

## 执行边界

Mission Graph 是**状态，不是执行器**。本包不会启动模型、子进程、workflow、job 或 subagent。后续 PHOENIX 编排 consumer 可以领取 ready task，把执行交给 DSH 原生 `workflowEngine`、`jobs` 或 `subagents`，再通过 `ctx.phoenixContinuity` 提交结果。

Memory Genome 同样不会自动把记忆注入 prompt。Recall 是显式的本地查询，因此历史不会永久占用请求上下文。

## Model Experience

### Continuity state service

#### What the model sees

默认什么也看不到。`ctx.phoenixContinuity` 是 host service，本包不注册模型工具，也不增加 prompt section。未来 consumer 可以暴露有界操作，而不改变 durable state 合约。

#### Token effect

直接请求上下文 token 为零。Memory recall 在本地使用词法匹配；Mission Graph 转换是确定性状态操作。本包不会发起 embedding 或模型请求。

#### KV Cache effect

本包不增加或改写 prompt 前缀，因此自身不会使模型 KV cache 失效。未来 consumer 若选择展示 recalled memory，则必须显式承担对应 prompt/cache 成本。

## Safety and durability

记录在 `storageDomain` 的读取边界进行 schema 校验。Mutation 会串行化；backend 在内存可见之前完成持久化提交；完整序列化记录受字节上限约束；返回快照不会暴露 storage domain 内部可变对象别名。

## Known Limitations and Deferred Work

- Memory retrieval 目前只有词法/结构检索，不包含 embedding index。
- Mission Graph 不执行任务；workflow/job 集成属于独立 consumer。
- 第一版 continuity 不提供模型可见的 memory/mission 工具。
- 不提供分布式复制或 peer-to-peer executable evolution。
