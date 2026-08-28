# `@deepseek-ai/dsh-hardness-atlas-json`

[English](README.md) | 中文

HARDNESS Tool Atlas snapshot 的 host-side 原子 JSON 持久化提供方。

它验证 `formatVersion`，在写入中断时保留最后一个有效文件，并区分损坏与空 inventory；不会保存凭据或授予权限。

## Model Experience

### 持久化 Atlas snapshot

#### What the model sees

持久化层不会直接面向模型；消费者可以暴露稳定 snapshot metadata，例如 `formatVersion`、capability descriptor 与验证 evidence，而不会暴露底层文件或 secret。

#### Token effect

保存或加载 Atlas 本身不会增加模型 token；只有其他消费者把选定 snapshot 数据渲染到模型 context 时才会增加 token。

#### KV Cache effect

持久化本身对 cache 中性；只有渲染后的 capability 或 evidence 数据变化时才会影响模型侧 KV cache 复用。

## Known Limitations and Deferred Work

- 与 `HardnessRegistry` 生命周期的自动组合继续保持为独立于此 storage primitive 的上层能力。
