# Agent Note: Universal Living Creations

Status: implemented

[English](2026-09-13-universal-living-creations.md) | 中文

## 问题

Phoenix 可以创建文件、界面、模拟器和可运行系统，但交付后它们可能与 harness 在运行层面断开。按领域分别建立桥接无法扩展，因为未来每出现一种新的创建类型都需要再次修改 harness；仅依赖提示词的约定又可能被模型忘记，而 Cordis 的可视界面只能证明内容被展示，并不能证明 Phoenix 真正拥有控制能力。

## 决策

Phoenix 使用一个与领域无关的 `ctx.living` capability seam。每个创建物注册一个自描述 manifest，其中包含身份、描述性的 `kind`、目标集成级别、可观察状态名称、动作、事件、资源和参与者。`kind` 永远不会被解释成封闭分类，因此未来即使出现 harness 从未见过的新创建类型，也不需要修改 core。

集成级别依次为 `static` → `connected` → `reactive` → `controllable` → `inhabited`。创建物选择真正有意义的最高级别。静态内容保持可发现即可，不必为了形式捏造没有意义的运行概念；交互系统则声明实时状态、事件、动作，以及可选的、可由 Phoenix 或其 agent 操作的参与者。

`@phoenix-ai/dsh-living` 是 Service Definition。`@phoenix-ai/dsh-living-local` 把 manifest 持久化到仅所有者可访问的版本化 JSON 目录中，并把运行提供者连接视为临时状态。因此重启后 Phoenix 会把已知创建物恢复为离线状态，而不是忘记它们。提供者连接必须通过真实方法证明实际达到的级别；无法满足 manifest 目标时会被拒绝。释放提供者只改变连接状态，不会删除持久身份。

`@phoenix-ai/dsh-tool-living` 是模型侧 Consumer。它的常驻 system-prompt 规则适用于 Phoenix 创建或实质修改的一切内容，不受领域或格式限制。工具负责注册与检查创建物、读取实时状态、执行已声明动作，并验证目标级别与实际达到级别。只要创建物没有真正达到自己声明的目标，`living_verify_creation` 就会失败，从而避免模型仅因为文件或预览已经存在就把一个应当连接的系统宣布为完成。

Cordis visual workspace 继续只负责展示。HARDNESS 继续负责能力清单和模态路由。两者都不会成为生成创建物的执行权限所有者；适配器和生成的运行时统一通过 `ctx.living` 连接。

## 考虑过的替代方案

**为已知领域分别增加桥接。** 拒绝，因为每增加一种类别都需要发布新的 harness 代码，未来未知创建物仍然会退化成断开的产物。

**只使用常驻模型指令。** 拒绝，因为它没有持久身份、真实连接状态、动作通道，也没有机器可验证的完成门槛。

**复用 Cordis visual workspace 或 HARDNESS。** 拒绝，因为它们现有职责分别是展示与能力发现。让任一组件负责生成运行时的执行，会混合彼此独立的生命周期和权限。

## 测试

本地提供者测试故意使用一种从未见过的创建类型，以证明系统不存在固定分类表；随后覆盖 manifest 持久化、由真实提供者推导集成级别、状态读取、动作、事件、释放后恢复离线以及能力级别验证。工具测试证明常驻规则是通用规则而不是类别枚举，并证明在声明的实时目标真正连接之前，完成验证会失败。共享 base bundle 会挂载本地提供者和模型 Consumer，因此 Phoenix 的正常 profile 都会继承这条规则。

## 后果

Phoenix 创建的一切现在都有一条标准路径继续属于 harness，而不是交付后变成“死产物”。静态与实时创建物共享统一身份，但不会被强迫拥有相同运行行为；交互运行时可以在重启后重新连接；未来适配器可以增加新的传输方式而不改变创建物词汇。若创建物运行在 Phoenix 进程之外，仍然需要一个真正实现 `LivingCreationProvider` 的传输适配器；这个 seam 不会在没有真实连接时假装外部运行时已经连接。
