# Transactional Dirty-Worktree Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow PHOENIX stable-channel updates to preserve and restore dirty live worktrees transactionally instead of blocking updates.

**Architecture:** Preparation continues in the isolated staging worktree even when the live checkout is dirty. Activation captures tracked/staged/untracked changes into a pinned stash snapshot, applies the promoted stable commit, restores the snapshot, verifies the exact porcelain state and source launcher, and rolls back to the prior HEAD plus original worktree on any failure.

**Tech Stack:** Node.js ESM scripts, Git CLI, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-12-transactional-dirty-worktree-updates-design.md`

## Global Constraints

- Preserve staged, unstaged, and untracked user changes; do not use `git stash --all`.
- Keep existing user stash entries intact.
- Pin the updater-owned stash under `refs/phoenix/recovery/worktree-snapshot` until exact restoration is verified.
- Development branches, foreign remotes, and unmanaged divergent histories remain fail-closed.
- `PHOENIX_UPDATE_MODE=off` and `PHOENIX_AUTO_UPDATE=0` remain authoritative disables.
- Every production change follows a failing test first.

---

### Task 1: Worktree transaction helper

**Files:**
- Create: `scripts/phoenix-worktree-transaction.spec.ts`
- Create: `scripts/phoenix-worktree-transaction.mjs`

**Interfaces:**
- Produces: `captureWorktreeSnapshot(root)`, `restoreWorktreeSnapshot(root, snapshot)`, `rollbackWorktreeSnapshot(root, snapshot)`, `finalizeWorktreeSnapshot(root, snapshot)`, `worktreeStatus(root)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips staged, unstaged, and untracked changes without disturbing an existing stash', () => {
  const snapshot = captureWorktreeSnapshot(repo)
  moveHeadTo(updatedCommit)
  restoreWorktreeSnapshot(repo, snapshot)
  expect(status(repo)).toEqual(snapshot.status)
  finalizeWorktreeSnapshot(repo, snapshot)
  expect(stashHashes(repo)).toContain(existingStash)
})

it('rolls a conflicting reapply back to the original head and worktree', () => {
  const snapshot = captureWorktreeSnapshot(repo)
  moveHeadTo(conflictingCommit)
  expect(() => restoreWorktreeSnapshot(repo, snapshot)).toThrow()
  rollbackWorktreeSnapshot(repo, snapshot)
  expect(head(repo)).toBe(snapshot.head)
  expect(status(repo)).toEqual(snapshot.status)
})
```

- [ ] **Step 2: Run the focused spec and confirm RED**

Run: `pnpm exec vitest run scripts/phoenix-worktree-transaction.spec.ts`
Expected: FAIL because `scripts/phoenix-worktree-transaction.mjs` does not exist.

- [ ] **Step 3: Implement the minimal helper**

```js
export function captureWorktreeSnapshot(root) {
  const status = worktreeStatus(root)
  if (status.length === 0) return { dirty: false, head: git(root, ['rev-parse', 'HEAD']).stdout, status }
  git(root, ['stash', 'push', '--include-untracked', '--message', transactionMessage()])
  const stash = git(root, ['rev-parse', 'refs/stash']).stdout
  git(root, ['update-ref', SNAPSHOT_REF, stash])
  assertClean(root)
  return { dirty: true, head, stash, status }
}
```

`restoreWorktreeSnapshot` uses `git stash apply --index <sha>` and requires exact porcelain equality. `rollbackWorktreeSnapshot` resets to the captured HEAD, runs `git clean -fd`, reapplies the pinned snapshot, and verifies HEAD plus porcelain state. `finalizeWorktreeSnapshot` locates the exact stash SHA in `git stash list --format=%H`, drops only that entry, then deletes the recovery ref.

- [ ] **Step 4: Run the focused spec and confirm GREEN**

Run: `pnpm exec vitest run scripts/phoenix-worktree-transaction.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add scripts/phoenix-worktree-transaction.mjs scripts/phoenix-worktree-transaction.spec.ts
git commit -m "feat(updater): add transactional worktree snapshots"
```

### Task 2: Prepare updates while dirty

**Files:**
- Modify: `scripts/phoenix-update-contract.spec.ts`
- Modify: `scripts/phoenix-auto-update.mjs`
- Modify: `scripts/phoenix-windows-supervisor.spec.ts`
- Modify: `scripts/phoenix-windows-supervisor.mjs`

**Interfaces:**
- Consumes: worktree transaction helper from Task 1.
- Produces: watcher behavior that stages stable targets regardless of live worktree dirtiness.

- [ ] **Step 1: Add failing source-contract tests**

```ts
expect(updater).not.toContain('local changes block preparation/activation')
expect(updater).toContain('local changes will be preserved transactionally')
expect(supervisor).not.toContain('automatic update watcher paused for this session')
expect(supervisor).not.toContain('reportDirtyActivationBlock(liveStatus)')
```

- [ ] **Step 2: Run the two focused specs and confirm RED**

Run: `pnpm exec vitest run scripts/phoenix-update-contract.spec.ts scripts/phoenix-windows-supervisor.spec.ts`
Expected: FAIL on the old dirty-worktree blocking behavior.

- [ ] **Step 3: Remove dirty preparation/supervisor blocks**

`preparedCandidateValid` must require the same base HEAD and clean staging worktree, but not a clean live worktree. The watcher always prepares a stable candidate and logs once that local changes will be preserved transactionally. The Windows supervisor starts the watcher unless explicitly disabled and hands dirty activation to the transactional activator.

- [ ] **Step 4: Run focused specs and updater self-test**

Run: `pnpm exec vitest run scripts/phoenix-update-contract.spec.ts scripts/phoenix-windows-supervisor.spec.ts && node scripts/phoenix-auto-update.mjs --self-test`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add scripts/phoenix-auto-update.mjs scripts/phoenix-update-contract.spec.ts scripts/phoenix-windows-supervisor.mjs scripts/phoenix-windows-supervisor.spec.ts
git commit -m "fix(updater): prepare stable updates on dirty checkouts"
```

### Task 3: Transactional supervised and direct activation

**Files:**
- Modify: `scripts/phoenix-activate-prepared.mjs`
- Modify: `scripts/phoenix-auto-update.mjs`
- Modify: `scripts/phoenix-update-contract.spec.ts`

**Interfaces:**
- Consumes: `captureWorktreeSnapshot`, `restoreWorktreeSnapshot`, `rollbackWorktreeSnapshot`, `finalizeWorktreeSnapshot`.
- Produces: activation that restores local changes on success and exact pre-update state on failure.

- [ ] **Step 1: Add failing activation contract tests**

```ts
expect(activator).toContain('captureWorktreeSnapshot(root)')
expect(activator).toContain('restoreWorktreeSnapshot(root, snapshot)')
expect(activator).toContain('rollbackWorktreeSnapshot(root, snapshot)')
expect(activator).toContain('finalizeWorktreeSnapshot(root, snapshot)')
expect(activator).not.toContain("if (!cleanWorktree(root)) throw new Error('live checkout changed after preparation; refusing activation')")
```

- [ ] **Step 2: Run the focused contract spec and confirm RED**

Run: `pnpm exec vitest run scripts/phoenix-update-contract.spec.ts`
Expected: FAIL because activation still requires a clean live checkout.

- [ ] **Step 3: Wrap live mutation in the transaction**

```js
const snapshot = captureWorktreeSnapshot(root)
try {
  activatePreparedCommit()
  restoreWorktreeSnapshot(root, snapshot)
  smoke(root, 'source')
  finalizeWorktreeSnapshot(root, snapshot)
} catch (error) {
  rollbackWorktreeSnapshot(root, snapshot)
  throw error
}
```

Apply the same transaction around the direct one-shot `applyUpdate` path so supervised Windows and CLI activation have the same safety semantics.

- [ ] **Step 4: Run focused transaction, updater, and supervisor specs**

Run: `pnpm exec vitest run scripts/phoenix-worktree-transaction.spec.ts scripts/phoenix-update-contract.spec.ts scripts/phoenix-windows-supervisor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add scripts/phoenix-activate-prepared.mjs scripts/phoenix-auto-update.mjs scripts/phoenix-update-contract.spec.ts
git commit -m "feat(updater): activate stable updates transactionally"
```

### Task 4: Decision record and integration verification

**Files:**
- Create: `.agents/notes/implemented/bug-fix/2026-09-12-transactional-dirty-worktree-updates.md`
- Create: `.agents/notes/implemented/bug-fix/2026-09-12-transactional-dirty-worktree-updates.zh.md`
- Create: `.agents/notes/implemented/bug-fix/2026-09-12-transactional-dirty-worktree-updates.i18n.yaml`

**Interfaces:**
- Documents the shipped safety decision and rejected alternatives.

- [ ] **Step 1: Write the implemented Agent Note pair**

Record the problem, present-tense decision, alternatives (blocking dirty updates, destructive reset, separate clean runtime checkout), and consequences. Record the English and Chinese blob hashes in the `.i18n.yaml` sidecar.

- [ ] **Step 2: Run focused verification**

Run: `pnpm exec vitest run scripts/phoenix-worktree-transaction.spec.ts scripts/phoenix-update-contract.spec.ts scripts/phoenix-windows-supervisor.spec.ts`
Run: `node scripts/phoenix-auto-update.mjs --self-test`
Run: `pnpm run verify-agent-note-format`
Expected: PASS for all focused updater/Agent Note checks.

- [ ] **Step 3: Review diff and commit**

```sh
git diff --check
git add .agents/notes/implemented/bug-fix/2026-09-12-transactional-dirty-worktree-updates.* docs/superpowers/specs/2026-09-12-transactional-dirty-worktree-updates-design.md docs/superpowers/plans/2026-09-12-transactional-dirty-worktree-updates.md
git commit -m "docs: record transactional updater recovery"
```

- [ ] **Step 4: Open PR and inspect CI**

Open a PR against `main`, inspect the diff and CI, and distinguish failures introduced by this change from repository-wide pre-existing failures before promotion to `main` and `stable`.
