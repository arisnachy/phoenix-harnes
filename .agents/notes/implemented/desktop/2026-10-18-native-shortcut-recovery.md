# Native desktop shortcut recovery

The installer contains an interactive Windows native shell with WebView2, a single-instance window signal, and an existing Phoenix backend attach path, but the repository shortcut overwrote its launch target with a permanently visible PowerShell window. Users with a supported native install consequently lost the embedded desktop experience and saw a misleading legacy-EXE rejection message.

The canonical shortcut now chooses only a version 1.0.20+ installed Phoenix.exe and gives it the durable checkout pointer. On source-only machines, the supervised PowerShell launcher remains supported but hidden. A repeated source-only launch reopens a compatible running Web UI instead of competing for TCP port 3080. Direct `ChatGPT/Phoenix` checkouts are now discoverable from the native shell.

Windows acceptance: a supported installed EXE opens an embedded window; a source-only shortcut opens the default browser with no visible console; a second click reopens Phoenix; and missing/stale EXEs never replace a working source launch. The existing updater still owns runtime switching and rollback; no arbitrary occupied port is terminated.
