# PHOENIX 侧栏 wordmark 调整

[English](2026-03-10-sidebar-phoenix-wordmark-design.md) | 中文

## 目标

让侧栏 logo 中的 `PHOENIX` 使用受 ChatGPT 参考启发的横向紧凑样式：清晰的无衬线字体、深色、半粗体以及略微负的字间距。

## 范围

- 只修改侧栏面板中的 wordmark 实例。
- 保持欢迎页/hero logo 不变。
- 保持徽章、尺寸、徽章与名称间距、无障碍和按钮行为不变。

## 设计

侧栏 `.brandName` 容器保留现有结构，但使用界面无衬线字体、主色、600 字重和略微负的 `letter-spacing`，使单词更紧凑。大小仍与当前徽章成比例，并保持单行。

实现是 `packages/client/ui-sidebar/src/client/SidebarRoot.module.css` 中的局部 CSS 调整；不修改 `PhoenixBrandName`，因为该组件也供 hero 使用。

## 验证

- 运行 branding/sidebar 聚焦测试。
- 构建 web frontend。
- 刷新后验证 `http://127.0.0.1:3080`。
- 在桌面端以及可行时的移动 viewport 中确认名称不被截断或溢出。
