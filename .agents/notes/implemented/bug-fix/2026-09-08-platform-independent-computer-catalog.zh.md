# Agent Note: 跨平台计算机工具目录

Status: implemented

[English](2026-09-08-platform-independent-computer-catalog.md) | 中文

## 问题

仅限 Windows 的注册使开发者主机与 Linux CI 生成的工具目录不同。

## 决策

PowerShell 包导出纯计算机工具定义工厂。运行时注册仍仅限 Windows；目录生成器在其他平台显式注册该定义，使 Linux 与 Windows 生成相同的参考文档。构造定义不执行桌面操作，也不增加运行时权限。

## 考虑过的替代方案

在 Windows 上删除计算机条目会遗漏受支持的能力。在所有运行时注册它会宣告不可用的操作。按平台生成不同参考文档会使 CI 新鲜度检查依赖作者的主机。工厂将文档生成与运行时可用性分离。

## 验证

目录测试要求恰好一个计算机条目并注明 Windows 限制。现有计算机工具测试保留执行验证。Linux 生成仍需远程 CI 验证。

## 后果

目录生成在所有主机上包含 Windows 能力，而运行时注册保留平台限制。
