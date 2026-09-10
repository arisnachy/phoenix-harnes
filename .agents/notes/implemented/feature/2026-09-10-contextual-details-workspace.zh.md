# Agent Note: 上下文详情工作区

Status: implemented

## Problem

工具输出已经具备详情列和结构化渲染器，但聊天时间线没有提供一种直接、低摩擦的方式把某个工具调用送入该工作区。Computer Use 截图等可视化工具输出在没有专用卡片匹配时也会退回文本，因此详情列无法承担高级 UI 所需要的持久上下文表面。

## Decision

聊天节点 owner 将现有的 `openDetails` 展示动作从会话视图传递到工具调用渲染。每个工具行提供本地化的详情控件，用于选中该调用并打开现有右侧工作区。该动作只改变 UI 选择与布局状态，不改变输入提交、取消、会话事件、工具执行或 agent-loop 行为。

已完成的工具结果可以在 `meta.artifact` 中提供图像 artifact。通用详情渲染器只显示带有非空标题且浏览器可直接加载的完整 `data:image/...` artifact；终端、读取、diff、搜索、Web、运行中和原始文本路径在这一步可视检查之后继续保持既有优先级。这让 Computer Use 和未来的可视化工具获得安全的通用预览，同时不跨插件导入其他实现组件。

## Alternatives considered

**构建第二个 artifact 面板。** 未采用，因为 conversation 包已经拥有选择状态、详情宽度、关闭行为和 `conversation.details.tool` slot；重复这些状态会产生竞争的面板生命周期，并增加干扰 composer 的机会。

**把工具行点击路由到 trajectory inspector。** 未采用，因为 trajectory inspection 会切换视图，服务于不同的调试任务。UI-4 保持聊天可见，同时让所选工具输出持续显示在旁边。

**跨插件包导入现有 artifact 组件。** 未采用，因为客户端插件通过 slot 和普通 owner 数据组合，而不是跨包导入实现组件。因此通用图像预览保留在 tool details 渲染器本地。

## Testing

UI-tool 组件测试验证详情控件会把所选 turn/call/tool 标识发送给 `openDetails`，并验证图像 artifact 会渲染成可访问图像。仓库 CI 继续负责完整 coverage、静态 gates、snapshots、Windows lanes、package consumers 和构建验证。

## Consequences

UI-4 复用一个详情工作区，而不是增加并行 viewer，因此打开或关闭上下文输出仍与任务执行和 composer 状态相互独立。通用可视 fallback 被刻意限制：不支持或不完整的 artifact 会继续走现有结构化或原始文本路径，直到由专用渲染器接管。
