# @phoenix-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host diagnostics service for the current Cordis Loader tree and PHOENIX stable-update lifecycle. `PluginInventoryGateway` registers the `pluginInventory` Remote namespace. `pluginInventory/list` remains a read-only point-in-time projection of non-group Loader entries; `pluginInventory/updateState` exposes a sanitized snapshot of the repository-local updater state; `pluginInventory/refreshForUpdate` durably wakes the detached watcher for an immediate stable-channel check; `pluginInventory/restartForUpdate` accepts a restart only when that trusted state is exactly `ready` with a valid prepared target.

The ChatGPT Web lifecycle is also Host-owned. `pluginInventory/chatGptWebState`, `pluginInventory/enableChatGptWeb`, and `pluginInventory/disableChatGptWeb` expose a sanitized ON/OFF controller for the loopback browser bridge. The enabled preference is persisted separately from process ownership: only an explicit ON is restored after Host startup, health must reach a usable `/v1/models` response before Settings can expose the provider route, and browser credentials never cross this Remote boundary.

The Host also owns pinned vendor MCP bundles that cannot safely use the generic registry installer. The official X bundle installs the keyless `https://docs.x.com/mcp` endpoint plus X's official `@xdevplatform/xurl` stdio bridge to `https://api.x.com/mcp`. The bridge configuration stores only `X_CLIENT_ID` and `X_CLIENT_SECRET` credential references; their values remain in the Phoenix credential provider and are injected only into the spawned xurl generation. Activation is model-visible only through a user-approved connector tool and performs no X account action by itself.

The Loader inventory reads `ctx.loader.entries()` directly on every call, skips structural group rows, and returns Loader entry id, module specifier, effective enablement, and current root Fiber phase. The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. Loader remains the sole plugin-lifecycle authority. Trusted Settings mutations now call `pluginInventory/setPluginEnabled` for exact existing entries and `pluginInventory/activateAvailablePlugins` for best-effort bulk activation plus the curated MCP pack. Owner selections persist atomically in `$DSH_HOME/settings/plugin-enablement.json` and are restored on Host startup or newly loaded entries, without treating pending dependencies as ready services. No arbitrary ClawHub packages, OAuth scopes or executables are approved by these controls.

Updater state lives under the checkout's Git directory, outside `$DSH_HOME`. The Host caches only the resolved Git control directory per checkout root and invalidates that path lookup when the root's `.git` marker identity or pointer content changes or disappears; it reads the updater JSON fresh for every snapshot. The updater replaces this JSON document atomically, and the Host also retries a transient read race. The Host bridge recognizes only the documented updater status vocabulary, bounds free-text fields, accepts only full 40-character commit ids, and never lets the browser supply an activation target. A refresh request is a separate atomic marker consumed by the watcher, so the browser does not mistake rereading stale state for a new channel check. A restart request is bound to the exact `ready` target already written by the detached stable updater, then the Host schedules its own exit only after the request is durable. The updater process owns activation, rollback, and relaunch after the Host exits.

Public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`. The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

Telegram owner-paired messages run through the configured Phoenix session gateway; while execution is pending, the Host emits Telegram's ephemeral `sendChatAction(typing)` indicator, not an automatic acknowledgement message. Only model-visible answers or explicit failure reports become chat text. Typing failures do not prevent the Agent from completing.

## Model Experience

None, as this Host-only diagnostics and update-control service registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time plugin state only** — the inventory contains no durable plugin failure history or subscription; a missing root Fiber is reported as `null` regardless of why no live root exists.
- **Updater progress is phase-based** — the updater reports source, dependency, build, smoke, activation, and rollback phases rather than byte-level download percentages.
- **Restart is intentionally narrow** — Web can request activation only for the updater's exact prepared `ready` target; arbitrary checkout switching and plugin mutation are outside this service.

Registry installation accepts only concrete remote endpoints. URI templates with literal or percent-encoded braces are excluded from automatic installation, allowing a later concrete endpoint in the same server entry to be selected.

## Anatomía 3D · Conectores

**Conectores → Anatomía 3D** presenta siete capacidades locales con comprobación independiente y acciones autorizadas desde el Host. El check indica **paquete detectado**, no una integración clínicamente validada. Cada instalación es optativa, aislada en `%LOCALAPPDATA%\\PHOENIX\\anatomy` en Windows y no lee expedientes de HealthIA.

- **3D Slicer + SlicerHeart:** instalador WinGet oficial y verificación de extensión.
- **MONAI + nnU-Net:** entorno Python aislado; pesos de modelos específicos por tarea separados.
- **TotalSegmentator:** descarga inicial del modelo abierto `total`, solo si existen los recursos necesarios; otras tareas pueden requerir licencia.
- **Cornerstone3D + OHIF:** instala librerías Cornerstone. OHIF necesita despliegue y PACS/DICOMweb autorizado; la instalación de paquetes **no** activa un visor clínico listo.
- **SimVascular / openCARP:** se inspeccionan binarios oficiales externos/WSL2; no se fuerzan instalaciones ni modelos fisiológicos sin configuración científica.
- **Three.js + vtk.js:** bibliotecas 3D locales, con visor experimental GLB en PHOENIX; cortar volúmenes y validar mallas requiere etapas adicionales.

El actualizador (`update-phoenix.ps1`) y el arranque con `pnpm phoenix` lanzan el bootstrap sin bloquear la interfaz. Los botones individuales usan exclusivamente IDs de componentes permitidos y su ejecución permanece sujeta a recursos locales, red y licencias.

Diagnóstico desde la raíz del repositorio:

```powershell
node .\\scripts\\phoenix-anatomy-auto.mjs --status
node .\\scripts\\phoenix-anatomy-auto.mjs --install-component totalsegmentator
node .\\scripts\\phoenix-anatomy-simulation.mjs doctor
Get-Content "$env:LOCALAPPDATA\\PHOENIX\\anatomy\\install.log" -Tail 50
```

Kira dispone de `health_anatomy_connectors`, `health_anatomy_status` y `health_anatomy_prepare(component)`. El inicio de instalación no equivale a éxito: comprobar la presencia real del componente y del archivo de salida GLB o de la simulación. La validación clínica, los estudios específicos, la privacidad de pacientes y los modelos docentes adicionales mantienen controles independientes.
