# PHOENIX supervisor/config/judge resilience

## Goal

Make restart ownership survive the Host, prevent invalid configuration from taking down the live harness, automatically recover from early boot failure, and keep the completion Judge aware of the original user request plus previous review findings across repair rounds.

## Required behavior

1. The external Windows supervisor owns model-requested restart. The model writes a control request; it does not kill the Host itself.
2. Before an intentional model-requested restart, PHOENIX validates the effective web profile with a boot-free config preflight while the current Host remains alive.
3. A healthy Host checkpoint becomes the last-known-good profile configuration. If the next Host exits before the health window, the supervisor restores that checkpoint and relaunches once instead of leaving PHOENIX dead.
4. The Judge prompt contains durable review history for the exact current goal revision: previous verdict summaries, findings, and required changes. The original objective remains authoritative.
5. Existing staged auto-update restart/rollback semantics remain intact.
6. Add `pnpm phoenix:restart` and `pnpm phoenix:preflight` as safe operator/model entry points.

## Verification

- `pnpm vitest run scripts/phoenix-windows-supervisor.spec.ts scripts/phoenix-supervisor-recovery.spec.ts packages/goal/tool-goal/tests/judge.spec.ts packages/goal/tool-goal/tests/judge-history.spec.ts`
- `pnpm run typecheck`
- PR CI before merge.
