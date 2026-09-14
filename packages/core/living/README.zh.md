# `@phoenix-ai/dsh-living`

[English](README.md) | 中文

Phoenix 与其所创建内容保持通用运行关系的 Service Definition。`ctx.living` 不维护领域分类表：每个创建物自行描述身份、目标集成级别、可观察状态、动作、事件、资源和参与者。

## Contract

`LivingCreationManifest.kind` 只是描述文本，绝不是枚举。集成级别按 `static` → `connected` → `reactive` → `controllable` → `inhabited` 排序。提供者必须通过真实方法证明已达到的级别：实时状态、事件订阅、动作分发和参与者。即使运行提供者离线，manifest 仍可被记住，因此运行时丢失不会抹掉 Phoenix 对该创建物的身份关系。

`LivingRegistry.remember()` 通过当前实现持久化或替换 manifest。`attach()` 连接实时运行时并返回 disposer；释放提供者后 manifest 仍保留。实时权限不可用时，`readState()` 和 `act()` 会明确失败。

## Model Experience

本包本身不向模型暴露工具。`@phoenix-ai/dsh-tool-living` 拥有常驻创建规则和模型控制；生成的插件和适配器通过 `ctx.living.attach()` 连接其运行时。

## Limitations

Service Definition 有意不拥有传输或存储。进程外创建物需要实现 `LivingCreationProvider` 的适配器；持久化由所选择的 `ctx.living` 实现负责。
