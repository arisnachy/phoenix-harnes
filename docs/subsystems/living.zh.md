# Universal Living Creations

[English](living.md) | 中文

`ctx.living` 是 Phoenix 与其所创建一切内容之间、与领域无关的运行连接。每个创建物自行描述身份和能力；harness 不需要维护游戏、应用、文档、模拟器、服务、虚拟世界或未来创建类型的固定分类表。

## 集成级别

级别依次为 `static`、`connected`、`reactive`、`controllable` 和 `inhabited`。创建物选择真正有意义的最高级别。`static` 保留持久身份和资源；`connected` 增加权威实时状态；`reactive` 增加已声明事件；`controllable` 增加已声明动作；`inhabited` 增加可由 Phoenix 或其 agent 操作的参与者。

目标级别来自创建物 manifest；实际达到级别来自当前连接提供者的真实方法，绝不只依据元数据。提供者丢失后 manifest 仍会被记住，只是变为离线，因此之后的进程或适配器可以使用同一个 creation id 重新连接。

## 角色

[`@phoenix-ai/dsh-living`](../../packages/core/living/README.zh.md) 是 Service Definition。[`@phoenix-ai/dsh-living-local`](../../packages/core/living-local/README.zh.md) 是持久化进程内 Provider。[`@phoenix-ai/dsh-tool-living`](../../packages/core/tool-living/README.zh.md) 是模型侧 Consumer，负责应用通用创建规则，并暴露注册、检查、状态、动作和完成验证工具。

Cordis visual workspace 可以展示创建物，但不提供运行权限。HARDNESS 可以描述现有能力，但不拥有创建物执行。运行在 Phoenix 进程之外的创建物需要一个能够挂载 `LivingCreationProvider` 的适配器。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->
<!-- END GENERATED cordis-surface -->
