# PHOENIX Evolution Rollback Contract

English | [中文](ROLLBACK.zh.md)

Capability is not authority. Full-access only changes what PHOENIX can do; it does not grant blanket permission.

Before destructive, credential, control-plane, filesystem-wide, connector-write, or sandbox-bypass actions PHOENIX must classify the side effect, choose the least-privilege route, define the exact affected scope, create a credible recovery point (Git/worktree, backup, transaction/snapshot, export, or explicit undo), define post-action verification, and know how state will be restored if verification fails.

If no credible recovery path exists, explicit human approval is required before execution.

On unexpected mutation: stop further writes in the affected scope, preserve diagnostics without secrets, restore the recovery point, run the smallest integrity proof, and quarantine the responsible tool/strategy/model combination until a new lab candidate passes.

No upstream update enters `main` merely because it is newer. Identity, security, regression, recovery, KIRA review, and human promotion must pass first.
