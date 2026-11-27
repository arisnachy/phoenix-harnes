# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral, fail-soft policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## PHOENIX Adaptive OS · propiocepción y autorización

Windows Native inventory extends the existing system inspection with local WinApp CLI, ODR, Foundry, OCR and transcription command detection, plus UI Automation, App Actions, Windows OCR and Windows ML API probes. No additional subscription, downloads, cloud calls or billing are required by this inventory. Missing evidence is reported as not checked; detected APIs do not prove permission or working invocation. Microsoft Copilot is manual only. Agent Launchers registration is not implemented here: it requires package identity and an associated registered App Action. Use the existing authorized shell for installed local tools, not an unapproved execution path.


Esta integración expone herramientas que Kira puede usar a petición del usuario, sin conceder permisos por observar el entorno:

- `system_environment_inspect`: identifica el Host actual, arquitectura y versión del SO, CPU, núcleos, RAM, GPU anunciada, factor de forma (escritorio/portátil) y presencia de un conjunto acotado de comandos/aplicaciones Windows. No se extraen rutas, serie, nombre de equipo, identidad del usuario, procesos ni credenciales. Las limitaciones de GPU se marcan como «no verificadas».
- `system_runtime_inspect`: lista solo nombres de herramientas registrados realmente en el Host y metadatos acotados de conectores Living no clínicos. Nunca incluye tokens, recursos completos, pacientes ni contraseñas. Registro no implica autorización.
- `system_app_search`: busca nombres de aplicaciones del menú Inicio para un término explícito y validado (hasta 16 resultados), sin enumerar todo el software instalado ni ejecutar programas.
- `adaptive_app_action_plan`: consulta si una acción no clínica existe y está conectada; no produce cambios.
- `adaptive_app_execute_approved`: comprueba conector/acción, presenta los argumentos concretos en ASK, exige una respuesta humana única, revalida el conector después y ejecuta solo esa operación. La falta de proveedor ASK, la expiración, la cancelación o las rutas clínicas deniegan. Los resultados inciertos no se repiten automáticamente.
- `living_act` (compatibilidad): redirigido al mismo control de consentimiento por acción; no existe una ruta de ejecución Living sin aprobación.

Para una app genérica, un input configurado hacia API, chat o IA solo abre una revisión explícita y prepara un borrador del chat. No envía valores clínicos ni concede permisos a conectores desde el DOM. Los formularios y su esquema permanecen separados de los datos clínicos de `/health`.

### Persistent authorized router inspection

On Windows, run `powershell -NoProfile -STA -File .\scripts\phoenix-router-enroll.ps1 -Graphical` locally from the repository root. The enrollment script detects the current private gateway and asks for the router vendor, account, independently verified SHA-256 TLS certificate fingerprint, optional trusted PEM CA, explicit read authorization and a hidden password. Windows DPAPI protects the password for the current Windows account; no secrets are sent through chat, tool parameters, telemetry or source control. Run the same command with `-Remove` to revoke the local profile. A certificate replacement requires re-enrollment; do not disable TLS checks.

`phoenix_network_intelligence router-profile-status` reports local enrollment without claiming authentication. `router-managed-inspect` revalidates the gateway, connects directly over HTTPS and reports bounded OpenWrt ubus, MikroTik RouterOS v7 REST or OPNsense API telemetry. The router must expose its supported HTTPS API with a certificate trusted by Node or by the locally selected CA, valid for the gateway IP. OpenWrt reports board, firmware, uptime, WAN and radio state; MikroTik reports system resources, interface counts and DHCP lease counts. OPNsense uses an API key and secret and reports verified product version and cached firmware status, with approved reboot support. Its interface response is detected but raw data is not returned. Failed authentication stops without guessing and imposes a one-minute in-process cooldown. Repeat read authorization is separate from write authorization; `router-managed-reboot` supports a separately approved restart using the enrolled HTTPS account on supported firmware, without automatic retries or claims of verified recovery. Existing approved OpenWrt SSH reboot and reload are unchanged. Unknown brands, browser login, per-client traffic and configuration writes are not implemented by this adapter.

The Host runs a passive one-minute observer while the plugin is loaded. The `network-history` operation returns up to 60 latest aggregate samples; the Windows user-local journal retains at most 1,440 samples and 24 hours. It records only counts and host traffic rates, not packet contents or device names. History may include different local networks; samples with a locally pseudonymized gateway identity are compared only with the same scope. The report flags fresh host traffic spikes (at least ten recent comparable samples, five times the median and at least 1 MiB/s) and groups of five or more newly observed neighbor-cache entries. These are observations, not intrusion findings; no repair is automatically triggered. The inventory includes a logical topology of the default route, local interface and observed neighbor-cache entries, not inferred physical links. Traffic is not router-wide. Closing the Host stops sampling. Disk errors degrade to memory-only observation. The Windows inventory reports local link speed and status, DNS server count and passive IPv6 neighbor count when available. Link-layer pseudonyms use a user-local random salt and the gateway MAC namespace; raw MAC addresses are not returned. Address-only IDs can change when DHCP reassigns addresses, and MAC pseudonyms do not prove device ownership.

For enrolled MikroTik RouterOS v7 routers, `router-managed-policy` queries fixed HTTPS read-only resources for DHCP servers, DNS remote-request status, IPv4/IPv6 firewall rule counts, simple queues and queue trees, and modern/legacy Wi-Fi interface counts. Each unavailable resource stays null; counts are not a security assessment. This operation never edits configurations and is not supported on other adapters yet. See the vendor REST API documentation: https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST%2BAPI.

### Recuperación del supervisor en Windows (instalación voluntaria)

`scripts/phoenix-windows-supervisor.mjs` ya es dueño del Host y gestiona sus reinicios. El guardián adicional sirve únicamente para el caso en que **también desaparezca ese supervisor**. Comprueba la identidad del PID mediante CIM y el heartbeat protegido de Git antes de iniciar una instancia; nunca mata procesos y deja de insistir ante arranques repetidamente fallidos. La instalación automática no forma parte de PHOENIX.

Desde PowerShell 5.1 en el directorio del repositorio:

```powershell
# Ver si el guardián está instalado
powershell -NoProfile -File .\scripts\phoenix-windows-guardian-task.ps1 -Status

# Instalación voluntaria en tareas programadas (sin privilegios elevados)
powershell -NoProfile -File .\scripts\phoenix-windows-guardian-task.ps1 -Install

# Desactivar y retirar la tarea persistente
powershell -NoProfile -File .\scripts\phoenix-windows-guardian-task.ps1 -Uninstall
```

El guardián solo puede operar en la sesión de Windows de la persona que instaló la tarea. No prueba recuperación de caídas del sistema operativo ni sustituye backups de datos. El reinicio del Host mantiene todas las reglas existentes de la instancia única, protección de cambios locales y último runtime correcto.

### Comprobaciones antes de fusionar

`pnpm run test:adaptive:all`, typecheck del Host y cliente, gates Windows, CI y escaneo de distribución pública. El trabajo se mantiene fuera de `main` y `stable` mientras esas verificaciones no estén aprobadas.

## Model Experience

### Universal creation policy

#### What the model sees

The requested deliverable remains the mission. Phoenix connectivity is an optional enhancement unless the user explicitly requested it, previously opted in for that creation, or the connector is required for the requested functionality. The model must not register or install a connector merely because an artifact was created; when connectivity is useful and preference is unknown, it asks once. Connector setup is bounded to two connect/repair attempts and roughly ten seconds of foreground work, then fails soft: preserve any offline manifest, report degradation, and continue independent task work. A user request to skip or finish without the connector stops connector work for that turn.

#### Token effect

One bounded domain-neutral policy replaces domain-specific creation instructions. Its cost is fixed while the plugin is active and does not grow with the number of remembered creations.

#### KV Cache effect

The policy text is prefix-stable while the plugin version and registration scope are unchanged. Creation-specific state is queried through tools instead of being appended to every request.

### Living tools

#### What the model sees

The model receives schemas for registering, inspecting, listing, reading, acting on, verifying, obtaining connector kits, and explicitly forgetting creations. `living_verify_creation` is used only when Phoenix connectivity is an explicit acceptance criterion, not as a universal completion gate. When a connector is used, the model exposes only the smallest meaningful state/actions/events, keeps telemetry bounded, retains enough manifest resources to reconnect later, and never exposes or commits the bearer token. Background agents remain optional and require user approval; connectivity never implies background workers.

#### Token effect

Tool schema cost is fixed per visible tool set. Creation manifests, telemetry, and errors enter context only when the model invokes the corresponding inspection/read/verification tools.

#### KV Cache effect

Schemas remain cache-stable while visibility and definitions are unchanged. Per-creation updates affect tool results at the history tail rather than rewriting the reusable prompt prefix.

## Known Limitations and Deferred Work

- The generated connector kit is intentionally transport-light and owner-local. Public browser bundles must not contain the bearer token; browser-facing products should keep the Phoenix connector in a server-side process/sidecar or use another secure provider implementation.
