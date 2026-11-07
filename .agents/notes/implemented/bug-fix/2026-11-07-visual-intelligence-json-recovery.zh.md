# Agent Note: Visual Intelligence 的 JSON 恢复

Status: implemented

## Problem

2026-11-07 的一次 PHOENIX 实际响应把 `visual_intelligence` JSON 围栏显示成原始代码，而不是交互式界面。原因之一是模型生成 `metrics[*].status:"normal"`，严格协议只接受 `"neutral"`。通用解析器还未将 `visual_intelligence` 纳入错误提示、裸 JSON 识别及流式不完整结果隐藏流程。稍后提供正确格式的请求则能够成功渲染。

## Decision

在完整、严格校验前，仅修复**确定性、低风险语义别名**，例如 normal→neutral、数值型指标值→字符串，以及常见西班牙语视图名称。不能删除未知属性，也不能接受不安全 URL、脚本、任意事件处理器、不支持的状态或错误的数据数组。别名查询使用对象自身属性，不访问原型链。

统一 `visual_intelligence` 的围栏解析、错误提示、裸 JSON 检测和流式未完成结果隐藏。保持旧有卡片语义不变。自动视图仅在有匹配数据时遵循标题意图；混合指标与图表或表格默认打开 dashboard，并允许切换。为 Kira Max 补充准确的 schema 和界面输出要求。

## Alternatives considered

**允许任意 JSON/HTML。** 拒绝，因为无法保持安全边界。

**继续以代码显示错误的 `visual_intelligence`。** 拒绝，因为无法恢复简单的模型输出错误。

**自动无限重试模型。** 拒绝，因为可能造成循环、额外消耗、虚假数据或重复外部动作。

## Consequences

模型的 `status:"normal"` 不再导致整个界面变成代码块。危险或无法识别的 JSON 转为可读提示，而不是原始 JSON。模型仍可能输出无效或语义错误的数据，任何客户端都无法保证永远正确。测试覆盖与截图一致的输入、围栏和裸 JSON、流式输出、视图选择及恶意内容。完整构建与聊天回归由 CI 验证。
