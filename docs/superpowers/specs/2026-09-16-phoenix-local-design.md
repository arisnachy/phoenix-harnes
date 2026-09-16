# Phoenix Local — Design

**Date:** 2026-09-16
**Issue:** #266

## Goal
Make a local LLM a first-class Phoenix model. The user installs and controls it from Settings and selects **Phoenix Local** from the same model selector used for cloud models. It must use Phoenix's existing conversation, streaming and tool abstractions rather than a parallel chat.

## Default model
Recommended initial model: `Qwen3.5-4B` in `Q4_K_M` GGUF, served by a Phoenix-managed `llama.cpp/llama-server`. The implementation is model-agnostic: the UI label is **Phoenix Local** and the selected GGUF is configuration.

## UX
Settings → Models gains **Local models** with: model choice, disk size/RAM estimate, install progress, Install, Start, Stop, Uninstall, and mode selection. Modes are `off`, `on-demand` (default), and `always-on`. Runtime states are `not-installed`, `installing`, `ready`, `starting`, `running`, `stopped`, and `error`.

The main selector exposes **Phoenix Local · Offline**. If selected while no local model is installed, Phoenix routes the user to the local-model Settings card instead of failing silently. When installed, selection routes normal turns through the local provider.

## Runtime architecture
Create a model-agnostic `LocalModelProvider` behind the existing LLM/provider contract. A local-runtime supervisor owns the external `llama-server` process; renderer/UI code never owns the process. Bind only to `127.0.0.1`, choose a free local port, and use an ephemeral local secret where supported.

Phoenix stores managed runtime/model artifacts under its application data directory, not the repository. Downloads are opt-in, resumable/atomic, verified before activation, and never execute a partially downloaded runtime. Uninstall first stops the managed process and then deletes only Phoenix-managed artifacts.

`on-demand` starts the runtime on first local request and unloads it after configurable inactivity. `always-on` starts it with Phoenix. `off` never starts it automatically. Stopping the runtime must never stop Phoenix.

## Resources
Default context is conservative (8K; user-configurable up to 16K in v1). Before start, a resource guard checks available RAM and refuses startup with an actionable message if the configured model would materially endanger system responsiveness. Users can stop the runtime immediately from Settings.

## Request path
Selector → existing model-selection state → provider router → `LocalModelProvider` → loopback OpenAI-compatible endpoint exposed by `llama-server`. Streaming is translated into the same Phoenix events used by cloud providers. Tool definitions are supplied through the existing tool pipeline; tool execution remains controlled by Phoenix, never directly by the model server.

## Failure behavior
Failure to download/start/health-check the local runtime is isolated to the local provider and surfaced in Settings/model selection. It must not crash the shell or switch providers without an explicit existing fallback policy. Partial installs remain inactive and retryable.

## Security
Loopback only; validate managed paths; reject path traversal; verify expected artifact digest/size before activation; do not expose LAN listeners; never treat model output as authority to install or execute arbitrary binaries.

## Testing
CI uses fake runtime/download adapters: no multi-GB model download. Cover catalog/config state, install/start/stop/uninstall lifecycle, selector visibility, selection-before-install routing, local-provider streaming, tool-call translation, resource-guard refusal, corrupt-download rejection, and process-crash isolation. Windows is the primary platform; Linux/macOS behavior must not regress.

## Promotion
Implement on `feat/phoenix-local-20260916`. Run relevant unit tests, typecheck, lint and build. Merge to `main` only after gates pass; synchronize `stable` from the exact verified commit rather than implementing separately.

## Explicitly out of scope
Automatic repair, Last Known Good, A/B updater recovery and autonomous GitHub repair are a later phase. First Phoenix Local must work end-to-end as an ordinary selectable model.