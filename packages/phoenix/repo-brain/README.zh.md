# PHOENIX Repo Brain

`@deepseek-ai/dsh-phoenix-repo-brain` 是 PHOENIX 的确定性仓库结构索引。目标是避免模型在每一轮都重新读取大量代码来重新发现同一套仓库结构。

## 它记录什么

- 源码、配置和文档路径；
- 函数、类、接口、类型、常量、Python 定义和 Markdown 标题等轻量符号；
- JavaScript/TypeScript 相对导入边；
- 用于变更影响分析的反向依赖；
- 基于路径、符号和词项的目标检索。

## 它刻意不做什么

v13 索引不使用 embedding，也不调用 LLM。它不是编译器，也不会把基于正则的符号提取冒充为完整语义分析。它只提供廉价的结构化第一遍筛选，让昂贵的模型推理从更小的候选集合开始。

## 增量行为

刷新会遍历仓库元数据；当文件大小和修改时间未改变时复用已有索引。变化文件只读取到 `maxFileBytes`，删除文件会从下一次提交的索引视图中移除。版本控制元数据、依赖/构建输出、缓存和发现的符号链接会被排除。

## 面向模型的工具

PHOENIX bundle 注册 `repo_brain`，包含四个动作：`search`、`impact`、`refresh` 和 `stats`。Repo Brain 是只读能力，没有源码写入操作。它限制仓库相对路径，但它不是操作系统 sandbox；强隔离仍由 DSH sandbox 能力负责。

## Model Experience

### Repository guidance

#### What the model sees

插件挂载后，系统提示会包含稳定的 Repo Brain 使用提示，要求在大范围 grep/read 之前优先使用 `repo_brain` 定位架构、符号和反向依赖影响。

#### Token effect

挂载时存在固定且很小的提示开销。建立索引、刷新、检索和影响计算本身不会发起额外模型调用。

#### KV Cache effect

只要插件组合和提示文本不变，该提示保持稳定前缀。刷新索引不会改变这一提示前缀。

### `repo_brain` tool

#### What the model sees

挂载时模型可见 `repo_brain` 工具 schema；只有实际调用时才会收到数据相关结果。结果包含仓库相对路径、有限数量的命中、轻量符号名或索引统计。

#### Token effect

工具 schema 带来固定请求上下文；工具结果带来数据相关 token。`search` 与 `impact` 最多返回 50 项，而索引过程本身不消耗模型 token。

#### KV Cache effect

工具 schema 在索引刷新之间保持稳定。工具结果作为新的会话内容追加，不重写此前可复用的请求前缀。

## Known Limitations and Deferred Work

- **结构化而非编译器语义** — 轻量符号提取可能遗漏语言特有结构；编译器/LSP 增强后续加入。
- **导入图范围** — v13 解析 JavaScript/TypeScript 系列相对导入，包括从 `.js` 发射路径回映射到 TypeScript 源码；workspace alias、package exports、Python imports 等尚未加入。
- **进程内索引** — 进程重启后重新构建；持久化缓存将在稳定失效协议完成后加入。
- **变更指纹** — 当前复用基于文件大小和修改时间；时间戳粒度很粗的文件系统理论上可能漏掉等大小重写。
- **完整结果字节上限** — 当前项目数有限制，但完整渲染结果的独立字节上限必须在生产完成前加入。
