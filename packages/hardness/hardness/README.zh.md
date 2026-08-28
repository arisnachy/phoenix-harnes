# `@deepseek-ai/dsh-hardness`

[English](README.md) | 中文

PHOENIX HARDNESS 的 provider-neutral 能力 registry 与 Tool Atlas 服务。

它记录声明的 capability descriptor、所需权限、生命周期状态、验证证据和声明式 modality route；不会授予权限、保存凭据、执行 tools 或替换 tools 与 skills registry。

只有 resolver 返回当前可用的 capability，且其声明的 modality 与请求偏好相交时，才会选择 route。`unknown` 表示无法对 need 分类；`missing` 表示 need 已知但没有经过验证的 capability 与 modality 可以满足它。所需权限只会作为声明传给后续 broker，不会在此处授予。

`CapabilitySurface` 会把 route 投影为稳定的预览数据（`id`、输入、输出、modality、验证状态和声明权限）。它可序列化为 JSON，不包含 callback、凭据、sandbox handle 或 workspace mutation；missing 与 unknown 不会生成 surface。

## Model Experience

### Capability Atlas 元数据

#### What the model sees

消费者可以向模型暴露声明式 HARDNESS 字段，例如 `capabilityId`、modality、验证状态、输入、输出和声明权限；registry 本身不会暴露凭据或可执行 handle。

### Operating protocol

导出的 `renderHardnessProtocol()` 描述模型可见的生命周期 `inspect → resolve → plan → approve → execute → verify → present → audit`。导出的 `evaluateHardnessProtocol()` 根据当前 route、approval、execution、verification、presentation 和 evidence 观察结果生成一个可序列化的下一步。两个函数都不会执行 capability 或授予 authority；未解析、被拒绝、失败或未验证的工作仍保持阻塞状态。

#### Token effect

只有将选定 capability metadata 序列化给模型或安装 protocol guide 的消费者会增加 token；registry 本身不会自行挂载 prompt section。

#### KV Cache effect

只要 capability metadata、routing 或验证状态不变，稳定 descriptor 就保持良好的 KV cache 复用特性。

## Known Limitations and Deferred Work

- resolver 与内存提供方是第一层基础；持久化、source adapter、外部获取、视觉渲染和生成式 UI 属于后续消费者与提供方。
