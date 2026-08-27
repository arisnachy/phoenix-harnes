# `@deepseek-ai/dsh-hardness-atlas-json`

[English](README.md) | 中文

HARDNESS Tool Atlas 的 host-side 原子 JSON 持久化提供方。

它验证 `formatVersion`，在中断写入时保留最后一个有效文件，并区分损坏与空清单；不会保存凭据或授予权限。

## Known Limitations and Deferred Work

与 `HardnessRegistry` 生命周期的自动组合以及工具适配器将在后续阶段接入。
