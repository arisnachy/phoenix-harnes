# Agent Note: OpenClaw 受管路由与关闭保护

Status: implemented

[English](2026-10-23-openclaw-managed-routing-and-shutdown-guards.md) | 中文

## Problem

Phoenix 将提供商级 Codex 运行时判为未配置；当启动器使用自定义 DSH_HOME 时，仍从默认用户目录读取 OpenClaw 配置。收到明确的 Team 活动执行状态时，直接启动与停止 Gateway 的路径也没有一致地推迟操作。Cordis 插件配置还可能自行声明策略证明，而不是从 Host 获取执行权限。

## Decision

受管配置同时识别显式模型级 Codex 运行时以及官方提供商级 `models.providers.openai.agentRuntime.id`，并让模型级策略优先。启用插件白名单时必须包含 `codex`。DSH_HOME 与安装器使用相同的隔离配置路径。插件设置只能调整有界传输超时，不能代替可信 Host 服务提供原生路由或策略证明。在收到 Phoenix 活动、派发中或状态不确定的执行信息时，Gateway 启动与停止均延期，保留原有活动标记。

## Consequences

回归测试覆盖提供商级路由、显式非 Codex 覆盖、被白名单排除的 Codex 插件、自定义 DSH_HOME 以及不调用进程的繁忙 Gateway 启停。这些是局部正确性与安全改进，不代表已经验证通过官方 Gateway 的真实身份认证执行。受管 Host 策略服务、跨进程持久 Team 及旧代理会话的完整空闲检查、Codex 插件激活和真实模型执行仍未核实；在此之前，生产 OpenClaw 执行继续安全拒绝。

## Alternatives considered

**只接受模型级运行时配置。** 官方 OpenClaw 允许提供商级选择，这会错误拒绝有效部署。

**信任用户配置的策略对象或 `tools.effective` 预览。** 预览并非真实执行权限，非可信配置不能自行证明权限。

**把缺失的执行状态当作全局空闲证明。** 没有报告并不证明所有 Phoenix 进程、持久执行与其他代理已停止；Host 的全局准入保护仍是单独的发布要求。
