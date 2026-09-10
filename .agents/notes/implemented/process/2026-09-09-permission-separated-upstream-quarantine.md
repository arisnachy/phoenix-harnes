# Agent Note: Permission-separated PHOENIX upstream quarantine

Status: implemented

English | [中文](2026-09-09-permission-separated-upstream-quarantine.zh.md)

## Problem

The scheduled and manual upstream intake combined public ref resolution, untrusted source execution, branch publication, and pull-request creation under one workflow-level write permission.

## Decision

`.github/workflows/phoenix-upstream-quarantine.yml` uses a workflow-level empty permission set and grants each job only its required permission.

`resolve-upstream` performs anonymous `git ls-remote` calls for the PHOENIX `stable` base, the public upstream `main` ref, and the derived candidate branch. The branch name contains both abbreviated SHAs as `quarantine/phoenix-<base>-<upstream>`, so a newer PHOENIX base cannot reuse an older candidate. Resolution emits full commit SHAs and never checks out or writes a ref.

`validate-candidate` has `permissions: {}` and no credential-bearing checkout. It reconstructs the candidate from the two emitted SHAs, rejects credential environment variables, disables package lifecycle scripts during installation, and records the merged tree identity. Actions used by the workflow are pinned to full commit SHAs.

Before the static gate runs, validation extracts `scripts/phoenix-quarantine-verify.mjs` from the immutable workflow commit. That verifier requires every base-owned package script and executable automation file under `scripts/` to remain byte-for-byte identical. The candidate therefore cannot replace the acceptance command with a successful no-op. Automation changes require a separate PHOENIX review; product source changes continue through the quarantine gate.

When the upstream tree is already present in the PHOENIX base tree, validation records that no candidate is needed and publication stops without creating an empty branch.

`publish-candidate` is the only job with `contents: write`. It repeats the merge from the immutable SHAs and requires its tree to equal the tree produced by credential-free validation. It pushes without force or tag publication. If the candidate ref already exists, publication accepts it only when its tree matches the validated tree exactly.

`open-review` is separate from the branch push and has only `pull-requests: write`; repository metadata access is implicit for the GitHub token. It creates at most one draft review PR against `stable`, and the PR requires human review before any integration.

The source boundary remains PHOENIX-owned. Codex, Claude Code, and OpenClaw continue through their reviewed bridge intake described in [Codex and OpenClaw staged upstream intake](../feature/2026-08-31-codex-openclaw-upstream-intake.md).

## Alternatives considered

**One write-capable job:** rejected because candidate code would run while repository and pull-request write capabilities were available in the same job.

**Passing a validation artifact to the publisher:** rejected because the publisher can reproduce the candidate from immutable source and base SHAs, avoiding an artifact substitution path.

**Using a pull-request target workflow for validation:** rejected because it would expose a privileged token to source selected by an external contribution event.

## Consequences

Validation can still execute untrusted product and test code and download public dependencies, but it cannot access repository, pull-request, package, or runner artifact credentials through the workflow environment. Its 45-minute timeout bounds a stalled candidate. Protected automation changes fail closed and require explicit review. The static gate remains the acceptance policy, while exact tree comparison connects that result to the branch that is published.

## Testing

`scripts/ci-workflow.spec.ts` asserts the permission split, dual-SHA branch identity, pinned actions, immutable verifier, tree handoff, non-forced branch push, and separate pull-request permission set. `scripts/phoenix-quarantine-verify.spec.ts` proves that product changes pass while package-script or executable-automation replacement fails. The combined focused run passes 20 tests.
