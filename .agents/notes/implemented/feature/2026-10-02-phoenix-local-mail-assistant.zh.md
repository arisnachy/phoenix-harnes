# Agent Note: Phoenix 本地邮件助手与持久提示回执

Status: implemented

[English](2026-10-02-phoenix-local-mail-assistant.md) | 中文

## Problem

Phoenix 需要在聊天关闭后接收所有者邮件任务，由 Kira 完成真实工作，并显示当前提示而不重复已处理结果。所有者没有云部署，要求免费方案包含的邮箱域名。

## Decision

hardness-adapters host 持有 AgentMail 注册、出站通知、轮询、持久任务 journal 与不可变回复 outbox。credential service 持有密钥。模型执行前强制验证所有者、服务商认证及显式发件人授权；自动邮件和自身邮件不能创建任务。Reply-To 与 CC 不能重定向回复。注册结果不确定会持久保存，不自动重试。

邮件任务使用独立持久 root session，复制所选协调者的模型、preset 与工作目录。正常工具、审批边界和回合完成规则保持权威。仅属于当前任务的 `phoenix_mail_complete` 要求有用摘要和具体证据；正常完成回合并完成持久清理后才发送。正常关闭保留进度，恢复时要求 Kira 检查已完成操作的效果，避免重复。受阻任务保持可见，等待所有者处理。

receiver 隔离单封邮件读取失败，避免阻塞已有任务；轮询重试失败读取。WebSocket 关闭会清除其 owner，下一轮重新连接。outbox 重试保持相同键和正文；超过 AgentMail 24 小时幂等窗口的不确定发送成为可见阻塞。不宣称超过服务商幂等期限后仍普遍恰好发送一次。

主页回执标识条目与实质版本。先过滤，再限制八行，避免已处理的高排名提示挤占新提示。较新成功投递取代旧失败。结果和阻塞共用现有主页，团队头像和反应保持现有契约。

Windows 登录启动由显式本地设置控制，仅使用一个持有的快捷方式。supervisor 传递持久安装目录，与临时 runtime checkout 分开。PC 必须运行；启动时补收邮件，不假装离线执行。

## Alternatives considered

公开托管 webhook 需要部署并增加入站接口，不符合仅 PC 要求。SDK 不能消除验证或注册恢复；native fetch 通过 transport interface 实现固定服务商操作。模型直接发送会绕过持久完成与目的地址验证。无限重试会超过服务商幂等期限，造成重复邮件风险。新仪表盘会改变已批准布局。

## Consequences

空轮询不调用模型。免费域名避免付费配置，但免费额度及正常模型费用仍适用。真实激活需要所有者验证；无密钥测试不能证明服务商可用。Linux 验证启动参数和 supervisor 行为；真实 Windows 快捷方式运行需要 Windows 安装。入站正文有长度限制，附件不自动执行。失败读取会重试而不是丢弃，在修复前增加服务商读取成本。

## Testing

定向测试覆盖授权拒绝、持久去重、不确定注册和发送、验证次数限制、异常邮件隔离、正常关闭、socket 关闭及提示回执。真实 Web composition 仅模拟外部邮件和模型服务，记录提交的会话 transcript，并使用真实 Chromium 验证注册、浏览器关闭后工作、单次回复及回执刷新持久性。真实服务商注册与 Windows 登录执行仍需要所有者 PC 激活验证。
