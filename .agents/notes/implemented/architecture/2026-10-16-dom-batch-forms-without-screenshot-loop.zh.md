# Agent Note：在 Phoenix 中用 DOM 批量填写并验证表单（Chrome/Chromium）

Status: implemented

[English](2026-10-16-dom-batch-forms-without-screenshot-loop.md) | 中文

## Problem

嵌入式 MiniBrowser 在展开时每 350 毫秒刷新 Chrome JPEG 截图，其他情况下每 600 毫秒刷新。持续的 CDP 和视频捕获工作与 Kira 的表单操作竞争资源，即使当时并不需要视觉分析也是如此。虽然 `inspect_page` 和 `fill_form` 已能在一次 CDP 调用中处理最多 30 个字段，Kira 有时仍使用点击、截图、读取文字的循环。内部的 `browserBatchExpression` 也曾为每个字段重新扫描整份文档。

## Decision

- 在同一批次中复用首次获取的经过清理的 DOM 元素与候选快照；若页面在处理期间变化，则拒绝使用失效控件。
- 新的 `verify_form` 对最多 30 个预期字段执行一次独立的只读 DOM 比较。仅返回布尔结果和清理后的原因；不得读取实际字段值、验证密码猜测、检查隐藏或禁用及只读字段，也不得注入脚本。
- 将迷你浏览器的捕获间隔调整为 1100/1600 毫秒；Host 标签页隐藏时跳过捕获，恢复可见时再刷新。明确的用户界面操作仍通过真实 CDP 命令执行。
- 在两种 Kira 预设和连接器工具元数据中，优先执行一次 `inspect_page`，再批量 `fill_form`，最后一次 `verify_form`。仅在无法获得结构化 DOM 或确需检查视图时截图；不得自动重复提交。对受保护字段与意外变动停止并报告。

## Verification

自动化 jsdom 测试验证批量调用确实执行、DOM 仅被遍历一次、填写内容得到确认、页面端覆盖可被检测，并拒绝读取密码或隐藏字段。Windows 类型检查和构建、以及真实 Brandpoll 测试属于独立的验收要求，不能假定已通过。

## Consequences

只读验证仍会拒绝受保护字段、意外页面变动和不受支持的 DOM 状态。

## Alternatives considered

拒绝对每个字段都进行单独截图与 DOM 遍历，因为重复的视觉捕获和扫描会拖慢经过授权的批量工作。
