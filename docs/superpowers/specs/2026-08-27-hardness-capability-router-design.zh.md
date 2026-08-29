# HARDNESS 声明式能力路由器设计

[English](2026-08-27-hardness-capability-router-design.md) | 中文

## 目标

增加 provider-neutral router，将声明的 `CapabilityNeed` 转换为诚实的路由决定；不执行 tools、不获取软件、不授予权限，也不替换现有 registry。

## 合约

`CapabilityRoute` 包含原始 need、选择的 capability、modality、所需权限、候选 id 和拒绝原因。初始 modality 为 `native`、`visual`、`workspace`、`sandbox` 和 `generative-ui`，词汇可扩展。

结果区分 `route`、`missing` 和 `unknown`。只有当前已验证的 capability 与请求 modality 相交时才返回 `route`；权限始终只是声明。

## 选择规则

router 委托 HARDNESS resolver，并按请求偏好选择 modality；不会把 `missing` 或 `unknown` 静默转换为 `route`。

所需权限只是声明。

## 生命周期与集成

router 是 `@phoenix-ai/dsh-hardness` 中的普通消费者，根据当前 atlas 推导结果，不拥有独立持久化。

## 边界

router 是 HARDNESS 的消费者，没有独立持久化，也不调用 Permission Broker、sandbox、tool、视觉渲染器、workspace 或 acquisition provider。执行与自动获取属于后续阶段。

## 验证

覆盖 modality 选择、mismatch、unknown kind、权限上下文、确定性排序和 Loader 组合，并保持 HARDNESS 既有 suite、typecheck 与 lint 通过。
