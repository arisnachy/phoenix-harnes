# `@phoenix-ai/dsh-living`

[English](README.md) | 中文

Phoenix 与其所创建内容保持通用运行关系的 Service Definition。`ctx.living` 不维护领域分类表：每个创建物自行描述身份、目标集成级别、可观察状态、动作、事件、资源和参与者。

## Contract

`LivingCreationManifest.kind` 只是描述文本，绝不是枚举。集成级别按 `static` → `connected` → `reactive` → `controllable` → `inhabited` 排序。提供者必须通过真实方法证明已达到的级别：实时状态、事件订阅、动作分发和参与者。即使运行提供者离线，manifest 仍可被记住，因此运行时丢失不会抹掉 Phoenix 对该创建物的身份关系。

`LivingRegistry.remember()` 通过当前实现持久化或替换 manifest。`attach()` 连接实时运行时并返回 disposer；释放提供者后 manifest 仍保留。实时权限不可用时，`readState()` 和 `act()` 会明确失败。`controlEndpoint()` 暴露由当前 provider 选择的端点，供生成的运行时接入 Phoenix 的通用控制传输。

## Model Experience

Indirectly, through `@phoenix-ai/dsh-tool-living`，由其负责面向模型的创建策略、工具 schema 与结果呈现。

#### KV Cache effect

本 service 自身不增加 prompt 或 schema token；cache 可见上下文只由已挂载的模型侧 consumer 改变。

## Known Limitations and Deferred Work

- Service Definition 有意不规定持久化方式，也不强制唯一传输实现。具体 provider 决定存储与连接机制；内置本地 provider 使用 owner-local HTTP bridge，远程或云端部署可以替换传输而保持相同的 `ctx.living` 契约。
