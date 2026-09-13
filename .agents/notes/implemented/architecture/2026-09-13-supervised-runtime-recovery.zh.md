# Agent Note：将 PHOENIX 恢复能力放在 Host 进程之外

Status: implemented

[English](2026-09-13-supervised-runtime-recovery.md) | 中文

## 问题

Windows Web Host 已经运行在 `phoenix-windows-supervisor.mjs` 之下，但除非存在自动更新重启标记，否则 supervisor 会把普通 Host 退出视为终止条件。因此，当模型或运行时为了应用修复而停止 Host 时，也可能同时结束原本应该负责重新启动 PHOENIX 的唯一启动路径。启动关键配置修改也存在类似故障模式：无效的 `package.json`、`cordis.patch.yml`、插件组合或生成的 Codex patch，可能只有在 live Host 已停止后才被发现。

完成 Judge 每一轮也都会从新的子上下文启动。持久 session 中虽然保存了之前的 Judge findings 和 completion-gate evidence，但新的 Judge prompt 没有明确携带这些审查历史，因此后续轮次可能不会继续执行前一轮尚未解决的修正要求。

## 决策

Windows supervisor 拥有 Host 可用性的控制权。默认情况下，意外的 Host 退出必须可重启；只有操作员发送的 `SIGINT` 或 `SIGTERM` 才会标记 supervisor 自身需要退出。更新激活仍然是独立的受监督路径，并继续保留现有的 clean-checkout 和 prepared-candidate 验证。

运行时重启请求通过 `scripts/phoenix-safe-restart.mjs` 发出。请求写在 Host 进程之外，supervisor 会在当前 Host 仍然存活时运行不启动应用的 `web --dump-config` preflight。preflight 失败时，重启会被拒绝，诊断结果返回给调用者，同时不会停止 Host。preflight 成功后，stop/start 的所有权才转交给 supervisor。

`scripts/phoenix-config-guard.mjs` 会在稳定运行窗口之后，对启动关键 profile 配置保存带 fingerprint 的、非 secret 的 last-known-good snapshot。如果修改后的配置通过组合 preflight，但重新启动的 Host 仍在启动期间失败，supervisor 会恢复该 snapshot 并再次启动。credential store 不会复制到恢复 snapshot 中。

完成 Judge 现在会针对精确的 goal id 和 revision，从之前的 `goal/judge` 与 `goal/completion-gate` events 重建有界历史。每个新的 Judge 都会收到原始 objective、之前的 verdict、findings、required changes、gate checks、evidence ledger 和 artifact fingerprints，并且在返回 `pass` 之前必须验证之前的每一项 required change 确实已经解决。

## 不变量

Host 永远不能拥有唯一能够重新启动自身的最后一个进程。模型可以停止或导致 Host 崩溃，而不会终止 supervisor。操作员关闭仍然是明确行为，不会造成自动重启循环。

运行时配置可以自由编辑，但 intentional restart 在旧 Host 仍存活时完成 Web profile 组合解析之前不得被接受。只有重新启动后的 Host 持续运行通过稳定窗口，并且相同的 boot-free preflight 成功后，该配置才能提升为 last-known-good。

Judge 的决定针对完整 mission revision，而不仅仅针对最近一次 builder turn。尚未解决的 findings 和 required changes 必须持续作为审查输入，直到证据证明它们已解决。

## 后果

在持久 supervisor 下，直接终止 Host 会自动恢复。对于有意重启，推荐使用 safe-restart 请求，因为它能够在产生停机之前拒绝无效配置。如果配置在语法与组合层面有效但运行时仍然有问题，只要已经存在之前的 last-known-good snapshot，就可以自动恢复。

机器第一次启动时没有之前的 snapshot 可恢复。完成第一次稳定运行窗口后，之后所有启动关键配置修改都会自动获得 rollback 保护。

## 测试

`scripts/phoenix-windows-supervisor.spec.ts` 覆盖持久 Host 重启、操作员关闭、stop 之前的 preflight，以及 last-known-good rollback 要求。`scripts/phoenix-config-guard.spec.ts` 覆盖 boot-free Web-profile 验证、非 secret snapshot 范围、fingerprint 恢复以及 restart request/result handshake。`packages/goal/tool-goal/tests/judge-history.spec.ts` 覆盖原始 objective、之前 findings 和之前 required changes 向后续独立 Judge 轮次的传递。提升之前由 CI 提供 Windows-native、Wine、static、coverage、snapshot、artifact 与 compatibility matrix 验证。
