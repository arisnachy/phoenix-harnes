# Agent Note：将 Code Mode 子调用的地图制品交付到聊天

Status: implemented

[English](2026-10-20-code-mode-scene-map-delivery.md) | 中文

## Problem

`phoenix_scene_map` 返回 `artifactId`，但 Code Mode 会丢弃子调用的 `presentationMeta`。持久化的 `tool/code-dispatch` 事件只有文本，因此聊天无法生成 `hardness-artifact` 节点。同时，地图工具会调用 `concludeTurn()`，Code Mode 会继续转发，导致没有最终回复的工具结束回合。文字中的地图警告并不能证明 React 渲染失败：制品可能从未抵达 UI。

## Decision

为工具声明增加可信、显式的 `nestedPresentationMeta` 开关，默认仍不暴露子工具展示元数据。注册表只为选择加入的工具验证并快照子调用展示数据。Code Mode 将这些数据写入可重放的 `tool/code-dispatch` 事件，但不暴露给模型代码，也不附加到外层 `run_code` 结果。聊天投影器识别成功的子调用并创建与直接 `tool/result` 相同的原生视图节点。虚构和真实地图发布器均选择加入，且不再调用 `concludeTurn()`，允许 Kira 给出最终答复。

## Alternatives considered

**强制所有代理使用原生工具。** 不采用：Phoenix 是通用系统，Code Mode 必须得到支持。

**暴露所有子工具的展示元数据。** 不采用：其他复合工具既有的隐私约束必须保持。

**不断重试地图工具或打开 MiniBrowser。** 不采用：这不能解决元数据丢失或最终回复缺失的问题。

## Consequences

原生工具与 Code Mode 都能以持久事件交付地图制品。测试涵盖选择加入和默认隔离、聊天回放及回合终止行为。制品发出不等于已经取得视觉截图或证实用户实际点击地图。
