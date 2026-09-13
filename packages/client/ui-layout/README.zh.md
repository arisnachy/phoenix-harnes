# @phoenix-ai/dsh-client-ui-layout

[English](README.md) | 中文

外壳插件：三栏 AppFrame（拖动手柄与让步链）加 `ctx.layout` 面板几何服务；它注册到运行时拥有的 `root` slot，并声明 `sidebar`、`conversation`、`details` 和 `shell.overlay`。侧边栏的缩放边界是不可见命中条带，详情栏边界则保留其浮动胶囊；让步期间只有详情栏会收缩并随后自动关闭。关闭的侧边栏仍保留 56px 控制栏，详情栏则关闭到零宽度。该包还提供主题呈现器：它消费解析后的 `ctx.theme` 快照，并将其投影到 document（用 `html { color-scheme }` 驱动原生 UA 控件，依据当前配色方案设置 `body[data-ds-dark-theme]`，并将主题的别名 token 设为 body 上的内联变量，同时拥有一个 `<meta name="theme-color">`，其内容随计算后的 body 背景色更新）。在应用调色板和 token 后进行测量，可确保渲染后的背景成为唯一的颜色依据；呈现器在 dispose（资源释放）时会移除其自有的元数据节点，并一并清除其写入的其他全局状态。

AppFrame 始终挂载会话栏和详情栏；已连接 Session 通过 `SessionProvider` 渲染。布局 store 是瞬时状态，侧边栏以默认宽度启动，详情栏则保持关闭，且该 store 从不读写 `localStorage`。hero 和其他未选中状态也会将详情栏的渲染宽度派生为零，但不会改变存储的宽度偏好。AppFrame 会跨越这些状态保留最后一个非 blank 会话 id：首个会话保持关闭；显式打开详情栏的操作会使用约定默认宽度；返回同一会话时恢复其未改变的宽度；选择不同会话时，详情栏会在绘制前关闭。会话 owner share 为空，侧边栏 owner share 只包含 `collapsed` 和 `width`；注册方通过标准钩子获取业务数据，并从各自的 inject 接口获取操作。

`ctx.layout` 还协调命名的 `subagent` 与 `cordis` 可视工作区占用状态。展开的 KIRA／子智能体卡片只报告占用状态用于垂直堆叠；它本身已经在 center flow 中预留宽度，因此不会改写侧边栏或详情栏几何。Cordis 的行为不同：打开 Cordis 时会先保存用户当前的侧边栏和详情栏偏好，将导航最小化为紧凑的 56px 控制栏，关闭普通详情列，并把 Cordis 渲染到 `shell.overlay` 中，作为会话旁边受约束的 in-flow 右侧可视轨道。这样聊天区域会向左让出空间，而不会被覆盖。如果 KIRA／子智能体卡片已经展开，KIRA 占据同一轨道的上半部分，Cordis 使用剩余的下半部分。关闭 Cordis 时会精确恢复 Cordis 打开前的侧边栏和详情栏状态，同时保留仍然活跃的子智能体占用状态。在窄屏幕上，共享可视轨道会堆叠到会话下方，而不是横向挤压聊天区域。

`/client` 导出表层包含插件主体（`apply`／`inject`）、`LayoutController`、`ILayout`、`WorkspaceOccupancy`、`WorkspaceOccupant` 以及 owner-share 接口。AppFrame、面板 store 与让步求解器仍属于包内部。

## 模型体验

无。布局外壳管理浏览器查看状态；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **面板几何信息是瞬时状态**：重新加载会恢复侧边栏默认值，并使详情栏保持关闭；在不同会话 id 之间切换同样会关闭详情栏，并忘记拖动后的宽度，而未选中表面会以零宽度渲染详情栏，但不会修改几何信息。
- **桌面端可视轨道刻意保持受约束**：Cordis 使用紧凑的右侧轨道，而不是自由调整大小的第四个外壳列；未来的多窗格工作区可以增加独立调整大小能力，而无需改变命名占用者生命周期。
- **让步链自动关闭通过推导零宽度实现，不会改动宽度偏好**：窗口变宽时面板会自行恢复；消费方禁止把 store 中的详情宽度当作实际渲染状态。
- **挤压重排期间不提供滚动锚定**：布局变化可能移动读者的 viewport。