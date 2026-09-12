# Agent Note: Effort selector keeps the slider open until Host acceptance

Status: implemented

[English](2026-09-12-effort-selector-slider-acceptance.md) | 中文

## Problem

composer 的 effort 面板会直接从每个菜单行提交新选择，因此用户调整控件时的一次触摸可能在用户完成选择或 Host 接受之前就立即关闭面板。

## Decision

effort 面板在蓝色 Codex 风格卡片中渲染一个原生 range 控件。它的停靠点由 Host 返回的确切模型 reasoning metadata 构建，并在开头提供一个 provider-default 停靠点；该停靠点不提交 `reasoningEffort`，因此保留适配器默认行为。range 改变只更新本地草稿；指针释放和键盘提交才会提交一份完整的 provider/model/effort 选择。

选择 promise 等待期间卡片保持挂载。Host 接受后卡片关闭并将焦点还原到触发器；拒绝时清除草稿、保持卡片打开，并使用现有的临时错误提示。根键盘与焦点处理器将 range 和 reset 控件视为卡片内部控件，因此移动滑块不会触发菜单导航或外部关闭。

## Alternatives considered

**在每次 range 改变时提交。** 拒绝：拖动会发起多个 provider 操作，使响应产生竞态，并在用户到达目标停靠点前关闭。

**在指针释放时先于 Host 响应关闭。** 拒绝：UI 会显示 Host 可能拒绝的选择，留下没有可见重试或修正路径的状态。

**保留菜单行并额外添加可视滑块。** 拒绝：两个控件会暴露不同的交互语义；单一原生 range 才是可访问且权威的 effort 控件。

## Consequences

用户可以在一次连续的指针或触摸手势中从 provider default 移动到任一已公布等级，包括 Medium 或 Max，并在 Host 接受前在卡片中看到待定等级。键盘用户可以使用 range 按键并提交，父级菜单不会吞掉方向键。provider-specific effort id、名称、说明和顺序仍由 Host 持有；客户端只增加 provider-default reset 操作。

## Testing

model-selector React 套件覆盖蓝色卡片 range 界面、指针释放后的确切 Max 提交、等待期间保持打开、provider-default reset 提交、动态 Codex 等级数量、打包的 provider 标记、选择失败和未设置模型的回退。
