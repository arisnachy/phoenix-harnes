# Agent Note: 使用 ASK 给予实用临床指导

Status: implemented

[English](2026-10-20-clinical-actionable-guidance.md) | 中文

## Problem

Phoenix 已能保存临床病史，但在常见症状的回答中有时只有转诊建议，没有鉴别诊断、非处方药、自我护理或随访方案。

## Decision

标准 Kira 与 Max 预设在医学问题时加载 clinical-guidance 技能，提出有依据的可能诊断、适当的生活措施、符合禁忌筛查的 OTC 方案、随访及具体危险信号。复用 ASK 敏感信息保护与可选纵向记录。

## Alternatives considered

全局加载医学指导影响其他任务；固定计算器容易造成虚假确诊；只转诊的答复不够实用。

## Consequences

指导不能代替临床诊断与处方，仍需结合患者实际信息和可信来源；不会自动写入病历。

## Testing

增加预设测试检查技能内容与安全限制。正式处理真实患者信息前仍需互动测试。
