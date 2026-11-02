# Agent Note: 自动问题决定继续任务

Status: implemented

[English](2026-08-31-automatic-question-continuation.md) | 中文

## 问题

一分钟问题截止后选择推荐项时，答案与人工答案使用相同的 wire 格式。因此模型可能把这个决定当成工作结束，而监督器也没有明确的信号区分超时决定与任务完成。

## 决策

截止时间产生的答案会通过 host、浏览器、服务和面向模型的工具结果携带 `automatic: true`。人工答案保持原有格式。问题工具和每个 goal continuation prompt 都明确说明：这个标记只解决当前决定，绝不会完成、取消或阻塞活动任务。选中的推荐项仍然使用确定性且优先安全的策略。

## 考虑过的替代方案

**把超时当成取消。** 否决，因为缺少人工回应不能证明请求的目标失败。

**不标记答案，只依赖 prompt 文案。** 否决，因为面向模型的工具结果必须在跨轮次和 replay 中携带决定来源。

**自动批准所有无人回应的确认。** 否决，因为高影响和含糊的操作仍须使用现有的保守回退策略。

## 后果

Phoenix 可以使用推荐项而不必无限等待，同时活动任务仍可继续执行并改变策略。标记会持久化在工具结果中，因此恢复 transcript 后仍保留选择原因。它不会削弱 judge、证据或完成门禁。

## 测试

聚焦的 user-question、tool、host-proxy、UI-composer、plan-review 和 goal-driver 测试均已通过。工具回归测试确认 `automatic: true` 不会设置 `concludesTurn`；host 和 UI 回归测试确认标记在截止时间产生。
