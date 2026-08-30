# @phoenix-ai/dsh-host-plugin-inventory

[English](README.md) | 中文

用于当前 Cordis Loader 树与 PHOENIX stable 更新生命周期的 Host 诊断服务。`PluginInventoryGateway` 注册 `pluginInventory` Remote 命名空间。`pluginInventory/list` 仍是对非 group Loader 条目的只读即时投影；`pluginInventory/updateState` 暴露经过清理的仓库本地更新器状态；`pluginInventory/restartForUpdate` 只有在受信任状态恰好为 `ready` 且带有有效的已准备 target 时才接受重启请求。

Loader 清单每次调用都直接读取 `ctx.loader.entries()`，跳过结构性的 group 行，并返回 Loader 条目 id、模块标识、有效启用状态与当前根 Fiber 阶段。阶段为 `pending`、`loading`、`active`、`failed` 或 `unloading`；条目没有存活的根 Fiber 时则为 `null`。Loader 仍是插件生命周期的唯一权威，本包不拥有清单缓存或插件修改路径。

更新器状态位于 checkout 的 Git 目录中，不在 `$DSH_HOME`。更新器会原子地替换这个 JSON 文档，Host 也会重试短暂的读取竞争。Host 桥只接受文档规定的更新状态词汇，限制自由文本字段长度，只接受完整的 40 字符 commit id，并且绝不允许浏览器提供激活 target。重启请求会绑定到分离 stable 更新器已经写入的精确 `ready` target，随后 Host 只会在该请求持久写入后安排自身退出。Host 退出之后，激活、rollback 与重新启动都由更新器进程负责。

公开 payload 类型位于 `./types`，Typert 生成由 `./typert` 与 `./remote` 导出的 Host 和 Client Remote 产物。该服务仅供 Remote 使用，刻意不声明同进程 Cordis `Context` merge。Client 包通过显式的 [`api-remotes`](../../api/remotes/README.zh.md) 组合消费它，而不导入 Host 实现。

## 模型体验

无，因为这个仅限 Host 的诊断与更新控制服务不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **插件状态只表示调用当下** —— 清单不包含持久插件失败历史或订阅；只要不存在存活的根 Fiber，就会报告 `null`，而不区分原因。
- **更新进度按阶段报告** —— 更新器报告源码、依赖、构建、smoke、激活与 rollback 阶段，而不是按下载字节显示百分比。
- **重启权限有意保持狭窄** —— Web 只能请求激活更新器精确准备好的 `ready` target；任意 checkout 切换与插件修改都不属于本服务。
