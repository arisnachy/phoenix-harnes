# `@deepseek-ai/dsh-hardness-adapters`

[English](README.md) | 中文

将 PHOENIX 现有 tools 与 skills 的 metadata 投影到 HARDNESS Tool Atlas。

适配器不会执行 tools、加载 skill 正文或授予权限；每个源 registry 仍保留其 authority。

## Model Experience

模型可以看到声明式 capability catalog 及其 compatibility 状态，但执行仍由 HARDNESS 控制层和 PHOENIX 的规范 registry 负责。

## Known Limitations and Deferred Work

- PHOENIX 默认组合和自动获取将在 atlas contract 稳定后接入。
