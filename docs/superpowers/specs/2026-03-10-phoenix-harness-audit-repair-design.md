# PHOENIX Harness Audit and Repair Design

**Goal:** Verify the local PHOENIX harness on `stable` and `main`, repair reproducible functional or visual defects, and leave both branches with independently reproducible evidence.

## Scope

The mission covers the assembled Host and Client runtime, the local web GUI at `http://127.0.0.1:3080/`, model and provider selection, durable session and goal behavior, subagent/tool/file/browser paths, user-visible visualization and trajectory surfaces, and the branch state required to reproduce the result. It does not promise identical reasoning quality across providers; it requires a provider-neutral harness contract so every mounted model receives the same durable context, tool schemas, event semantics, permissions, and deliverable checks.

The existing uncommitted work in `stable` is preserved. No reset, clean, force checkout, or deletion of unrelated files is allowed. New work must be attributable to this mission and must avoid credentials, generated secrets, and the shipped preset installation.

## Evidence-first architecture

The audit has five layers:

1. **Repository manifest:** branch, commit, worktree status, runtime versions, changed-file inventory, and `main`/`stable` ancestry are recorded before any modification.
2. **Runtime baselines:** focused unit tests, built/type checks, keyless snapshots, relevant web tests, and live GUI checks establish what works, fails, skips, or is blocked by external credentials.
3. **Root-cause repairs:** each reproducible defect gets a minimal failing test, a single focused implementation change, and a fresh regression run. Provider quota/auth failures remain separate from harness failures.
4. **Model-neutral cognition contract:** model selection, session log projection, tool execution, durable goals, subagent reports, memory/feedback provenance, and final artifact verification are checked through real compositions or assembled snapshots. “Learning” means durable, scoped, inspectable reuse of evidence; it does not mean silently retraining a provider.
5. **Branch parity and independent review:** changes proven on `stable` are applied to local `main` only after review, then both branches receive focused verification. A read-only judge checks completeness, security, maintainability, visual quality, reproducibility, and every acceptance criterion.

## Visualization design contract

A visual change is justified only when a rendered defect is reproduced. The default view must state the claim or purpose, make the primary comparison obvious, keep labels and keys close to the evidence, use honest scales and units, preserve contrast and keyboard/touch access, and remain understandable in a static screenshot. Desktop and narrow layouts are sibling targets. Decorative gradients, equal-weight card grids, perspective charts, rainbow ramps, hover-only values, and animation without analytical meaning are rejected.

The repair surface is the actual renderer identified by runtime evidence, not an invented chart subsystem. If the current GUI only renders trajectory, tool cards, or model activity, the fix targets those components and their assembled tests. If a canvas or chart demo is part of the shipped path, it receives a deterministic data fixture, direct labels, responsive behavior, and a static fallback.

## Model-neutral delivery contract

Every mounted model must be able to use the same declared capabilities through the harness seams: model resolution, prompt assembly, tool schemas, tool execution, durable session events, approvals, goals, subagents, attachments, and final artifact checks. Provider-specific reasoning fields, token accounting, limits, or wire formats stay inside adapters. A model may produce a different answer because of its own capabilities, but the harness must not silently omit tools, lose logged context, bypass policy, or accept an unverified final artifact for one provider.

The audit records the selected provider/model, effective reasoning capability, tool visibility, session and goal identifiers, persisted events, and verification result. Tests that only inspect the agent's own text are insufficient; the harness re-reads files, checks durable state, and inspects assembled output externally.

## Error and recovery policy

Failures are classified as repository defect, local environment defect, external credential/quota dependency, flaky/timing issue, or pre-existing user change. A failed command is evidence to diagnose, not a reason to reset the tree or claim completion. The next attempt must change the hypothesis or isolate the failing layer. If a required external dependency cannot be bypassed safely, the report records the exact missing condition and continues all independent checks.

## Acceptance criteria

- `stable` and `main` are both tested without discarding pre-existing local changes.
- The repository builds and typechecks on the exercised paths, or every blocker has command output and a classified owner.
- Focused unit, assembled, snapshot, and web checks cover every implementation change.
- The local GUI loads a meaningful screen, has no relevant framework overlay or unexplained console error, and proves at least one interaction on desktop and one narrow viewport when the UI changes.
- Any repaired visualization has a readable default state, honest encoding, direct or adjacent labels, accessible interaction, and a static screenshot-safe fallback.
- Model/provider selection, tool use, durable session/goal behavior, subagent execution, and final artifact verification are proven through real composition or assembled replay rather than only isolated mocks.
- Durable learning/feedback behavior, if present, is scoped, traceable, reloadable, and does not leak unrelated session or project data.
- Credentials and unrelated user files are not committed or modified.
- A fresh independent audit returns PASS; otherwise the mission remains active with the returned changes as the next work list.

## Verification sequence

1. Record the repository and environment manifest for both branches.
2. Run focused baseline commands and live GUI checks on `stable`, then repeat on `main` with the same command set.
3. Trace each reproducible failure to its owning package and data-flow boundary.
4. Add a failing regression test before each production-code repair.
5. Implement the smallest root-cause fix and rerun focused, assembled, and relevant visual checks.
6. Review screenshots and responsive states for the changed visual surface.
7. Apply only proven changes to `main`, resolve conflicts by review, and rerun parity checks.
8. Submit fresh evidence to an independent read-only judge and continue until it passes.
