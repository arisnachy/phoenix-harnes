# Agent Note: Make installed Windows desktop startup independent of nearby checkouts

Status: implemented

English | [中文](2026-09-22-windows-installed-desktop-startup.zh.md)

## Problem

The installed desktop executable could discover a conventional Phoenix checkout and start it through PowerShell and pnpm, even when that checkout lacked launch dependencies. Readiness could also outlive the supervisor or refer to a different listener than the one that passed the HTTP probe. Repeated WMI command-line reads intermittently rejected the listener started by the desktop. The default profile title and telemetry plugins imported required workspace peers omitted from the deployed base bundle, and the Windows Chrome MCP row launched a source-only `tsx` entrypoint absent from the production dependency closure. The smoke script could also fail to read the desktop log while it was being appended and hide the original startup failure.

## Decision

`DesktopSourceCheckout.ShouldUseSourceCheckout` enables source mode only when `PHOENIX_SOURCE_ROOT` is explicitly set. `DesktopStartupContract.ResolveSourceRoot` accepts only a runnable explicit path; an invalid path continues into the packaged runtime. Normal installed startup uses the bundled Node runtime and managed supervisor. The base bundle declares `@phoenix-ai/dsh-session-title-llm` and `@phoenix-ai/dsh-session-telemetry` as production dependencies because its mounted title and telemetry plugins import them. The web-app bundle declares `@phoenix-ai/dsh-chrome-connector` because its Windows MCP row launches that package. Managed startup uses the bundled Node executable and the connector's compiled `lib/bin.js`; source startup keeps the `tsx` entrypoint. The [Windows desktop documentation](../../../../docs/phoenix-windows.md) describes the user-facing install and startup choices.

The desktop assembly and Inno Setup metadata use version `1.0.22`, the next Windows release after `1.0.21`. The [installer contract test](../../../../scripts/windows-installer.spec.ts) keeps both version values synchronized.

The bundled `.phoenix-managed-install` marker records the runtime seed's source commit. When a newer installer carries a different seed commit, startup installs that seed before launching the host and keeps the replaced runtime in a timestamped sibling directory so local self-modifications remain recoverable. A ready runtime remains usable when an older installer has no bundled seed.

Each readiness probe captures the loopback listener PID and process creation time before the HTTP request and again after the Phoenix HTML response. It accepts only the same live process identity across both samples. For a runtime started by the desktop, a Toolhelp32 process snapshot must show the listener process beneath the still-live supervisor; this avoids per-probe WMI command-line reads. A compatible pre-existing listener is adopted only when its command line and stable process identity match; the desktop does not claim or stop that process. Shutdown terminates only the process tree held by the owned `Process` handle. A verified source root is persisted only after readiness succeeds.

The Windows smoke reads the desktop log with shared read/write/delete access and bounded retries, so an active append does not replace the startup diagnosis. The Windows workflow installs the generated Inno package in a clean per-user profile before running loose executable checks. It explicitly runs the installer commands skipped by silent setup, validates shortcuts and the current-user startup entry, starts the installed executable, checks the live HTTP listener against its process tree, and runs the uninstaller. The smoke preserves installation and app data whenever it cannot verify that all processes it started have stopped; failure diagnostics remain available as a CI artifact.

## Alternatives considered

**Discover a checkout from conventional paths or a saved pointer.** Rejected because an installed application must not depend on development files or their package-manager dependencies. A runnable source tree is selected only through the explicit environment variable.

**Treat an open port or Phoenix-looking HTML as readiness.** Rejected because either can become stale or belong to another process between probes. Readiness includes the live listener PID, its creation time, the HTTP identity, and the owned supervisor state.

**Query WMI for every listener probe.** Rejected because intermittent command-line reads rejected a listener started by the desktop. A Toolhelp32 process snapshot verifies the owned listener's parent chain; an externally managed listener still requires a compatible command line.

**Stop a process by PID through `taskkill.exe`.** Rejected because a reused PID can name another process. The desktop retains the `Process` handle it started and terminates only that process tree.

**Test only the published desktop executable.** Rejected because that does not exercise Inno payload placement, shortcuts, the startup registration, or uninstall cleanup. CI installs and launches the package produced by the same workflow.

**Rely on workspace links or automatic peer installation for plugin imports.** Rejected because the installed runtime uses a clean production dependency closure; required peers must be present in the base bundle dependencies before Cordis loads its plugins.

**Trust a ready marker without comparing the packaged seed.** Rejected because a ready marker proves that an earlier install completed, not that it contains packages required by the current desktop release.

**Run the Chrome connector from TypeScript in the installed runtime.** Rejected because production already builds `lib/bin.js`; the web-app dependency closure includes that compiled package and invokes it with the bundled Node executable.

## Consequences

Installed startup no longer changes behavior because a Phoenix checkout happens to exist nearby. The native window remains available while the packaged runtime starts, and its status reports progress or recovery. Seed identity prevents an older ready marker from hiding packages missing from the runtime; a replaced runtime stays available for recovery of local self-modifications. The base and web-app manifests include the production packages their mounted plugins import. The web-app composition test pins the Chrome connector dependency and its managed/source entrypoints; the Windows installed-package smoke exercises the actual plugin load and web readiness path. A deliberately configured source checkout remains available for development; if it is not runnable or cannot complete startup, Phoenix continues with its managed runtime.

The installed-package smoke requires a GitHub-hosted Windows runner with Inno Setup and desktop support. Local contract tests and PowerShell parsing do not substitute for that Windows install-and-launch result. The test refuses to reuse an existing Phoenix profile, and it preserves diagnostics instead of deleting paths it cannot prove it owns.
