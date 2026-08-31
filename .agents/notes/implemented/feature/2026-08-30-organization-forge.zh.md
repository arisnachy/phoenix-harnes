# Agent Note: Organization Forge

Status: implemented

[English](2026-08-30-organization-forge.md) | 中文

## 问题

创建组织或产品不只是一次模型回复：工作需要相似方案研究、安全复用、工程与安全角色协作、每个交付要求的证据以及明确的交接决定。没有持久记录时，部分构建可能被标记为 ready，私有客户数据也可能被保存为可复用知识。

## 决策

目标领域在核心任务循环旁增加模块化的 `organizationForge` 和事件驱动的 `OrganizationForgeLedger`。Forge 构建记录目标、必需标准、公开来源、复用前和修改后的审计结果、Phoenix IT/Security/R&D 角色、独立 judge 结论以及 handoff、assisted 或 autonomous 管理模式。

面向模型的 `organization_forge` 工具负责 start、查看、登记来源、记录审计、推进阶段、附加证据、请求独立 judge，并在 ready 后选择管理模式。公开来源定位器会拒绝包含凭据的引用。每个复用来源在复用前和修改后都必须通过许可证、依赖、secret 和漏洞检查。只有当构建从 verifying 阶段出发，所有必需标准均为 verified，所有来源均通过两次审计，且独立 judge 返回 pass 时，Forge 才能进入 ready。judge 拒绝会让构建停留在 verifying，并保留发现以便修复；外部阻塞会保持明确且持久。

工具会展示所需的构建后问题以及三个选项：`Entregar`、`Gestión asistida` 和 `Gestión autónoma`。Forge 状态保存在所属会话日志中，不会把 secret、私有客户数据或凭据复制到 Atlas 或可复用记录。

执行窗口上限属于尝试策略，不代表任务完成。窗口达到上限后，同会话 goal 驱动器会轮换到新的 goal 修订号，重置窗口计数，记录续行并改变策略。提供方和 token 失败属于可恢复尝试；只有明确的外部阻塞会暂停自动工作，只有独立 judge 通过或用户明确取消才能结束任务。

## 考虑过的替代方案

**让 Forge 成为任务循环本身**：拒绝，因为组织构建是可选的面向用户能力，核心 harness 仍必须支持普通编程、研究和自动化任务。

**默认把可复用源代码或研究内容保存到 Atlas**：拒绝，因为私有客户数据和 secret 必须留在所属会话或批准的本地存储中；Forge 只记录公开来源和有界审计事实。

**仅凭实现或测试通过就进入 ready**：拒绝，因为交付需要逐条标准证据、修改后的安全复审以及独立 judge。

## 结果

Forge 构建可检查、可恢复，管理方式是明确的交付后决定，而不是意外接管。该流程增加持久事件和 judge 调用，但生命周期受到标准、审计字段和现有任务续行策略的约束。真实外部来源审计、提供方可用性和业务验收证据仍依赖配置环境，并且必须在 ready 前记录。

## 测试

ledger 测试覆盖持久研究、来源溯源、两个审计阶段、证据推进、judge 拒绝与通过、管理模式门禁以及带凭据定位器拒绝。goal-round 测试覆盖上限后的窗口轮换，以及 rate-limit、提供方、token 和 prompt 组装失败后的重试，同时确认任务保持 active。goal 与 goal-tool 聚合包类型检查通过，聚焦测试通过。
