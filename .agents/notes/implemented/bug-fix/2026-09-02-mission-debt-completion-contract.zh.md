# Agent Note: 任务债务完成契约

Status: implemented

## Problem

可执行的 PHOENIX 任务可能已经执行了真实工具工作，却在顶层回合结束时输出 `Pendiente:`、`Pending:` 或 `not yet` 等文字，即使用户要求的交付物仍未完成。通用 agent loop 将纯文本模型响应视为回合完成本身是正确的，但如果没有活动的持久目标，这个回合边界就可能变成用户可见的任务终点。HARDNESS 也可能把缺少技术能力暴露为阻塞，即使 PHOENIX 仍可通过更换路线、获取能力或构建受治理的辅助工具继续执行。

## Decision

goal-round driver 通过现有的 `agent/turn-stopping` 扩展点安装回合停止边界的任务债务护栏。对于确实执行过工具的直接人类请求，如果最终助手消息明确留下未解决工作，系统会在回合稳定结束之前，将该人类请求的原始目标建立为活动的持久目标。普通信息问答以及明确报告没有剩余债务的可执行回合保持不变。

持久目标继续作为自动续行的权威来源。回合上限只限制单个执行窗口，而不终止任务：driver 会轮换目标 revision 与策略、持久化 supervisor 状态、从 provider 错误和 token 上限中恢复，并持续执行，直到现有 completion gate 与独立 judge 接受结果，或目标依据正常权限规则被明确暂停/取消。

在 HARDNESS 工具边界，缺少技术能力、执行 surface 或 executor 被归类为 `RECOVERING` 的内部任务债务。恢复指令要求 PHOENIX 检查现有能力与 connector 清单、尝试实质不同的路线、获取或构建运行时允许的最小受治理辅助工具、在使用前测试，并保留从失败到解决方案的学习。`WAITING_EXTERNAL` 只用于 PHOENIX 无法自行创建或满足的依赖，例如直接人类授权、仅由人类控制的凭据、必须由人完成的物理动作，或不可用的外部基础设施。

现有的对抗式 completion gate、artifact fingerprint、clean-room 验证、强制 evidence ledger 与独立 judge 仍然是成功完成的唯一通路。本变更不会削弱这些 gate，也不会修改通用 agent loop。

## Verification

聚焦单元测试覆盖西班牙语和英语的未解决工作表达、明确无债务表达、真实工具执行要求以及直接人类权限。集成测试通过真实 agent-loop 生命周期重现 Hostinger 风格的部分交付，并验证回合会创建持久目标而不是静默结束。HARDNESS 回归测试验证技术阻塞会被重新分类，同时保留真正的人类/外部阻塞。仓库 CI 提供 static、coverage、snapshot/artifact、Windows、Node 兼容性、Python keyless、release 以及 updater/channel 验证。

## Alternatives considered

**仅依赖 prompt 的持久性。** 被否决，因为 HARDNESS 已经要求模型不要在部分工作时停止；缺陷位于生命周期边界的执行约束，仅增强文字仍可能被模型忽略。

**修改通用 agent loop，拒绝所有纯文本完成。** 被否决，因为信息问答和普通对话本来就可以在没有工具调用时合法结束。持久性应属于 goal 插件和既有生命周期扩展点，而不是全局 loop 启发式。

**把所有 blocker 都视为外部依赖。** 被否决，因为缺少工具、executor 和技术 surface 经常可以由 PHOENIX 自行解决。只有超出 PHOENIX 权限范围的依赖才应等待人类或外部系统。

## Consequences

PHOENIX 现在会把明确的可执行任务债务转换为持久续行，而不是将其作为终止性交接呈现。该护栏有意保持保守：它要求直接人类目标、同一回合内的真实工具执行以及明确的未解决工作证据，从而减少普通聊天被误建为目标。技术能力故障可能消耗更多恢复回合和工具工作，但这是刻意的取舍，因为有界尝试可以丢弃，而任务目标必须持久。完成质量继续由既有的独立证据与 judge gate 以 fail-closed 方式保护。
