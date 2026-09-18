# `@phoenix-ai/dsh-tool-living`

[English](README.md) | 中文

Universal Living Creations 的模型侧 Consumer。它安装一条与领域无关的规则，并通过 `ctx.living` 提供注册、连接器生成、检查、列出、读取、操作、验证以及显式遗忘创建物的工具。

## Model Experience

所有模型看到同一条规则：只要 Phoenix 为用户创建或实质修改面向用户的制品或可运行系统，就必须在交付前注册该创建物，不受领域或格式限制。可变应用、网站、服务、模拟器和运行 dashboard 通常以 `controllable` 为目标；真正不需要实时行为的制品才保持 `static`。

`living_register_creation` 接受任意 `kind` 文本和自描述能力，并为每个非静态目标自动配置独立的 Phoenix control link，同时在后续更新中保持该身份。`living_get_connector_kit` 返回 JavaScript/Node 与 Python sidecar 模块以及运行时描述符；生成源码从环境变量读取 bearer，不把 secret 写死进代码。

`living_inspect_creation` 显示目标级别与实际达到级别。`living_read_state` 和 `living_act` 只通过已连接 provider 运行。实际级别低于声明目标时，`living_verify_creation` 会失败，因此 Phoenix 不能仅凭文件或预览存在就宣称实时应用已经完成。`living_forget_creation` 是刻意设计的破坏性操作：运行时丢失只会让持久 manifest 保持离线；只有当用户明确要求 Phoenix 不再记住该创建物，或者创建物已经永久删除且不再计划重连时，才使用遗忘工具移除它。

## Known Limitations and Deferred Work

生成的 connector kit 有意保持轻量并以 owner-local 为目标。公共浏览器 bundle 绝不能包含 bearer token；面向浏览器的产品应把 Phoenix connector 放在服务端进程/sidecar 中，或使用其他安全 provider 实现。
