# Agent Note: Windows 免费能力只读清单

Status: implemented

[English](2026-10-09-windows-free-capabilities.md) | 中文

## Problem

Phoenix 不能假定本地 Windows 运行环境、人工智能 API 或加速器均已可用。错误地将功能标记为就绪会导致执行失败、未经许可的下载和意外费用。

## Decision

Phoenix 提供按需运行的只读 JSON 清单命令 `pnpm run windows:capabilities`。该脚本只使用 Node 和系统自带的 Windows PowerShell，有限时地读取 Windows 版本、内存总量、显卡名称，以及 WinGet、WSL、Ollama、Foundry Local 和 PowerShell 7 命令是否存在；失败输出不会泄露错误详情。

受 supervisor 管理的 Windows Web Host 还会在启动时异步运行一次检测。`SystemPrompt` 将已核实的工具信息作为记录在会话日志中的动态上下文传递给 Kira，并说明何时适合选择 WinGet、WSL 或候选本地推理运行环境，以及何时保持当前已配置的模型。检测不阻塞启动或模型请求。这只是发现功能，并非自动安装、本地推理集成或新的工具授权。

Windows 原生通知、Windows AI API 和 Microsoft Execution Containers (MXC) 被明确标记为需要额外桥接、SDK 或硬件验证、或者更新运行环境。MXC 不作为强制依赖，因为它要求 Node 24 以上，而 Phoenix 仍支持 Node 22。

## Alternatives considered

**自动安装运行环境：** 不采用，因为安装涉及下载、硬件限制以及用户授权。

**将所有 Windows 11 功能标记为可用：** 不采用，因为系统版本和命令存在不能证明模型、GPU/NPU 或原生功能运行正常。

**为 MXC 升级整个 Phoenix 到 Node 24：** 不采用，因为独立适配器尚未验证，升级存在兼容性风险。

## Consequences

用户可以检查免费的本地先决条件，无需修改系统设置、读取密钥或拖慢 Phoenix 启动。该报告不代表授权、模型性能基准、已经可用的本地推理服务或已经完成的原生通知功能。

## Testing

单元测试验证非 Windows 跳过逻辑、系统版本边界、命令可用性、错误保护和硬件数据最小化。实际验收仍需在目标 Windows 电脑运行 `pnpm run windows:capabilities`。
