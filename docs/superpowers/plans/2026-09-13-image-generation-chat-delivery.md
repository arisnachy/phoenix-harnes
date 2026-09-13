# Image Generation Chat Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a successful Codex image generation request reaches PHOENIX chat as a durable visible image attachment instead of a text-only claim.

**Architecture:** Keep image generation in the host-side `llm-pi-ai` tool, because it owns the Codex worker, subprocess and attachment services. Make the tool registration lifecycle explicit and observable, preserve the existing `output.render()` image block, and add an end-to-end contract test proving that a successful result contains both the textual receipt and an `{ type: 'image', attachment }` block. Do not alter the KIRA avatar package.

**Tech Stack:** TypeScript, Cordis plugin composition, PHOENIX tool registry, Vitest, React client attachment renderer.

**Spec:** User-approved requirement from the chat: make image generation permanently usable in PHOENIX, never report success without a visible attachment, preserve the avatar branch, and publish the fix to `main` and `stable`.

## Global Constraints

- Do not modify or delete shipped agent preset installations; composition changes belong to the host-side bundle or source package that owns the capability.
- Do not use an API-key or separately billed image fallback.
- A successful image generation must expose a durable PHOENIX attachment and a native image content block.
- A worker exit without a verifiable fresh raster must remain a failure.
- Preserve unrelated working-tree changes under `scripts/` and `.agents/`.
- Publish only after focused tests, package/build verification, and live GUI verification pass.

---

### Task 1: Lock the missing attachment contract with a failing test

**Files:**
- Modify: `packages/llm/llm-pi-ai/tests/image-generation.spec.ts`
- Test: `packages/llm/llm-pi-ai/tests/image-generation.spec.ts`

**Interfaces:**
- Consumes: `installCodexImageGeneration(ctx)` and the registered `image_generation` tool definition.
- Produces: A regression assertion that the registered tool's output renderer returns one text receipt and one image block whose attachment is the saved image reference.

- [ ] **Step 1: Add the failing renderer contract test**

Register the tool with the existing test context and invoke its `output.render()` with a canonical result. Assert the exact content shape:

```ts
expect(tool.output.render({}, value)).toEqual([
  { type: 'text', text: expect.stringContaining('<path>') },
  { type: 'image', attachment: value.attachment },
])
```

The test must fail if a future change returns only the text receipt or serializes the attachment into JSON.

- [ ] **Step 2: Run the focused test and record the failure**

Run:

```text
pnpm exec vitest run packages/llm/llm-pi-ai/tests/image-generation.spec.ts
```

Expected: the new contract test fails for the currently mounted/runtime-facing registration path, identifying the missing delivery behavior rather than a fixture or import error.

---

### Task 2: Make registration and attachment delivery explicit

**Files:**
- Modify: `packages/llm/llm-pi-ai/src/image-generation.ts`
- Modify: `packages/llm/llm-pi-ai/src/index.ts` only if the lifecycle requires a stable disposer or host registration boundary
- Test: `packages/llm/llm-pi-ai/tests/image-generation.spec.ts`

**Interfaces:**
- Consumes: Cordis `tools`, `subprocess`, and `attachments` services.
- Produces: A stable `image_generation` tool whose successful execution returns `{ provider, model, path, attachment }` and whose native render always includes an image content block.

- [ ] **Step 1: Trace and isolate the registration boundary**

Confirm the active composition mounts `@phoenix-ai/dsh-llm-pi-ai` and that its `ctx.inject(['tools', 'subprocess', 'attachments'], ...)` callback runs once per plugin instance. Keep the host ownership unchanged; do not add a duplicate preset service or a second global tool.

- [ ] **Step 2: Implement the smallest lifecycle-safe fix**

Keep the existing durable `attachments.saveImage()` call and `output.render()` projection. If registration is currently lost during composition rebuild or route changes, retain the disposer returned by `services.tools.register()` through `ctx.effect()`/the plugin fiber so the registration is removed and re-added atomically. If registration is already stable, make no unrelated lifecycle change and only harden the native render contract.

- [ ] **Step 3: Add failure protection against text-only success**

Validate the generated result before returning success: require a fresh raster, supported media type, saved attachment metadata, and the attachment identity used by `render()`. If any is missing, throw a descriptive `image_generation:` error instead of returning a text-only result.

- [ ] **Step 4: Run the focused test and confirm green**

Run:

```text
pnpm exec vitest run packages/llm/llm-pi-ai/tests/image-generation.spec.ts
```

Expected: all image bridge tests pass, including the new native image-block contract.

---

### Task 3: Verify assistant transport and browser rendering

**Files:**
- Modify: `packages/client/runtime/tests/conversation.client.spec.ts` only if the image-block transport lacks regression coverage
- Modify: `packages/client/ui-conversation/tests/hardness-artifact-renderer.client.spec.tsx` only if the message-level image renderer lacks coverage
- Test: the files above plus existing `packages/client/ui-attachment` image tests

**Interfaces:**
- Consumes: assistant `ContentBlock` values with `{ type: 'image', attachment }`.
- Produces: Proof that finalized and streamed assistant messages retain the image block and that the browser renders a session-authorized image preview.

- [ ] **Step 1: Add only the missing transport assertion**

Assert `toAssistantBlock({ type: 'image', attachment })` returns `{ kind: 'image', attachment }`, and that the message image slot receives the same attachment reference. Reuse existing fixtures where coverage already exists; do not duplicate equivalent tests.

- [ ] **Step 2: Run focused client tests**

Run:

```text
pnpm exec vitest run packages/client/runtime/tests/conversation.client.spec.ts packages/client/ui-conversation/tests/hardness-artifact-renderer.client.spec.tsx packages/client/ui-attachment/tests/message-image.client.spec.tsx
```

Expected: all existing and new transport/render tests pass.

---

### Task 4: Build, live-test, and publish safely

**Files:**
- No additional source files unless verification exposes a concrete regression.
- Evidence: `.kira/audits/image-generation-chat.png` if a live GUI capture is needed.

**Interfaces:**
- Consumes: the repaired host tool, built web artifacts, the official `http://127.0.0.1:3080/` runtime, and dedicated KIRA Chrome.
- Produces: Fresh test/build evidence, a browser-visible image in a real assistant message, preserved avatar behavior, and commits pushed to both `main` and `stable`.

- [ ] **Step 1: Run package and web verification**

Run the focused suites, the affected package build, and the web build. Stop on any failure and repair the root cause before continuing.

- [ ] **Step 2: Restart/rebuild only the official runtime as required**

Use the existing supervisor/dev watcher; do not start a replacement server. Refresh `http://127.0.0.1:3080/` in dedicated Chrome and submit a minimal image request. Verify the conversation contains an actual image preview, not only a path or success sentence.

- [ ] **Step 3: Capture evidence and inspect it**

Save and inspect `.kira/audits/image-generation-chat.png`. Confirm the image is visible in the message and the KIRA avatar dock remains present and unchanged.

- [ ] **Step 4: Commit only intended changes**

Stage the image-delivery source/tests/plan, preserve unrelated `scripts/` and `.agents/` changes, and create a focused commit. Fast-forward/publish `main`, then align/publish `stable` without force-push.

- [ ] **Step 5: Run an independent review before completion**

Review the final diff and evidence against every criterion: registration lifecycle, durable attachment, native image block, UI visibility, no API fallback, avatar preservation, test reproducibility, and branch parity.
