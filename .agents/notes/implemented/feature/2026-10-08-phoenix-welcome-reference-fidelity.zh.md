# Agent Note：Phoenix 欢迎页忠实呈现参考设计

Status: implemented

[English](2026-10-08-phoenix-welcome-reference-fidelity.md) | 中文

## Problem

此前的快捷操作实现虽然复刻了卡片，却漏掉了获批参考设计中的导航、顶部工具栏和内容对齐方式。

## Decision

真实的展开侧边栏包括 Inicio、Descubrir、Conectores、Equipo 和 Biblioteca。Inicio 复用 `startSession`；中间三个条目打开已注册目标；Biblioteca 或欢迎页搜索调用现有的工作区会话搜索。折叠侧边栏不会改变工作区和导航路径。

欢迎页工具栏挂载现有会话模型目录中的真实模型选择器。活跃输入框仅在空白欢迎页阶段移动其选择器，不引入第二个文本框或虚构的模型操作。头像打开真实的 Profile 设置部分。

居中的欢迎页不再继承浮动团队计数器造成的位移（侧边栏为 280px 时偏移约 112px）。保留真实的单色 Phoenix 徽标与仅显示姓名首字母的头像。

## Alternatives considered

**添加静态导航插图。** 已拒绝，因为它们无法打开真实目标，会造成控件可用的假象。

**复制模型选择器和输入框逻辑。** 已拒绝，因为它们会造成相互竞争的会话状态和可用模型数据来源。

**在 Profile 控件中使用虚构肖像。** 已拒绝，改为采用实际支持的首字母头像。

## Consequences

欢迎页更贴近获批参考设计，且不引入影子导航或会话状态。最终信心仍依赖基于准确 SHA 的构建以及真实桌面与手机测试，涵盖模型菜单、设置导航、工作区搜索、焦点行为、浅色及深色主题。
