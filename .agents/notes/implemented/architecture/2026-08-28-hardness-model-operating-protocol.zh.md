# Agent Note: HARDNESS model operating protocol

Status: implemented

[English](2026-08-28-hardness-model-operating-protocol.md) | 中文

## Decision

PHOENIX 为受 HARDNESS 管理的操作提供一个确定性的模型可见生命周期：`inspect`、`resolve`、`plan`、`approve`、`execute`、`verify`、`present` 和 `audit`。`@deepseek-ai/dsh-hardness` 负责可序列化的 protocol 类型、评估器和 guide renderer。`@deepseek-ai/dsh-hardness-adapters` 以 `hardness:operating-protocol` 的名称将 guide 安装到规范的 system-prompt service。

评估器只接受已观察到的 route、approval、execution、verification、presentation 和 evidence 状态。它返回下一步、明确的结果、允许的操作、禁止的操作和原因。它不会执行 tool、授予 permission、打开 connector 或携带 credential。

## Safety rules

未知和缺失的 route 会停留在 resolution。route 声明权限时，待处理的 approval 会停留在 approval。带有任何非空声明权限列表的 `not-required` approval 状态会产生 policy 冲突。执行或验证失败不能推进到 presentation、audit 或成功声明。没有声明权限的 route 可以先记录无需 approval，然后 dispatch。

## Verification

HARDNESS protocol 测试覆盖未知和缺失 route、approval 顺序、permission policy 冲突、从 execution 到 audit 的推进、验证失败、稳定渲染、无可执行值以及可逆的 prompt section 注册。Windows checkout 上的 HARDNESS 和 adapter package typecheck 已通过。

## Consequences

即使选择的 provider 不同，模型也会收到相同的生命周期词汇。protocol 是 guidance 和 evaluation，而不是 execution authority；规范的 tool runtime、permission broker、sandbox policy、artifact runtime 和 session persistence 仍保持各自现有的 authority。

该 adapter 还监听 `tools/change`，因此 connector 发布或撤回 tool 时，HARDNESS projection 会更新且不会重复注册。内部 `hardness_run` tool 会被排除在 projection 之外。
