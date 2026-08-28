# Agent Note: 可读的 Windows 沙箱路径

Status: implemented

[English](2026-08-28-sandbox-path-presentation.md) | 中文

## Decision

沙箱策略提示词将工作区和 PHOENIX 演进根目录显示为带引号的文件系统路径，而不会对 Windows 分隔符进行 JSON 转义。路径中的引号仍会被转义，因此 prose 保持明确。

## Verification

Windows HARDNESS sandbox-policy 测试通过，其中包括面向模型的自演进指导。这只改变提示词呈现；沙箱模式解析、受保护根目录和写入强制逻辑保持不变。
