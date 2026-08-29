# @phoenix-ai/dsh-client-ui-settings-plugin-inventory

[English](README.md) | 中文

Web **插件列表**设置标签页，加上 PHOENIX stable 更新的侧栏底部操作。浏览器插件注册 id 为 `all` 的本地化 `settings.plugins.tab` 贡献，以及独立的 id 为 `phoenix-update` 的 `sidebar.footer.action` 贡献。两项注册都使用 `ctx.slots.inject()`，因此可以跟随 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需在运行时导入展示层拥有方。

插件列表仍保持懒加载和只读。首次选择该标签页时，通过 [`api-remotes`](../../api/remotes/README.zh.md) 调用 `ctx.remote.pluginInventory.list()` 并渲染可搜索的 Loader 清单。加载、空结果、无匹配结果与通用失败状态只属于已挂载组件；读取失败可以重试，且不会暴露传输细节。

更新操作会在 Web 打开期间轮询仓库本地的 `pluginInventory.updateState` Remote。PHOENIX 已是当前版本时，它不占用侧栏空间。检测到 stable 发布后，它会立即出现在 Settings 上方，并跟随更新器真实生命周期：源码获取、依赖准备、构建、smoke 验证、ready、重启、激活以及 rollback／错误状态。折叠侧栏以图标和 tooltip 表示同一状态；展开侧栏显示本地化文本。状态按真实阶段报告，而不是虚构下载字节百分比。

只有 `ready` 会变成可点击操作。展开行显示 **Update ready** 与 **Restart to complete update**；点击后调用 `pluginInventory.restartForUpdate`。Host 只会为分离 stable 更新器已经准备好的精确 target 接受该请求。请求被接受后，UI 进入重启状态，Host 退出，随后激活、失败时 rollback 与自动重新启动都由分离更新器负责。被拒绝或失败的重启请求不会关闭 PHOENIX，而是留在当前进程中刷新状态或显示通用更新失败。

## 模型体验

无，因为本包只在浏览器中展示 Host 拥有的部署与更新状态，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每次 Settings 挂载或重试只读取一份插件快照** —— 插件列表不订阅 Loader 变化，也不会在重连后自动重新读取；重新打开 Settings 会取得新快照。
- **更新进度按阶段报告** —— 侧栏刻意显示有意义的准备阶段，而不是按下载字节显示百分比。
- **重启是激活边界** —— 当前 runtime 保持运行时可以完成准备，但准备好的发布不会替换该 runtime，直到用户请求 Restart 或正常关闭 PHOENIX。
