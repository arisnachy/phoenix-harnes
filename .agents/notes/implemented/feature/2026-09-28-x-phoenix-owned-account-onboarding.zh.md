# Agent Note: Phoenix-owned X account onboarding

Status: implemented

[English](2026-09-28-x-phoenix-owned-account-onboarding.md) | 中文

## Problem

Phoenix 可以通过官方 X MCP bridge 连接用户的 X 账户，但一个长期自主运行的助手还需要独立的公共身份，避免把 Phoenix 的行为与用户本人混在一起，也避免从错误账户发帖。X MCP 本身不能创建 X 账户。X 的账户创建属于浏览器注册流程，并且可能要求 email/SMS 验证、CAPTCHA、MFA 或其他必须由人完成的验证。

如果只保留一个 connector identity，也更容易把动作路由到错误的 OAuth 用户。

## Decision

Phoenix 把 X 视为两个独立 identity：

- `x-api` 是用户的 X identity。
- `x-api-phoenix` 是 Phoenix 自己的 X identity。

两者可以共用 Phoenix vault 中同一套 X developer application credential，而 xurl 通过 username 选择已授权的 X 用户。不同的 managed MCP server name 会把 runtime tool 与 lifecycle state 分开。

当 `x_mcp_activate` 以 `identity="phoenix"` 调用、并且 Phoenix 自有身份尚未配置时，不再因为缺少 username 直接失败。完成一次明确批准后，它返回 `setup-required`，并延迟注入一条 plugin instruction，让 agent 通过 Phoenix Computer Use 打开 `https://x.com/signup` 并继续官方注册流程。

Computer Use 可以推进普通注册 UI，但遇到 email/SMS code、CAPTCHA、MFA、重大条款变化确认或其他 X 明确要求人完成的验证时必须停止并交给用户。setup 期间不得发帖、关注、发送 DM 或进行其他社交动作。

注册成功后，Phoenix 检查最终 profile 得到 username，然后再次调用 `x_mcp_activate`，传入 `identity="phoenix"` 与该 username。随后 managed connector 固定为 `x-api-phoenix`。如果该 connector 已经配置，后续不带 username 的激活会直接复用，不会重新启动注册。

## Alternatives considered

**把用户的 X 账户当成 Phoenix 自己的公开身份。** 被拒绝，因为这会混淆所有权、权限、审计链，并增加误发风险。

**完全通过 API/MCP 创建账户。** 被拒绝，因为 X account creation 不是 MCP/API capability，而且 signup flow 可能要求 human verification。

**自动绕过 verification challenge。** 被拒绝。X 要求人完成的验证必须保留为明确的人类 checkpoint。

**只用一个 `x-api` MCP 并隐式切换用户。** 被拒绝，因为独立 managed server identity 能提供更清楚的授权边界，并让 tool provenance 可见。

## Consequences

Phoenix 可以拥有持久的 X 自有身份，同时把用户账户保留为另一个独立授权域。一次性的账户创建仍依赖 X 官方 signup 与 human verification。完成后，xurl/OAuth 可以持续复用 Phoenix identity，不需要反复输入 credential；model-facing action 也能明确区分 `x-api` 与 `x-api-phoenix`。
