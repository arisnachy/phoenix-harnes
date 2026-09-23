# Agent Note: Make installed Windows desktop startup independent of nearby checkouts

Status: implemented

English | [中文](2026-09-22-windows-installed-desktop-startup.zh.md)

## Problem

The installed desktop executable could discover a conventional Phoenix checkout and start it through PowerShell and pnpm, even when that checkout lacked launch dependencies. Readiness could also outlive the supervisor or refer to a different listener than the one that passed the HTTP probe. The default profile title and telemetry plugins also imported required workspace peers omitted from the deployed base bundle, so the installed runtime exited during plugin loading. The Windows workflow compiled the Inno installer but did not launch the installed copy.

## Decision

`DesktopSourceCheckout.ShouldUseSourceCheckout` enables source mode only when `PHOENIX_SOURCE_ROOT` is explicitly set. `DesktopStartupContract.ResolveSourceRoot` accepts only a runnable explicit path; an invalid path continues into the packaged runtime. Normal installed startup uses the bundled Node runtime and managed supervisor. The base bundle declares `@phoenix-ai/dsh-session-title-llm` and `@phoenix-ai/dsh-session-telemetry` as production dependencies because its mounted title and telemetry plugins import them. The [Windows desktop documentation](../../../../docs/phoenix-windows.md) describes the user-facing install and startup choices.

Readiness requires consecutive Phoenix HTTP identity probes from the same listener PID and process creation time. The desktop validates the listener again immediately before marking the runtime ready, and an owned supervisor must still be alive. A compatible pre-existing listener is adopted only while its process identity and endpoint remain stable; the desktop does not claim or stop that process. Shutdown terminates only the process tree held by the owned `Process` handle. A verified source root is persisted only after readiness succeeds.

The Windows workflow installs the generated Inno package in a clean per-user profile before running loose executable checks. It explicitly runs the installer commands skipped by silent setup, validates shortcuts and the current-user startup entry, starts the installed executable, checks the live HTTP listener against its process tree, and runs the uninstaller. The smoke preserves installation and app data whenever it cannot verify that all processes it started have stopped; failure diagnostics remain available as a CI artifact.

## Alternatives considered

**Discover a checkout from conventional paths or a saved pointer.** Rejected because an installed application must not depend on development files or their package-manager dependencies. A runnable source tree is selected only through the explicit environment variable.

**Treat an open port or Phoenix-looking HTML as readiness.** Rejected because either can become stale or belong to another process between probes. Readiness includes the live listener PID, its creation time, the HTTP identity, and the owned supervisor state.

**Stop a process by PID through `taskkill.exe`.** Rejected because a reused PID can name another process. The desktop retains the `Process` handle it started and terminates only that process tree.

**Test only the published desktop executable.** Rejected because that does not exercise Inno payload placement, shortcuts, the startup registration, or uninstall cleanup. CI installs and launches the package produced by the same workflow.

**Rely on workspace links or automatic peer installation for plugin imports.** Rejected because the installed runtime uses a clean production dependency closure; required peers must be present in the base bundle dependencies before Cordis loads its plugins.

## Consequences

Installed startup no longer changes behavior because a Phoenix checkout happens to exist nearby. The native window remains available while the packaged runtime starts, and its status reports progress or recovery. The base bundle manifest and focused package test pin these production dependencies; the Windows installed-package smoke exercises the actual plugin load and web readiness path. A deliberately configured source checkout remains available for development; if it is not runnable or cannot complete startup, Phoenix continues with its managed runtime.

The installed-package smoke requires a GitHub-hosted Windows runner with Inno Setup and desktop support. Local contract tests and PowerShell parsing do not substitute for that Windows install-and-launch result. The test refuses to reuse an existing Phoenix profile, and it preserves diagnostics instead of deleting paths it cannot prove it owns.
