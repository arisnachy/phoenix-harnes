# Agent Note：不伪造导出结果的持久化 Canva 视觉制作

Status: implemented

[English](2026-10-20-phoenix-design-intelligence.md) | 中文

## Problem

此前视觉制作缺少统一、可持久保存的凭据，无法可靠区分 MCP 生成请求、已保存的 Canva 设计和真正导出的文件。Canva 可用工具也会随账号与权限而变化。把 Canva 链接当作已完成的 PDF 会误导用户，还可能在执行中断时丢失工作。

## Decision

scripts/phoenix-design-intelligence.mjs 提供零额外依赖的 CLI，用于识别设计意图、检查不含密钥的 MCP 工具清单，以及保存持久的任务记录。CLI 分别记录 Canva 设计 ID 与 URL、导出文件副本，并对文件扩展名、文件签名、大小和 SHA-256 进行检查。后续检查可以识别丢失或被修改的文件。

Kira 通过 phoenix-design-intelligence 技能调用真实 MCP 工具，也可以使用已授权的本地图像生成与导出工具。漫画、出版、科研和商业引擎继续维护角色连续性、原始数据、发布和授权。CLI 不更改通用代理循环，不直接调用 Canva API，也不会假装存在未提供的导出工具。

## Alternatives considered

**构建与 Canva 紧密绑定的独立产品引擎。** 未采用，因为这会重复图书、漫画、课程和商业引擎的功能，削弱统一任务路由。

**将 ready 状态视为完整授权。** 未采用，因为服务器就绪不证明特定权限、Pro 功能、积分余额或素材许可。

**将 Canva URL 视为已经下载的文件。** 未采用，因为链接、异步任务与真实本地文件提供的证据不同。

## Consequences

视觉任务现在拥有可恢复的任务 ID、按能力选择的计划和实际文件完整性凭据，且不需要保存凭证或消费资金。视觉质量、内容准确性、Canva 权限、付费额度、完整导出验证、发布授权与真实端到端测试仍需单独确认。PDF 签名有效不代表达到印刷标准，规划也不等于已经调用 MCP 工具。
