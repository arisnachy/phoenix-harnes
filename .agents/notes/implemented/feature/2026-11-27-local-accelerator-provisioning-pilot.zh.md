# Agent Note: Windows 本地加速器部署试点

Status: implemented

[English](2026-11-27-local-accelerator-provisioning-pilot.md) | 中文

## Problem

即使存在兼容的加速器，Phoenix Local 随附的受管运行时仍仅支持 CPU。不检查资源就安装所有加速器并运行基准测试，可能耗尽存储空间或干扰本地推理。

## Decision

受管 PowerShell 更新成功后，会启动独立的用户级 llama.cpp b10964 部署进程。该进程检测状态正常的 PCI 图形适配器，在 PHOENIX_HOME（默认为 ~/.phoenix）下暂存兼容候选项，验证固定的 SHA-256 摘要，并要求能够枚举计算设备。当按需模式选中已安装的受管 GGUF 模型且未观察到本地推理进程时，部署进程使用 256 个提示词 token、64 个生成 token、三次重复测试和请求的 8/16/99 个 GPU 层，对比已安装的 CPU 运行时与兼容候选项。每次测试前检查可用 RAM，并将每个子进程的运行时间限制为两分钟。没有 CPU 基线时，在第一个可用候选项处停止部署。

排序拒绝没有正向层卸载诊断证据的 GPU 测量结果，且仅在估算工作负载加速比达到 1.10 时才选择 GPU，否则保留 CPU。部分比较标记为未完成。设置 PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL=0 可禁用部署。状态和 installer.log 位于 local-models/accelerators/b10964 下；node scripts/phoenix-local-accelerators.mjs --status 读取最近记录的结果。

## Alternatives considered

**选择第一个枚举出的加速器。** 设备枚举不能证明速度，因此校准改为比较等效工作负载。

**在更新期间替换 CPU 运行时。** 拒绝该方案，以便在验证尚未完成时保留现有可用的推理路径。

## Consequences

不安装系统驱动程序。模型文件、Ollama、Orión 和当前推理运行时保持不变。生产管理器尚未使用校准结果。进程检查不能保证与并发启动互斥，崩溃的部署进程可能留下需要确认后手动清理的锁。Windows 压缩包解压、实际设备使用、基准测试诊断、内存安全、生产生命周期集成和推理期间的 CPU 回退仍为发布门槛。
