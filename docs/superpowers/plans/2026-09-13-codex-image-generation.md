# Codex Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make KIRA's already-documented `image_generation` behavior real: a model-facing Phoenix tool delegates one text-to-image request to the official Codex runtime, admits exactly one generated raster into `ctx.attachments`, and returns a durable Phoenix image block that renders and replays like any other attachment.

**Architecture:** Add a provider-specific tool adapter under the subagent package family rather than teaching the generic LLM or attachment seams about Codex. The tool owns one foreground Codex subagent lifecycle, gives it a Phoenix-minted workspace-relative output directory plus a strict manifest contract, validates the returned filesystem effect fail-closed, commits bytes through `ctx.attachments.saveImage`, and only then exposes a serializable attachment reference through the tool's canonical JSON result. The shipped host mounts the existing `@phoenix-ai/dsh-subagent-codex` provider; the standard agent preset mounts the new tool. No API-key fallback is added.

**Tech Stack:** TypeScript, Cordis, `@phoenix-ai/dsh-tools`, `@phoenix-ai/dsh-subagent`, official `@openai/codex` app-server via the existing Codex provider, `@phoenix-ai/dsh-attachment`, Node `fs/path`, Vitest, Loader composition tests.

**Spec:** `docs/superpowers/specs/2026-09-13-codex-image-generation-design.md`. The implementation keeps the shipped persona's existing public tool name `image_generation`; this is a naming refinement only — the approved capability and failure model are unchanged.

## Global Constraints

- Use the existing `codex` subagent provider; do not call the OpenAI Images API directly and do not add or request an API key.
- The current agent/session owns workspace identity. Reject calls without an initiating Agent or usable workspace.
- Exactly one raster may be published per call in v1. Accepted media types come from the attachment seam; do not trust a manifest extension alone.
- The live workspace is never trusted merely because Codex wrote a path. Resolve under a Phoenix-minted output directory, reject traversal/symlinks/non-files, bound manifest bytes, read bytes, then let `ctx.attachments.saveImage` decode/validate before publication.
- `saveImage` is the publication/commit point. No image block or success metadata is emitted before it succeeds.
- A foreground Codex run is disposed on every success/failure/abort path. Cancellation is forwarded from `exec.signal`.
- Any unavailable provider, missing/malformed output, unsupported media, path escape, Codex failure, or attachment rejection fails closed with a stable image-generation failure code/message; never fall back to another provider or arbitrary external URL.
- Generated files remain in `.phoenix/generated-images/<call-id>/` inside the initiating workspace so the durable attachment and the workspace artifact can be correlated without exposing host-absolute paths to the model.

---

### Task 1: Add the package shell and red behavioral tests

**Files:**
- Create: `packages/subagent/tool-image-generation-codex/package.json`
- Create: `packages/subagent/tool-image-generation-codex/tsconfig.json`
- Create: `packages/subagent/tool-image-generation-codex/src/index.ts`
- Create: `packages/subagent/tool-image-generation-codex/src/invariant.ts`
- Create: `packages/subagent/tool-image-generation-codex/tests/image-generation.spec.ts`

**Executable contract:**
- registers `image_generation` only while `tools`, `subagents`, and `attachments` are available;
- delegates specifically to provider `codex`;
- passes the initiating `Agent`, signal, and strict output instructions;
- disposes the foreground run;
- rejects no-agent, unavailable provider, non-completed Codex runs, malformed manifest, traversal, symlink, non-image, and multiple-output cases;
- calls `saveImage` once only after validation;
- canonical JSON contains the durable attachment reference and workspace-relative generated path;
- renderer emits exactly one `{ type: 'image', attachment }` block plus bounded text.

- [ ] **Step 1: Write tests against the public plugin/tool contract before production behavior exists.**
- [ ] **Step 2: Run the focused test and retain the expected RED evidence.**
- [ ] **Step 3: Add only the package manifest/tsconfig/invariant shell needed to compile the tests.**

### Task 2: Implement the fail-closed generation transaction

**Files:**
- Modify: `packages/subagent/tool-image-generation-codex/src/index.ts`
- Test: `packages/subagent/tool-image-generation-codex/tests/image-generation.spec.ts`

**Interfaces:**
- Plugin name: `tool-image-generation-codex`
- Default model-facing tool name: `image_generation`
- Default subagent provider: `codex`
- Tool input v1: `{ prompt: string }`
- Canonical success value: `{ attachment: ImageAttachmentRef, path: string }` represented as lossless JSON.

- [ ] **Step 1: Build a call-id-safe output directory below `<cwd>/.phoenix/generated-images/`.**
- [ ] **Step 2: Start one Codex subagent with a strict instruction to use its built-in image generation capability, produce exactly one raster, and atomically write a small JSON manifest into the minted directory.**
- [ ] **Step 3: Await the run, require `stopReason === 'completed'`, then always dispose it.**
- [ ] **Step 4: Read a bounded manifest and validate one relative filename + supported declared media type.**
- [ ] **Step 5: Resolve and realpath the candidate; reject path escape, symlink, non-regular file, or additional raster files in the output directory.**
- [ ] **Step 6: Read bytes and call `ctx.attachments.saveImage({ data, mediaType, name })`; use the returned normalized reference, not manifest metadata, as authority.**
- [ ] **Step 7: Render the canonical reference as an image block plus concise text.**
- [ ] **Step 8: Run focused tests until GREEN.**

### Task 3: Document and register the new host package

**Files:**
- Create: `packages/subagent/tool-image-generation-codex/README.md`
- Create: `packages/subagent/tool-image-generation-codex/README.zh.md`
- Create: `packages/subagent/tool-image-generation-codex/README.i18n.yaml`
- Modify: `tsconfig.host.json`

- [ ] **Step 1: Document lifecycle, security boundary, Model Experience, limits, and known limitations.**
- [ ] **Step 2: Add exactly one host aggregate reference for the package.**
- [ ] **Step 3: Ensure the package owns `./invariant` and follows the function-plugin export convention.**

### Task 4: Mount Codex host capability and grant it to the standard KIRA preset

**Files:**
- Modify: `packages/bundle/base/package.json`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/config/agent-presets/standard/agent.cordis.yml`
- Test: existing bundle/profile composition tests plus a new focused Loader composition test in the new package or Web bundle.

- [ ] **Step 1: Add `@phoenix-ai/dsh-subagent-codex` to the shipped dependency closure and mount its provider row on the Host plane exactly once.**
- [ ] **Step 2: Add `@phoenix-ai/dsh-tool-image-generation-codex` to the CLI/preset dependency closure.**
- [ ] **Step 3: Mount `image_generation` in the standard preset only; minimal/cordis presets remain unchanged.**
- [ ] **Step 4: Keep the existing persona instruction aligned with the exact tool name.**
- [ ] **Step 5: Boot a test-only Loader composition using real package rows, fake only the external Codex execution, and prove the model-visible tool exists and a saved image block is durable.**

### Task 5: Add Codex compatibility evidence

**Files:**
- Add or modify: `packages/subagent/tool-image-generation-codex/tests/codex-contract.spec.ts`
- If needed: a small exported prompt/manifest parser seam in `src/index.ts` used by tests.

- [ ] **Step 1: Pin the instruction contract that requires Codex's built-in image generation rather than shelling out to an arbitrary image service.**
- [ ] **Step 2: Prove the provider failure path emits the stable unavailable diagnostic and never starts a fallback LLM/image API.**
- [ ] **Step 3: Prove Windows-safe path handling and signal forwarding.**

### Task 6: Verify, review, and promote

**Files:** none unless review finds defects.

- [ ] **Step 1: Run focused KIRA tests and the new image-generation package tests.**
- [ ] **Step 2: Run host/client typecheck and the relevant Loader/Web composition rung.**
- [ ] **Step 3: Run PR CI and separate any pre-existing repo-wide static failures from regressions introduced by this branch.**
- [ ] **Step 4: Review the PR diff for security, lifecycle, replay, package-policy, and UI regressions.**
- [ ] **Step 5: Merge verified PR into `main`.**
- [ ] **Step 6: Promote the identical verified tree to `stable` and verify both branch SHAs/tree identity.**
