# Agent Note: 敏感 ASK 与加密临床时间轴

Status: implemented

[English](2026-10-20-ask-clinical-longitudinal.md) | 中文

## Problem

ASK 超时后默认选择选项，不能代表患者陈述或知情同意。临床随访需要独立加密时间轴，但 Phoenix 必须保持通用性。

## Decision

敏感 ASK 问题超时后保持未回答。仅配置本地密钥时才注册临床工具。该工具可创建匿名标识、通过 ASK 请求明确授权、使用 AES-256-GCM 存储含来源与日期的事件，并只比较相同指标、相同单位的数值。

## Alternatives considered

单独的医疗表单重复 ASK；默认同意存在风险；明文 JSON 不安全；始终注册临床工具会增加非医疗任务成本。

## Consequences

功能以明确配置为前提，没有密钥便拒绝。会话日志仍可能含有健康信息，在真实部署前需建立保留、访问控制、密钥轮换与患者删除流程。此功能不代表诊断认证，也不包含 OCR 或 FHIR 导出。

## Testing

测试覆盖 ASK 超时、数据转发、加密、患者隔离、日期、数值比较和错误密钥。正式部署需隐私和临床复核。
