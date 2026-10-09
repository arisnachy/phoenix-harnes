# Windows free-capability inventory

## Decision

Expose a **read-only, opt-in** Windows prerequisite inventory through `pnpm run windows:capabilities`. Keep the normal Phoenix startup unchanged. Use built-in Node and the existing Windows PowerShell installation; no paid provider, package installation, admin privilege, secret inspection, or credential material is needed.

## Boundaries

- A detected `ollama` or `foundry` command is not proof that a model is installed or performant.
- A graphics adapter is not proof of GPU or NPU inference support.
- Windows App SDK notifications require a native application bridge; this inventory does not send notifications.
- Windows AI APIs require OS, SDK, hardware, model, and readiness checks.
- MXC's current Node SDK requires Node 24+, whereas Phoenix also supports Node 22; do not install or require MXC until an optional compatible execution path is proven.
- The command does not install runtimes, spawn agents, enable WSL, or mutate Windows settings.

## Verification

Run `pnpm exec vitest run scripts/phoenix-windows-free-capabilities.spec.ts` on a supported development checkout; run `pnpm run windows:capabilities` on Windows and inspect the safe JSON output. CI cannot substitute for a physical-device readiness test. Missing prerequisites must remain labeled as unavailable rather than silently enabled.
