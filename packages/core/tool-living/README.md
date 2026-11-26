# `@phoenix-ai/dsh-tool-living`

English | [中文](README.zh.md)

Model-facing consumer for Universal Living Creations. It installs one domain-neutral, fail-soft policy and tools for registering, provisioning connectors, inspecting, listing, reading, acting on, verifying, and explicitly forgetting creations through `ctx.living`.

## PHOENIX Adaptive OS · propiocepción y autorización

Esta integración expone herramientas que Kira puede usar a petición del usuario, sin conceder permisos por observar el entorno:

- `system_environment_inspect`: identifica el Host actual, arquitectura y versión del SO, CPU, núcleos, RAM, GPU anunciada, factor de forma (escritorio/portátil) y presencia de un conjunto acotado de comandos/aplicaciones Windows. No se extraen rutas, serie, nombre de equipo, identidad del usuario, procesos ni credenciales. Las limitaciones de GPU se marcan como «no verificadas».
- `system_runtime_inspect`: lista solo nombres de herramientas registrados realmente en el Host y metadatos acotados de conectores Living no clínicos. Nunca incluye tokens, recursos completos, pacientes ni contraseñas. Registro no implica autorización.
- `system_app_search`: busca nombres de aplicaciones del menú Inicio para un término explícito y validado (hasta 16 resultados), sin enumerar todo el software instalado ni ejecutar programas.
- `adaptive_app_action_plan`: consulta si una acción no clínica existe y está conectada; no produce cambios.
- `adaptive_app_execute_approved`: comprueba conector/acción, presenta los argumentos concretos en ASK, exige una respuesta humana única, revalida el conector después y ejecuta solo esa operación. La falta de proveedor ASK, la expiración, la cancelación o las rutas clínicas deniegan. Los resultados inciertos no se repiten automáticamente.
- `living_act` (compatibilidad): redirigido al mismo control de consentimiento por acción; no existe una ruta de ejecución Living sin aprobación.

Para una app genérica, un input configurado hacia API, chat o IA solo abre una revisión explícita y prepara un borrador del chat. No envía valores clínicos ni concede permisos a conectores desde el DOM. Los formularios y su esquema permanecen separados de los datos clínicos de `/health`.

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
