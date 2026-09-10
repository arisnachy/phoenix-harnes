# Agent Note: 共享本地附件发布和读取 helper

Status: implemented

[English](2026-09-08-shared-attachment-publication-and-read-helpers.md) | 中文

## Problem

图像和任意文件存储重复了完整的原子发布流程，读取函数也重复了字节加载和错误归一化。独立副本可能在验证、持久性、清理或取消行为上逐渐产生差异。

## Decision

[`store.ts`](../../../../packages/attachment/attachment-local/src/store.ts) 负责私有的 `commitPreparedAttachment()` 和 `readStoredAttachment()` helper。发布 helper 验证摘要和字节数，建立持久目录，以仅所有者权限写入，执行 fsync，验证硬链接去重，并清理暂存文件；图像或文件类型参数保留各自的公开诊断消息。

读取 helper 将调用方的 signal 传给 `readFile()`，保留 `ENOENT` 和读取失败映射，并在读取后检查取消状态。公开的图像和文件函数继续保持原有引用检查顺序，并在共享读取之后执行各自的媒体元数据或字节验证。

## Verification

附件存储和公开服务的定向测试已通过：2 个文件、20 项测试通过，另有 1 项平台专属测试跳过。`store.ts` 的定向 Oxlint、无输出 TypeScript 和 jscpd 检查已通过。

## Alternatives considered

**抑制重复代码报告：**拒绝，因为 ignore 会隐藏存储完整性和清理逻辑未来产生的差异。

**公开一个通用附件操作：**拒绝，因为图像元数据验证和任意文件字节验证属于不同的公开约定。

**保留并行的私有副本：**拒绝，因为共享发布和读取规则仍会面临逐渐产生差异的风险。

## Consequences

未来对共用附件发布、文件系统诊断或读取取消逻辑的变更各自只有一个负责 helper。图像规范化和元数据检查、任意文件准入和字节检查、内容 hashing、原子硬链接发布、回滚以及持久目录同步仍然有效。
