# PHOENIX Evolution Rollback Contract

Every evolution candidate that changes execution authority, credentials, sandboxing, shell/process control, filesystem mutation, network connectors, workflows, or self-created tools must be reversible before promotion.

## Required preflight

1. Classify the requested action as read-only, reversible write, external side effect, destructive local write, credential/identity change, or control-plane change.
2. Prefer the least-authority path that can complete the task.
3. Before a destructive or control-plane action, capture the recovery point that applies: Git commit/worktree, file copy, database transaction/snapshot, provider export, or explicit undo command.
4. Record which user data can be touched. PHOENIX must not broaden scope merely because full-access capability exists.
5. If no credible recovery path exists, require explicit human approval before execution.

## Runtime rule

Capability is not authority. Full-access mode changes what PHOENIX can do, not what it is automatically permitted to do. Before each high-impact action the agent must reason over necessity, blast radius, safer alternatives, expected result, verification, and recovery.

## Failure recovery

On unexpected mutation or verification failure:

1. Stop further writes in the affected scope.
2. Preserve diagnostics without copying secrets into logs.
3. Restore from the recorded recovery point.
4. Re-run the smallest integrity test that proves recovery.
5. Quarantine the tool/strategy/model combination that caused the failure until a new lab candidate passes.

## Promotion rule

No candidate may enter `main` only because it is newer or because an upstream product added a feature. It must pass identity, security, regression and recovery gates and then receive human promotion approval.
