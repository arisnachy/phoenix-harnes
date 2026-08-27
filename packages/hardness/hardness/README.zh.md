# `@deepseek-ai/dsh-hardness`

[English](README.md) | 中文

PHOENIX HARDNESS 的 provider-neutral 能力 registry 与 Tool Atlas 服务。

它记录声明的 capability descriptor、所需权限、生命周期状态和验证证据；不会授予权限、保存凭据或替换 tools 与 skills registry。

## Known Limitations and Deferred Work

resolver 与内存提供方是第一层基础；持久化、source adapter、外部获取、视觉渲染和生成式 UI 属于后续消费者与提供方。
