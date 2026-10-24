# Agent Note：在 Phoenix Chrome/Chromium 中快速且可验证地填写表单

Status: implemented

[English](2026-10-16-dom-batch-forms-without-screenshot-loop.md) | 中文

## Problem

嵌入式 MiniBrowser 在展开时每 350 毫秒、其他情况下每 600 毫秒刷新 Chrome JPEG 截图。即使无需视觉分析，这种持续的 CDP/视频工作仍会与 Kira 的表单操作争夺资源。尽管 `inspect_page` 和 `fill_form` 已支持在单次 CDP 调用中处理最多 30 个字段，Kira 有时仍采用视觉点击→截图→文字的循环。内部 `browserBatchExpression` 还对每个字段分别扫描整份文档。

## Decision

- 在整批操作中复用第一个字段生成的、已清理的 DOM 元素和候选快照；若页面变化使控件脱离文档，则拒绝操作。
- 新增 `verify_form`，在单独一次只读 DOM 比较中验证最多 30 个字段预期值。仅返回布尔成功/失败及清理后的原因；不返回实际字段值，不尝试验证密码猜测，不读取隐藏、禁用或只读字段，也不注入脚本。
- 将 MiniBrowser 截图间隔调整为 1100/1600 毫秒；Host 标签页隐藏时跳过截图，恢复可见后刷新。显式 UI 操作仍通过真实 CDP 命令完成。
- 两种 Kira 预设及连接器工具元数据都优先采用一次 `inspect_page` → 分批 `fill_form` → 一次 `verify_form`。仅在结构化 DOM 不可用或需要查看页面时截图；不自动重复提交。遇到受保护字段或意外页面变化应停止并报告。

## Verification

自动化 jsdom 测试检查批量序列化确实执行、只遍历一次 DOM、核对填充值、发现页面侧覆盖并拒绝密码或隐藏字段读取。Windows 类型检查与构建以及真实 Brandpoll 运行仍是独立的验证要求，不应视为已通过。

## Consequences

只读验证仍拒绝受保护字段、意外变更和不受支持的 DOM 状态。

## Alternatives considered

拒绝对每个字段分别截图和遍历 DOM，因为重复的视觉捕获会拖慢批量操作。
