# PHOENIX on Windows

English | [中文](phoenix-windows.zh.md)

## Install and update

Run the one-line PowerShell installer from the repository README. It installs a dedicated checkout under `%LOCALAPPDATA%\Programs\PHOENIX`, builds the exact `main` revision, and creates **PHOENIX HARDNESS** shortcuts in the Start menu, Windows startup, and the taskbar shortcut store. Windows versions that do not expose a localized pin action still receive a taskbar-ready shortcut; pin it once from the shortcut context menu. Use `-NoStartup` or `-NoTaskbar` to opt out. Managed launches fetch `origin/main` and accept only a clean fast-forward; local modifications stop the update instead of being overwritten. Set `PHOENIX_AUTO_UPDATE=0` to disable launch-time checks.

The managed PowerShell bootstrap and `Phoenix-Windows-Setup.exe` do not carry Authenticode signatures. A trusted signed release requires an external publisher certificate and remains a release credential gate.

## Native desktop app

Run `Phoenix-Windows-Setup.exe` to install the per-user desktop app under `%LOCALAPPDATA%\Programs\Phoenix`. Setup creates a Start menu shortcut and offers desktop-shortcut and Windows-startup tasks. When the startup task is selected, Phoenix opens when the current user signs in.

Interactive setup prepares the bundled production runtime and the dedicated WebView2 profile before opening Phoenix. Normal installed launches use the packaged runtime and do not select a checkout found in a conventional folder. Set `PHOENIX_SOURCE_ROOT` only when intentionally launching a runnable source checkout; an unavailable or invalid path leaves Phoenix on its packaged runtime.

The native window opens while Phoenix checks runtime readiness and reports startup or recovery status. Closing the window hides Phoenix to the notification area; launching its shortcut again restores the existing window.

## VS Code and Cursor

Run `pnpm run package:vscode`, then install `dist/phoenix-hardness-vscode.vsix` through **Extensions → Install from VSIX**. The Explorer panel can install or update PHOENIX, start the local runtime, and open its Web interface. It never reads provider credentials.

## Native safety boundary

Windows commands use the repository's native restricted-token and ACL runner. `read-only` and `workspace-write` fail closed when that runner cannot start. The backend reports partial enforcement because Windows ACLs cannot promise network isolation, process invisibility, or protection from every `Everyone` grant and hard-link alias. `danger-full-access` bypasses the file fence and uses the `never` approval policy, so selecting Full access does not create a second approval prompt for file operations; it is not described as a sandbox.

Run `pnpm run check:ci:windows-complete` on a real Windows kernel for the authoritative native gate. Wine remains a compatibility signal, not proof of the Windows ACL backend.

## Continuity

Session history remains local and durable. PHOENIX does not upload it by default. A future cloud backup must be opt-in, encrypted before transport, credential-redacted, revision-aware, and conflict-safe; telemetry is not a history backend. No cloud-history provider is advertised until a real remote receipt and restore test pass for the same revision.
