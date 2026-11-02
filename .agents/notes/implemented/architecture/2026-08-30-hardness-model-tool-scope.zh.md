# Agent Note: HARDNESS model-tool scope

Status: implemented

[English](2026-08-30-hardness-model-tool-scope.md) | 中文

## Problem

HARDNESS capability 索引与面向模型的工具注册共用一个 host composition 条目。共享 registry 是进程级的，而工具可见性属于 agent，因此在多个 preset 中挂载该条目要么会把工具泄漏到 minimal agent，要么会尝试重复注册 capability。

## Decision

`@phoenix-ai/dsh-hardness-adapters` 接受 `modelTools`。`modelTools: false` 时，host 会索引 OpenClaw 扩展、源 tools 与 skills，安装共享 operating protocol，并拥有 mission runtime。`modelTools: true` 时，preset 安装 operating protocol，只提供有 scope 的 `hardness_run` 与 `connector_list` 工具；它不会修改共享 capability index。base bundle 将 host 条目标记为不提供模型工具，`standard`、`code` 与 `cordis` 中独立的 `hardness-model-tools` 条目启用有 scope 的模式。`minimal` 保持 shell/editor composition。

## Alternatives considered

**保留 host 中的全部适配器行为。** 这会让每个 preset 都看到 HARDNESS 工具，使 minimal composition 大于其声明的契约。

**在每个 preset 中挂载完整适配器。** 这会在共享 HARDNESS registry 中重复注册 OpenClaw 与源 capability，两个 preset 共存时会失败。

**为模型工具创建第二个 package。** 这可以在物理上表达拆分，但会为一个小的配置差异增加新的 package 边界，并没有移除共享 runtime 依赖。

## Consequences

完整 preset 可以提供 mission 与 connector 工具，同时不会泄漏进程级工具。共享 atlas 与 mission runtime 只有一个 owner，因此不同 session 可以安全地挂载不同的完整 preset。直接调用适配器时仍保留之前的模型工具默认值；需要只索引而不提供模型工具的 deployment 必须明确设置 host 模式。

## Testing

已发布的 Web composition e2e 覆盖 host 空工具层、平台相关 shell、完整 preset 目录、同时使用多个 preset 的隔离、子 agent composition、product overlay 与用户创建的 preset 副本。适配器和 base bundle 测试覆盖有 scope 工具清理以及禁用的 host 条目。Windows 上的 host build 与聚焦测试均已通过。
