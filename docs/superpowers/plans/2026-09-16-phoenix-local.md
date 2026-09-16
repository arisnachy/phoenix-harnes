# Phoenix Local Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `🔥 Phoenix Local · Offline` a first-class Phoenix model that users can install, configure, start, stop, uninstall, and use from the normal model selector without cloud credentials.

**Architecture:** Add a host-only local-runtime package that owns catalog, safe storage, verified downloads, llama-server lifecycle, and state. Expose that lifecycle through the existing host plugin-inventory remote, wire a `phoenix-local` OpenAI-compatible route into `llm-pi-ai`, and add a dedicated Phoenix Local card to Settings → Models. The provider is always discoverable by the normal LLM model list, while inference starts the runtime on demand through an injected pre-request hook.

**Tech Stack:** TypeScript, Node.js 22+/24, Cordis, Typert remotes, `@mariozechner/pi-ai`, llama.cpp `llama-server`, React, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-16-phoenix-local-design.md`

## Global Constraints

- Windows x64 is the first fully supported installer target; unsupported platforms must fail explicitly without breaking Phoenix.
- The local HTTP server binds to `127.0.0.1` only and is never exposed to LAN interfaces.
- Default runtime mode is `on-demand`; stopping the local model must never stop Phoenix.
- Initial recommended model is Qwen3.5-4B GGUF Q4_K_M, but provider/runtime APIs are model-agnostic.
- Never bundle the multi-GB model or llama.cpp runtime in the Phoenix application package.
- Downloads activate only after exact SHA-256 verification and atomic rename from a managed temporary file.
- CI tests use injected fakes/mocks and never download a real model or runtime.
- Initial context window is 8192 tokens; configuration remains extensible.
- Recovery/A-B rollback and autonomous code repair are outside this implementation.
- No maintainer/GitHub credentials are stored in local-model code.

---

### Task 1: Local Runtime Catalog, Paths, and Persistent State

**Files:**
- Create: `packages/llm/llm-local-runtime/package.json`
- Create: `packages/llm/llm-local-runtime/tsconfig.json`
- Create: `packages/llm/llm-local-runtime/src/types.ts`
- Create: `packages/llm/llm-local-runtime/src/catalog.ts`
- Create: `packages/llm/llm-local-runtime/src/paths.ts`
- Create: `packages/llm/llm-local-runtime/src/state.ts`
- Create: `packages/llm/llm-local-runtime/src/index.ts`
- Create: `packages/llm/llm-local-runtime/tests/catalog.test.ts`
- Create: `packages/llm/llm-local-runtime/tests/state.test.ts`

**Interfaces:**
- Produces `LocalModelMode = 'off' | 'on-demand' | 'always-on'`.
- Produces `LocalModelPhase = 'not-installed' | 'installing' | 'ready' | 'starting' | 'running' | 'stopping' | 'error'`.
- Produces `LocalModelCatalogEntry`, `LocalRuntimeManifest`, `LocalModelRuntimeSnapshot`, and `LocalModelPersistentState`.
- Produces `getLocalModelCatalog()`, `getRuntimeManifest(platform, arch)`, `createLocalModelPaths(root)`, `loadLocalModelState()`, and `saveLocalModelState()`.

- [ ] **Step 1: Write failing catalog tests**

Assert that the recommended catalog entry has id `qwen3.5-4b-q4-k-m`, file `Qwen_Qwen3.5-4B-Q4_K_M.gguf`, SHA-256 `52d8d3e626382bddf8327cbdd71c08901cbd9d9b4879c9fb625d5d5903edf2e2`, context 8192, and `recommended: true`. Assert Windows x64 resolves llama.cpp `b10964` asset `llama-b10964-bin-win-cpu-x64.zip` with SHA-256 `3245342858a293854962cc631185ef56ba4cea943564ba32fb2bb24398958ff8`.

- [ ] **Step 2: Write failing state/path tests**

Verify state defaults to `{ mode: 'on-demand', selectedModelId: 'qwen3.5-4b-q4-k-m' }`, state writes use temp-file + rename, and a managed artifact path outside the configured root is rejected.

- [ ] **Step 3: Run targeted tests and confirm RED**

Run `pnpm exec vitest run packages/llm/llm-local-runtime/tests/catalog.test.ts packages/llm/llm-local-runtime/tests/state.test.ts`. Expected: failure because runtime modules do not exist yet.

- [ ] **Step 4: Implement the minimal catalog/path/state package**

Use Node built-ins only (`node:path`, `node:fs/promises`, `node:os`). Keep all paths rooted under one Phoenix-managed local-model directory. Persist JSON atomically using the same temp-write/rename pattern already used by host updater state.

- [ ] **Step 5: Run targeted tests and confirm GREEN**

Run the same Vitest command. Expected: all new tests pass.

- [ ] **Step 6: Commit**

Commit message: `feat(local-ai): add local model catalog and state`.

### Task 2: Verified Installer and llama-server Lifecycle Manager

**Files:**
- Create: `packages/llm/llm-local-runtime/src/download.ts`
- Create: `packages/llm/llm-local-runtime/src/extract.ts`
- Create: `packages/llm/llm-local-runtime/src/manager.ts`
- Create: `packages/llm/llm-local-runtime/tests/download.test.ts`
- Create: `packages/llm/llm-local-runtime/tests/manager.test.ts`
- Modify: `packages/llm/llm-local-runtime/src/index.ts`

**Interfaces:**
- Produces `LocalModelRuntimeManager` with `snapshot()`, `install(modelId)`, `start()`, `ensureRunning()`, `stop()`, `uninstall(modelId)`, `setMode(mode)`, `setDefaultModel(modelId)`, and `dispose()`.
- Manager construction accepts injected filesystem, downloader, process launcher, port allocator, health probe, clock, and memory probe dependencies for deterministic tests.
- `ensureRunning()` returns the loopback OpenAI-compatible base URL after a healthy llama-server is confirmed.

- [ ] **Step 1: Write failing download tests**

Test resume-to-`.part`, exact SHA-256 verification, hash mismatch rejection, and atomic activation. The test uses byte fixtures only.

- [ ] **Step 2: Write failing lifecycle tests**

Test: install transitions `not-installed → installing → ready`; on-demand `ensureRunning()` transitions `ready → starting → running`; generated launch arguments include `--host 127.0.0.1`, `--ctx-size 8192`, selected model path, and allocated port; stop leaves Phoenix manager alive; uninstall stops first and deletes only managed artifacts; mode `off` rejects `ensureRunning()`; unsupported runtime manifest returns a typed `unsupported-platform` error.

- [ ] **Step 3: Run targeted tests and confirm RED**

Run `pnpm exec vitest run packages/llm/llm-local-runtime/tests/download.test.ts packages/llm/llm-local-runtime/tests/manager.test.ts`.

- [ ] **Step 4: Implement downloader/extractor/manager**

Use `fetch`/streams, `node:crypto`, `node:child_process`, and built-in OS extraction commands. Never execute a path outside the managed runtime directory. Capture child stdout/stderr into a bounded diagnostic ring and perform a health probe before exposing `running`.

- [ ] **Step 5: Run targeted tests and confirm GREEN**

Run the same tests plus Task 1 tests.

- [ ] **Step 6: Commit**

Commit message: `feat(local-ai): manage verified local runtime lifecycle`.

### Task 3: Host Remote Control Surface

**Files:**
- Modify: `packages/host/plugin-inventory/package.json`
- Modify: `packages/host/plugin-inventory/src/index.ts`
- Create: `packages/host/plugin-inventory/src/local-model-runtime.ts`
- Create: `packages/host/plugin-inventory/tests/local-model-runtime.test.ts`

**Interfaces:**
- `HostPluginInventoryGateway` adds `getLocalModelStatus()`, `installLocalModel(request)`, `startLocalModel()`, `stopLocalModel()`, `uninstallLocalModel(request)`, `setLocalModelMode(request)`, and `setDefaultLocalModel(request)`.
- Request DTOs are `{ modelId: string }`, `{ mode: LocalModelMode }`, and `{ modelId: string }` respectively.
- Host service owns exactly one runtime-manager instance and disposes it with the service lifecycle.

- [ ] **Step 1: Write failing remote tests**

Use a fake runtime manager and assert each Typert method delegates correctly, returns a sanitized snapshot, and never returns filesystem internals beyond user-facing storage size/path metadata explicitly allowed by the snapshot.

- [ ] **Step 2: Run targeted test and confirm RED**

Run `pnpm exec vitest run packages/host/plugin-inventory/tests/local-model-runtime.test.ts`.

- [ ] **Step 3: Implement the host bridge**

Construct the runtime manager from Phoenix host data paths. Keep the existing inventory/updater methods unchanged.

- [ ] **Step 4: Run host tests and confirm GREEN**

Run `pnpm exec vitest run packages/host/plugin-inventory/tests`.

- [ ] **Step 5: Commit**

Commit message: `feat(local-ai): expose local model host controls`.

### Task 4: First-Class LLM Provider and On-Demand Start Hook

**Files:**
- Modify: `packages/llm/llm-pi-ai/src/adapter.ts`
- Modify: `packages/llm/llm-pi-ai/src/index.ts`
- Modify: `packages/bundle/base/cordis.patch.yml`
- Create or modify tests under: `packages/llm/llm-pi-ai/tests/`

**Interfaces:**
- `PiAiAdapter` accepts optional `beforeRequest(provider: string, modelId: string): Promise<void>`.
- `llm-pi-ai` declares provider `phoenix-local` with human name `🔥 Phoenix Local · Offline`, protocol `openai-completions`, stable model id `phoenix-local`, context 8192, and max output 4096.
- Before any `phoenix-local` request, the hook calls the host runtime manager’s `ensureRunning()` and refreshes/uses its `http://127.0.0.1:<port>/v1` base URL.
- Other providers remain byte-for-byte behavior compatible.

- [ ] **Step 1: Write failing adapter/provider tests**

Assert `phoenix-local` is returned from `ctx.llm.listModels()` without credentials, ordinary providers do not call the hook, Phoenix Local calls the hook once before transport, and an uninstalled/off runtime returns a structured actionable error rather than a silent empty response.

- [ ] **Step 2: Run targeted tests and confirm RED**

Run the relevant `llm-pi-ai` Vitest files.

- [ ] **Step 3: Implement provider + hook**

Reuse the existing OpenAI-compatible `pi-ai` route instead of creating a second chat stack. Do not add a renderer HTTP client directly to llama-server.

- [ ] **Step 4: Run targeted and package tests and confirm GREEN**

Run all `packages/llm/llm-pi-ai` tests and the local-runtime tests.

- [ ] **Step 5: Commit**

Commit message: `feat(local-ai): route Phoenix Local through llm pipeline`.

### Task 5: Settings → Models Local Model Management UI

**Files:**
- Create: `packages/client/ui-settings-models/src/client/PhoenixLocalPanel.tsx`
- Create: `packages/client/ui-settings-models/src/client/PhoenixLocalPanel.module.css`
- Modify: `packages/client/ui-settings-models/src/client/ModelsSection.tsx`
- Modify: `packages/client/ui-settings-models/src/client/locales.ts`
- Modify tests under: `packages/client/ui-settings-models/tests/`

**Interfaces:**
- Panel consumes host remote methods already present on `IApiClient.hostPluginInventory`.
- UI states: `No instalado`, `Instalando`, `Listo`, `Iniciando`, `Ejecutándose`, `Detenido`, `Error`.
- Controls: model chooser, `Instalar`, `Iniciar`, `Detener`, `Desinstalar`, and mode selector `Apagado / Bajo demanda / Siempre activo`.
- Show model download size, RAM estimate, context, progress, and a concise error with retry.

- [ ] **Step 1: Write failing component/store tests**

Assert the recommended model is selected by default, install shows progress, button enablement follows lifecycle phase, uninstall requires confirmation, and mode changes persist via host remote.

- [ ] **Step 2: Run targeted UI tests and confirm RED**

Run the package’s existing Vitest command/files for Settings Models.

- [ ] **Step 3: Implement `PhoenixLocalPanel` and mount it in ModelsSection**

Keep generic cloud-provider editing unchanged. Phoenix Local is a dedicated local-device card, not a fake API-key provider row.

- [ ] **Step 4: Run package tests and confirm GREEN**

Run Settings Models tests and typecheck the package.

- [ ] **Step 5: Commit**

Commit message: `feat(local-ai): manage Phoenix Local from settings`.

### Task 6: Selector UX, Bundle Boundaries, and Operational Errors

**Files:**
- Modify only the model-selection/error UI files discovered by tracing the existing `llm.listModels()` consumer.
- Modify bundle manifests only where host availability requires it; do not add local runtime to browser-safe composition.
- Add selector/error regression tests next to the discovered model-selection component.

**Interfaces:**
- Selector renders `🔥 Phoenix Local · Offline` from the same model list as cloud models.
- Selecting an installed model works with no cloud API key.
- Selecting before installation surfaces `Phoenix Local no está instalado` with an action/link to Settings → Models rather than failing silently.

- [ ] **Step 1: Trace the existing model-selection consumer and write the regression test first**

The test must prove Phoenix Local is not special-cased into a second selector and that the model comes from `llm.listModels()`.

- [ ] **Step 2: Run the regression test and confirm RED if an actionable-install UI is absent**

- [ ] **Step 3: Implement the smallest selector/error integration needed**

Do not duplicate model catalog logic in the client.

- [ ] **Step 4: Run selector tests and confirm GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat(local-ai): surface local model in primary selector`.

### Task 7: Full Gates, Windows Validation, and Promotion

**Files:**
- Modify docs only if user-facing Settings behavior needs documentation.
- No feature code changes unless a gate exposes a real defect.

**Interfaces:**
- The exact commit that passes CI is the commit eligible for `main` and then `stable`.

- [ ] **Step 1: Run/observe static gates**

Required PR checks include `node 24 / static`, `node 24 / coverage`, compatibility/snapshot/artifact jobs, Node 22.19/26 smokes, Wine Windows gates, and native Windows blocking gates as defined by `.github/workflows/ci.yml`.

- [ ] **Step 2: Inspect every failed job log and repair root causes**

Do not bypass or weaken existing gates. Do not mark the feature complete while any required job is failing for feature-caused reasons.

- [ ] **Step 3: Verify no real large-model download occurs in CI**

The new suite must use injected fake download/process dependencies only.

- [ ] **Step 4: Verify PR diff against scope**

Confirm no recovery engine, GitHub maintainer credentials, LAN binding, or unrelated refactor entered the branch.

- [ ] **Step 5: Merge the verified PR to `main`**

Use the repository’s allowed merge method only after green required checks.

- [ ] **Step 6: Synchronize `stable` to the exact verified main commit**

Use fast-forward/ref update only when branch ancestry allows it; never implement a divergent stable-only patch.

- [ ] **Step 7: Close Issue #266 with evidence**

Record the merged commit and the green CI run/check evidence.