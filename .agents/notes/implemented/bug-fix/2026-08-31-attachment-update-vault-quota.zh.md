# Agent Note: 附件投影、stable 更新、秘密保险箱和配额连续性

Status: implemented

[English](2026-08-31-attachment-update-vault-quota.md) | 中文

## Problem

对于非图片文件，模型只收到附件元数据而没有可用内容；本地 updater 忽略了变化中的 `stable` 发布分支；通过聊天输入的秘密可能进入模型可见历史；Settings 中的模型选择器重新挂载时 Codex 配额显示消失。

## Decision

附件能力将有界 UTF-8 文本、未压缩 PDF 文本和 Open XML 文档文本投影到模型请求中，同时将图片保留为图片部分，将不透明二进制保留为安全元数据或可打印文本。updater 读取配置的发布分支，默认使用 `stable`，并且只修改 `main` 或 `stable`；开发分支只检查和报告，不修改用户文件。`secret-vault` 增加仅供人类使用的 `/secret` 命令，通过现有 credentials provider 写入，不把值放入命令结果或会话事件，并且只向模型公开已配置状态。Codex 配额组件按稳定的页面连接缓存有效 telemetry，因此选择器和 Settings 重新挂载时可以立即显示最近的 5h/7d 数据，同时在后台重新读取授权信息。

## Alternatives considered

**将每个文件都作为原始文本发送。** 拒绝，因为二进制数据对文本模型不一定有意义，并且可能产生无界 prompt；已识别的格式使用有界投影，其他文件在存在安全解析器之前只保留元数据。

**只使用 manifest commit 作为更新目标。** 拒绝，因为发布 manifest 可能落后于变化中的 `stable` 分支；updater 校验 manifest 后读取配置的远程发布 ref，同时拒绝不安全的分支修改。

**先把秘密值放进对话，再在之后脱敏。** 拒绝，因为该值已经越过模型和 transcript 边界；保险箱通过仅供人类使用的命令接收值，并通过 credentials 解析而不返回值。

**只在组件状态中保存配额。** 拒绝，因为 Settings 插槽会因模型菜单交互而重新挂载；按连接缓存可以保持连续性而不在页面连接之间共享数据。

## Consequences

常见文本、PDF 和 Office 附件可以被模型读取，并受字节上限约束；不支持的二进制格式仍需要领域解析器或用户提供文本导出。stable 更新可以从脏工作树或开发分支中被发现，但在用户切换到发布分支之前，自动修改仍然安全失败。保险箱防止模型和会话日志泄露，但主机存储保护取决于已配置的 credentials provider。重新挂载后配额会立即显示并在后台刷新；provider 没有有效 telemetry 时仍不占用界面空间。

## Testing

附件、DeepSeek 序列化、pi-ai context、secret-vault、配额和 updater UI 的聚焦测试通过。相关 TypeScript 构建通过，updater 入口通过语法检查，源代码 web server 返回 HTTP 200、包含 client-module preload 且没有 plugin-load 错误。本地 updater 检测到当前 stable 分支已分叉，并以可恢复状态拒绝不安全修改。
