# OpenClaw Graft + Inline HARDNESS Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and verification-before-completion. Steps use checkbox syntax for tracking.

**Goal:** Finish the pinned OpenClaw extensions graft into HARDNESS/ATLAS and replace the reverted overlay artifact experiment with ChatGPT-style inline conversation artifacts.

**Architecture:** Phoenix remains canonical. `openclaw-compat` is metadata-first and publishes non-routable experimental capabilities into HARDNESS. Artifact rendering is conversation-native: `tool/result.meta.artifact` projects to a dedicated `hardness-artifact` chat node, rendered inline; no artifact fixture auto-opens and no artifact renderer registers directly in `shell.overlay`. Expansion, when implemented, originates from the inline card and uses an isolated viewer surface.

**Tech Stack:** TypeScript 6, React 18, Vitest 4, Cordis slots/conversation events, pnpm 11.

**Specs:** `docs/superpowers/specs/2026-08-28-openclaw-extensions-graft-design.md` and `docs/superpowers/specs/2026-08-28-universal-artifacts-design.md`.

## Global Constraints

- Donor OpenClaw commit: `515c3d8ff3fce77838d69d1da838ad691c18d755`.
- No OpenClaw core/gateway/session/secret/scheduler becomes authoritative.
- All OpenClaw capabilities enter HARDNESS as `experimental` until verified.
- Artifact UI must never occupy `shell.overlay` merely because Phoenix runs on localhost.
- Chat conversation remains visible and primary at all times.
- Artifact execution is never implicit; interactive app execution remains sandbox/approval gated.
- Promotion requires exact-head CI evidence.

---

### Task 1: Rebase the graft onto current clean main
- [ ] Create a fresh graft branch from current `main`.
- [ ] Port the pinned 153-extension catalog, manifest translator, diagnostics, runtime, and tests.
- [ ] Add a real workspace package manifest for `openclaw-compat` or otherwise prove build-safe imports through repository typecheck.
- [ ] Run focused tests and typecheck.

### Task 2: HARDNESS/ATLAS projection
- [ ] Add failing test that requires all 153 donor capabilities to register as `experimental` and dispose cleanly.
- [ ] Implement `toHardnessCapabilityDescriptors()` and `indexOpenClawExtensions()`.
- [ ] Wire `hardness-adapters.apply()` to register and dispose OpenClaw capabilities.
- [ ] Run focused tests.

### Task 3: Inline artifact projection
- [ ] Add failing tests proving a successful `tool/result` with `meta.artifact` yields a second durable chat node with key `hardness-artifact`, while ordinary tool results do not.
- [ ] Add the `hardness-artifact` chat data contract and conversation node projection.
- [ ] Add a dedicated inline renderer to `conversation.chat.node`.
- [ ] Keep malformed/unrecognized artifacts on a safe textual fallback.
- [ ] Verify the conversation remains the owning surface; no direct `shell.overlay` registration.

### Task 4: Inline renderers
- [ ] Support image, markdown/text, table, chart-spec summary/fallback, document/file metadata, declarative UI/form, and app metadata cards.
- [ ] Inputs/forms are locally interactive where safe; actions that cause side effects remain disabled until an RPC approval bridge exists.
- [ ] Add accessible expand affordance that does not auto-open.
- [ ] Run renderer/unit tests.

### Task 5: Final gates and promotion
- [ ] Remove temporary focused CI workflow if no longer needed.
- [ ] Run exact-head repository CI and inspect failures.
- [ ] Merge graft PR to `main` only on green head.
- [ ] Verify `main` exact SHA and CI.
- [ ] Fast-forward `stable` to the verified `main` SHA.
- [ ] Verify `stable` equals `main`.
