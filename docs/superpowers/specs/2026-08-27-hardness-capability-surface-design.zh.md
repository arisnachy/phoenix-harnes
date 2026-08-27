# HARDNESS Capability Surface 设计

[English](2026-08-27-hardness-capability-surface-design.md) | 中文

## 目标

将已验证的 HARDNESS route 决定转换为可序列化的 UI 声明，让现有 PHOENIX slots 安全预览，不创建第二个 renderer，也不授予执行权限。

## 合约

`CapabilitySurface` 包含稳定 id、原始 need、capability id/version、modality、输入输出标签、声明的所需权限和验证状态。不包含函数、凭据、workspace mutation、sandbox handle 或可执行 payload。

只有 `route` 结果可以生成 surface；`missing` 和 `unknown` 不会生成可渲染 surface，并保留原因。相同 atlas snapshot 与 route options 必须产生稳定结果。

## 集成边界

HARDNESS adapter 通过现有 service 暴露 surface 推导；client consumer 将可选 preview 注册到 `dsh-client-ui-renderer` 与 `dsh-client-ui-workspace` 拥有的 typed slots。workspace registry 仍是 workspace 记录和 mutation 的唯一 authority，renderer 仍是渲染 authority。

preview 可以展示输入、输出、modality、验证状态和所需权限。任何未来 action 都必须通过现有 Permission Broker 的显式 approval boundary，不得在 surface 中隐含 callback。

## 验证

覆盖 route-to-surface projection、稳定序列化、拒绝 `missing`/`unknown`、无可执行字段、权限可见性、slot teardown，以及 route → surface → slot 集成 fixture。

## 后续范围

实际 tool 执行、视觉渲染、generative action 执行、workspace mutation、sandbox grants、acquisition/build、Lab Mode 和 self-improvement 保持独立阶段。
