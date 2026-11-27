# Agent Note: Windows 本地加速器部署试点

Status: implemented

[English](2026-11-27-local-accelerator-provisioning-pilot.md) | 中文

## Problem

即使存在兼容的加速器，Phoenix Local 随附的受管运行时仍仅支持 CPU。不检查资源就安装所有加速器并运行基准测试，可能耗尽存储空间或干扰本地推理。

## Decision

受管 PowerShell 更新成功后，会启动独立的用户级 llama.cpp b10964 部署进程。该进程检测状态正常的 PCI 图形适配器，在 PHOENIX_HOME（默认为 ~/.phoenix）下暂存兼容候选项，验证固定的 SHA-256 摘要，并要求能够枚举计算设备。当按需模式选中已安装的受管 GGUF 模型且未观察到本地推理进程时，部署进程使用 256 个提示词 token、64 个生成 token、三次重复测试和请求的 8/16/99 个 GPU 层，对比已安装的 CPU 运行时与兼容候选项。每次测试前检查可用 RAM，并将每个子进程的运行时间限制为两分钟。没有 CPU 基线时，在第一个可用候选项处停止部署。

排序拒绝没有正向层卸载诊断证据的 GPU 测量结果，且仅在估算工作负载加速比达到 1.10 时才选择 GPU，否则保留 CPU。部分比较标记为未完成。设置 PHOENIX_LOCAL_ACCELERATOR_AUTOINSTALL=0 可禁用部署。状态和 installer.log 位于 local-models/accelerators/b10964 下；node scripts/phoenix-local-accelerators.mjs --status 读取最近记录的结果。

受管 GGUF 启动时，Host 接受与同一模型标识及固定安装凭据匹配的近期校准结果。Host 尝试使用测得的层数和线程设置，启动失败时回退到 CPU。加速进程退出后，当前 Host 后续启动将禁用该配置；不会重放正在进行的请求。运行上下文按物理 RAM 总量设定，保留独立的原生上限和显式上下文覆盖选项。现有保守的可用内存准入检查保持不变。

设备准入读取固定版本 llama.cpp 设备清单中的可用及总内存。校准选择已枚举的设备，并仅测试符合保守权重内存阈值的层数。Host 在启动前重新检查同一设备及其容量，显式传递设备名称，请求自动 Flash Attention，并为未设置的参数指定 1024 MiB 的内存适配目标。这些阈值不是实际峰值内存测量值；显式设置的层数不保证能够装入设备。专用 Windows CI 工作流检查策略、PowerShell 语法及固定版本的 CPU 二进制文件，而非物理 GPU 吞吐量。

## Alternatives considered

**选择第一个枚举出的加速器。** 设备枚举不能证明速度，因此校准改为比较等效工作负载。

**在更新期间替换 CPU 运行时。** 拒绝该方案，以便在验证尚未完成时保留现有可用的推理路径。

## Consequences

不安装系统驱动程序。模型文件、Ollama 和 Orión 保持不变。更新器不会替换正在运行的推理进程。进程检查不能保证与并发启动互斥，崩溃的部署进程可能留下需要确认后手动清理的锁。Windows 压缩包解压、实际设备使用、基准测试诊断、内存安全、真实硬件上的生产启动和 CPU 恢复仍为发布门槛。
