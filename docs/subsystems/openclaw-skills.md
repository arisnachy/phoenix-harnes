# Skills OpenClaw en PHOENIX

PHOENIX integra el directorio oficial [`openclaw/openclaw/skills`](https://github.com/openclaw/openclaw/tree/main/skills) mediante el puente `dsh openclaw-skills`. La fuente auditada usa licencia MIT (commit `629a47e3cc20a9f8b6d19c105f840b8a693ec4aa`). La licencia hace gratuitas la descarga, las instrucciones y los recursos; no hace gratuitas las cuentas, APIs, dispositivos, CLIs o servicios externos descritos por algunas skills.

## Instalación y actualización

```text
dsh openclaw-skills sync
dsh openclaw-skills list
dsh openclaw-skills verify
dsh openclaw-skills doctor
dsh openclaw-skills inspect openclaw-weather
```

La sincronización mantiene el checkout en `$DSH_HOME/openclaw-skills/openclaw`, instala los bundles en `$DSH_HOME/skills/openclaw-<nombre>` y guarda el estado en `$DSH_HOME/openclaw-skills/arsenal.json`. Solo elimina/reemplaza entradas `openclaw-*` que el puente haya registrado; no toca skills de otros proveedores. Los recursos relativos (`references/`, `scripts/`, `bin/`, etc.) se conservan.

## Invocación dentro del harness

El catálogo se descubre mediante `dsh-skill-filesystem` y se carga con el `skill` tool de PHOENIX usando el alias exacto:

```text
skill({ name: "openclaw-weather" })
skill({ name: "openclaw-diagram-maker" })
```

La carga de una skill prueba que sus instrucciones están disponibles. No equivale a ejecutar el CLI, API, dispositivo o servicio que la skill documenta. Antes de ejecutar una acción real hay que comprobar la señal correspondiente y disponer del runtime/credencial requerido. `doctor` informa esas condiciones como advertencias y nunca guarda valores de secretos.

**Leyenda de señales:** `network` = la guía documenta HTTP, `curl`, `fetch` o una herramienta web; `external-runtime` = documenta un CLI, intérprete o binario adicional; `credentials` = documenta autenticación, token, API key u OAuth; `platform-specific` = menciona una plataforma o dispositivo concreto; `local/offline` = no se detectó ninguna de esas señales en el texto. Son marcadores de auditoría, no pruebas de disponibilidad.

## Revisión individual

Todos los 51 bundles quedaron instalados, anunciados y cargados por `ctx.skills.get()`; cada fila corresponde a una revisión individual. `Recursos` cuenta archivos adicionales a `SKILL.md`.

| Alias PHOENIX | Origen | Función documentada | Señales | Recursos |
|---|---|---|---|---:|
| `openclaw-1password` | `1password` | Configurar y usar 1Password CLI para inicio de sesión, integración de escritorio y secretos. | network, external-runtime, credentials, platform-specific | 2 |
| `openclaw-apple-notes` | `apple-notes` | Crear, consultar, editar, borrar, buscar, mover o exportar Apple Notes con `memo`. | network, external-runtime, platform-specific | 0 |
| `openclaw-apple-reminders` | `apple-reminders` | Administrar Apple Reminders y sus listas con `remindctl`. | network, external-runtime, platform-specific | 0 |
| `openclaw-bear-notes` | `bear-notes` | Crear, buscar y administrar notas Bear con `grizzly`. | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-blogwatcher` | `blogwatcher` | Vigilar blogs y feeds RSS/Atom con `blogwatcher`. | network, external-runtime | 0 |
| `openclaw-blucli` | `blucli` | Descubrir, reproducir, agrupar y ajustar volumen en BluOS. | network, external-runtime | 0 |
| `openclaw-camsnap` | `camsnap` | Capturar cuadros o clips de cámaras RTSP/ONVIF y webcams. | network, external-runtime, platform-specific | 0 |
| `openclaw-clawhub` | `clawhub` | Buscar, instalar, verificar, actualizar, desinstalar, publicar o sincronizar skills de ClawHub. | network, external-runtime | 0 |
| `openclaw-coding-agent` | `coding-agent` | Delegar trabajo de código a Codex, Claude Code u OpenCode. | external-runtime, credentials | 0 |
| `openclaw-diagram-maker` | `diagram-maker` | Crear diagramas SVG/HTML o Excalidraw para conceptos, arquitectura y flujos. | local/offline | 2 |
| `openclaw-eightctl` | `eightctl` | Controlar pods Eight Sleep: estado, temperatura, alarmas y horarios. | network, credentials | 0 |
| `openclaw-gemini` | `gemini` | Usar Gemini CLI para prompts, resúmenes, generación, skills, hooks y MCP. | network, external-runtime | 0 |
| `openclaw-gh-issues` | `gh-issues` | Consultar issues GitHub, seleccionar candidatos, lanzar agentes y abrir PRs. | network, external-runtime, credentials | 0 |
| `openclaw-gifgrep` | `gifgrep` | Buscar GIFs, descargar resultados y extraer cuadros o láminas. | network, external-runtime, credentials | 0 |
| `openclaw-github` | `github` | Usar GitHub CLI para issues, PRs, CI, comentarios, releases y API. | network, external-runtime, credentials | 0 |
| `openclaw-gog` | `gog` | Usar Google Workspace CLI para Gmail, Calendar, Drive, Contacts, Sheets y Docs. | network, external-runtime, credentials | 0 |
| `openclaw-goplaces` | `goplaces` | Consultar Google Places: búsqueda, detalles, resolución y reseñas. | network, external-runtime, credentials | 0 |
| `openclaw-healthcheck` | `healthcheck` | Auditar y endurecer hosts OpenClaw: SSH, firewall, actualizaciones, exposición y copias. | credentials, platform-specific | 0 |
| `openclaw-himalaya` | `himalaya` | Administrar correo IMAP/SMTP: listar, leer, buscar, redactar, responder y mover. | network, external-runtime, credentials | 2 |
| `openclaw-mcporter` | `mcporter` | Listar, configurar, autenticar, llamar e inspeccionar servidores y herramientas MCP. | network, external-runtime, credentials | 0 |
| `openclaw-meme-maker` | `meme-maker` | Buscar plantillas, sugerir formatos y generar memes locales o alojados. | external-runtime, credentials | 2 |
| `openclaw-model-usage` | `model-usage` | Resumir logs locales de coste de Codex o Claude por modelo. | network, external-runtime, platform-specific | 3 |
| `openclaw-nano-pdf` | `nano-pdf` | Editar PDFs con instrucciones naturales mediante `nano-pdf`. | network, external-runtime | 0 |
| `openclaw-node-connect` | `node-connect` | Diagnosticar conexiones de nodos web y Android/iOS/macOS: ruta, auth, pairing y reconexión. | external-runtime, credentials, platform-specific | 0 |
| `openclaw-node-inspect-debugger` | `node-inspect-debugger` | Depurar Node.js con inspect, CDP, breakpoints, heap y perfiles CPU. | network, external-runtime | 0 |
| `openclaw-notion` | `notion` | Usar Notion CLI/API para páginas, Markdown, data sources, archivos, comentarios y búsqueda. | network, external-runtime, credentials | 0 |
| `openclaw-obsidian` | `obsidian` | Leer, buscar y editar notas, tareas, enlaces, propiedades y plugins de Obsidian. | network, external-runtime, platform-specific | 0 |
| `openclaw-openai-whisper` | `openai-whisper` | Transcribir audio localmente con Whisper CLI. | network, external-runtime | 0 |
| `openclaw-openai-whisper-api` | `openai-whisper-api` | Usar Audio Transcriptions API mediante `curl`. | network, external-runtime, credentials | 1 |
| `openclaw-openhue` | `openhue` | Controlar luces y escenas Philips Hue con OpenHue CLI. | network, external-runtime | 0 |
| `openclaw-oracle` | `oracle` | Hacer revisión, depuración, refactor o diseño con Oracle CLI. | network, external-runtime, credentials | 0 |
| `openclaw-ordercli` | `ordercli` | Consultar pedidos pasados y activos de Foodora (Deliveroo WIP). | network, external-runtime, platform-specific | 0 |
| `openclaw-peekaboo` | `peekaboo` | Capturar y automatizar la interfaz macOS con Peekaboo CLI. | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-python-debugpy` | `python-debugpy` | Depurar Python con `pdb`, post-mortem, breakpoints y debugpy remoto. | external-runtime, platform-specific | 0 |
| `openclaw-sag` | `sag` | Generar texto a voz con ElevenLabs y experiencia `say` de macOS. | network, external-runtime, credentials | 0 |
| `openclaw-session-logs` | `session-logs` | Buscar y analizar logs propios de sesiones con `jq`. | local/offline | 0 |
| `openclaw-sherpa-onnx-tts` | `sherpa-onnx-tts` | Texto a voz local con sherpa-onnx, sin nube. | network, external-runtime, platform-specific | 1 |
| `openclaw-skill-creator` | `skill-creator` | Crear, reparar, validar o reestructurar `SKILL.md` y sus recursos. | external-runtime | 5 |
| `openclaw-songsee` | `songsee` | Generar espectrogramas y paneles de características de audio. | network, external-runtime | 0 |
| `openclaw-sonoscli` | `sonoscli` | Descubrir y controlar altavoces Sonos, reproducción, volumen y grupos. | network, external-runtime, credentials | 0 |
| `openclaw-spike` | `spike` | Ejecutar prototipos desechables, comparar enfoques y emitir veredicto. | external-runtime | 0 |
| `openclaw-spotify-player` | `spotify-player` | Reproducir y buscar en Spotify desde terminal con `spogo` o `spotify_player`. | network, external-runtime | 0 |
| `openclaw-summarize` | `summarize` | Resumir o transcribir URLs, YouTube, podcasts, artículos, PDFs y archivos locales. | network, external-runtime, credentials | 0 |
| `openclaw-taskflow` | `taskflow` | Coordinar tareas separadas como un job durable con estados, esperas e hijos. | credentials | 2 |
| `openclaw-taskflow-inbox-triage` | `taskflow-inbox-triage` | Ejemplo de TaskFlow para triage de bandeja, routing y esperas. | local/offline | 0 |
| `openclaw-things-mac` | `things-mac` | Administrar tareas, inbox, hoy, proyectos, áreas y tags de Things 3. | network, external-runtime, credentials, platform-specific | 0 |
| `openclaw-tmux` | `tmux` | Controlar sesiones y paneles tmux, capturar salida y enviar teclas. | platform-specific | 2 |
| `openclaw-trello` | `trello` | Administrar tableros, listas y tarjetas Trello mediante REST API. | network, external-runtime, credentials | 0 |
| `openclaw-video-frames` | `video-frames` | Extraer cuadros o clips cortos de vídeo con `ffmpeg`. | network, external-runtime | 1 |
| `openclaw-weather` | `weather` | Consultar clima y pronósticos con `web_fetch` o `wttr.in`/`curl`. | network, external-runtime | 0 |
| `openclaw-xurl` | `xurl` | Publicar, leer, buscar, enviar DMs y usar la API v2 de X con `xurl`. | network, external-runtime, credentials | 0 |

## Evidencia

- `pnpm run verify:openclaw-skills`: 51/51 cargas exitosas mediante `ctx.skills.list()` + `ctx.skills.get()`.
- `dsh openclaw-skills verify`: 51/51 cuerpos y 23/23 recursos instalados presentes.
- `dsh openclaw-skills doctor`: Git, checkout upstream, estado y puente nativo correctos; advertencias separadas para dependencias opcionales.
- Informe sin cuerpos ni secretos: `docs/superpowers/evidence/openclaw-skills-verification.json`.
