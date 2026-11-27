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

## Ambient Intelligence

Available to every model through `phoenix_ambient` in tool-living. Observations are on demand by default. Optional public-feed monitoring and local journal persistence are explicitly configured. No model-specific routing, network scanning or additional paid credentials.

- overview: host timezone, UTC, configured geographic context and cosmic hierarchy.
- network: local interface address count and passive Windows private IPv4 neighbor-cache counts (not a complete inventory).
- places: configured local catalog, category/name search, great-circle distance.
- route: optional explicitly configured local OSRM driving service, no live traffic.
- world: USGS M4.5+ past-day observations.
- space: NOAA planetary Kp observation; not ephemerides.

Set PHOENIX_AMBIENT_CONTEXT_JSON in the host environment, not in source control. Example (illustrative coordinates only):
```json
{"location":{"city":"Example","country":"Example","lat":19,"lon":-70},"places":[{"name":"Example hospital","category":"hospital","lat":19.01,"lon":-70}],"osrmPort":5000}
```
Omit the setting to keep geographic location unknown. Routing requires an independently installed local OSRM instance with regional map data. No location is transmitted to public feeds. Feed requests use fixed HTTPS sources, bounded response size, timeout, and a five-minute in-memory cache. Retrieved data is untrusted and not an emergency alert. Missing/stale data must be disclosed. No automatic collection or external action permission follows from observation.

### Extended observations

Additional operations: location (Windows provider with OS permission and allowWindowsLocation:true), map (GeoJSON output, not an embedded renderer), weather (allowPublicWeather:true only for noncommercial hosted Open-Meteo use; rounded coordinates sent to provider), moon (mean-cycle approximation), ephemeris (NASA/JPL geocentric observer table for supported bodies), journal and graph (bounded observation changes and suggested notable events).

Optional monitorPublicFeeds:true enables a 15-minute lifecycle-managed USGS/NOAA observer, without location or model calls. PHOENIX_AMBIENT_STATE_DIR (absolute path) opts into local persistence of up to 128 numeric observations; no exact location, device identities or raw feed text is stored. Without it the journal is in-memory. Configure a point FeatureCollection in geojson or the places array; these are user-provided data, not a live business directory. No proactive push/voice delivery is claimed. Windows location may be network-derived rather than GPS.

Additional adapters: services (allowLanAdvertisements:true, bounded passive IPv4 mDNS/SSDP listening; no identities, probe packets or complete inventory), satellites (CelesTrak ISS mean orbital elements; two-hour cache, no live position), sky (geometric altitude and azimuth of selected reference stars; local location required), natural-events (NASA EONET public observations, not emergency alerts). Map now returns the existing phoenix_geo_map input contract for native chat rendering; an artifact receipt is required to claim publication. With monitorPublicFeeds:true and allowAmbientVoice:true, fresh notable USGS/NOAA observations can be queued via the optional existing voice service, with six-hour in-memory deduplication. No microphone or Codex Live activation. Queue acceptance is not audible delivery.

Additional public context: news uses GDELT DOC fixed public topics; nearby-online uses opt-in rounded coordinates and fixed OSM Overpass categories. Both are on demand, rate-limited and cached. Respect provider usage policies, ODbL attribution and data coverage limits. No article claims, opening hours or complete business coverage are independently verified.

Limitations: no full network inventory, complete star catalog, satellite propagation, automatic OSM dataset acquisition, dedicated Ambient dashboard or verified Windows/provider operation. The public observations are not official local emergency notices. CI and native validation required.

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
