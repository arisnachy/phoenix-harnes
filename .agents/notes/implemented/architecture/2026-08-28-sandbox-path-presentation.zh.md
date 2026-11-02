# Agent Note: 可读的 Windows 沙箱路径

Status: implemented

[English](2026-08-28-sandbox-path-presentation.md) | 中文

## Problem

Windows filesystem separator 在 sandbox guidance 中被渲染为 escaped JSON text，使模型更难阅读 path，同时没有改变它所表示的 policy。

## Decision

沙箱策略提示词将工作区和 PHOENIX 演进根目录显示为带引号的文件系统路径，而不会对 Windows 分隔符进行 JSON 转义。路径中的引号仍会被转义，因此 prose 保持明确。

## Verification

Windows HARDNESS sandbox-policy 测试通过，其中包括面向模型的自演进指导。这只改变提示词呈现；沙箱模式解析、受保护根目录和写入强制逻辑保持不变。

## Consequences

model-facing sandbox guidance 会显示可读的 quoted Windows path，同时 embedded quote 仍会 escaped。enforcement、protected roots 与 mode resolution 保持不变。

## Alternatives considered

改变 path resolution 或 normalize Windows separator 会把 presentation-only defect 变成 filesystem semantics 变化，并可能削弱 policy 与实际 path 的关系。
