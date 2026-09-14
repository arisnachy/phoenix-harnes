# `@phoenix-ai/dsh-tool-living`

[English](README.md) | 中文

Universal Living Creations 的模型侧 Consumer。它安装一条与领域无关的规则，并通过 `ctx.living` 提供注册、检查、列出、读取、操作、验证以及显式遗忘创建物的工具。

## Model Experience

所有模型看到同一条规则：只要 Phoenix 为用户创建或实质修改面向用户的制品或可运行系统，就必须在交付前注册该创建物，不受领域或格式限制。模型选择真正有意义的最高目标级别，而不是把所有静态内容硬塞成交互系统。静态制品可以保持 `static`；实时系统必须构建并挂载提供者或适配器，并在完成前通过 `living_verify_creation`。

`living_register_creation` 接受任意 `kind` 文本和自描述能力。`living_inspect_creation` 显示目标级别与实际达到级别。`living_read_state` 和 `living_act` 只通过已连接提供者运行。实际级别低于声明目标时，`living_verify_creation` 会失败。`living_forget_creation` 是刻意设计的破坏性操作：运行时丢失只会让持久清单保持离线；只有当用户明确要求 Phoenix 不再记住该创建物，或者创建物已经永久删除且不再计划重连时，才使用遗忘工具移除它。

## Limitations

这些工具不会凭空制造传输层。目标高于 `static` 时，生成代码必须直接挂载 `LivingCreationProvider`，或通过适合其执行环境的适配器挂载。仅有可视化展示不能满足运行连接要求。
