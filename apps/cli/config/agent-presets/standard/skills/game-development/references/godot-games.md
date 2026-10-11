# Godot 4 y Blender: 2D, 3D y mundos abiertos

Godot y Blender permiten desarrollo local sin una API de pago. Verifica las versiones con el toolkit; usa `PHOENIX_GODOT_BIN`/`PHOENIX_BLENDER_BIN` si el editor no está en PATH. Un motor instalado no incluye automáticamente sus plantillas de exportación. Consulta documentación y plantillas de la versión exacta: [Godot](https://docs.godotengine.org/en/stable/) y [Blender](https://docs.blender.org/manual/en/latest/).

## Elección de motor y aprovisionamiento bajo demanda

Kira debe seleccionar el motor **antes** de crear presets. Para una producción compleja 2D/2.5D nativa, Godot es el motor recomendado; Tiled es el editor de zonas/tiles y FFmpeg prepara efectos y pistas. Para 3D añade Blender. Para juegos dentro del chat usa HTML5/Canvas y atlases exportados: el export Web de Godot **no** es un documento autocontenido compatible con `phoenix_game`.

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs route --genre "beat-em-up" --delivery desktop --quality production
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs doctor --target godot
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs plan --target godot --platform win32
# Solo cuando la misión haya autorizado aprovisionamiento de programas:
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs ensure --target godot --allow-install
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs ensure --target tiled --allow-install
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs ensure --target ffmpeg --allow-install
```

El instalador usa IDs `winget --exact --source winget` en Windows, `brew` en macOS, y Flatpak solamente para motores con ruta conocida en Linux. Instala **solo si la herramienta falta**, nunca al inicio de Phoenix. Sin `--allow-install`, `ensure` presenta el plan sin efectuar cambios en el equipo. Las credenciales, permisos y condiciones de cada plataforma se respetan. No te saltes UAC ni instaladores que requieran la intervención del usuario. Si el entorno no detecta la herramienta tras instalarla, ejecuta `doctor` de nuevo después de actualizar PATH, abrir otro terminal o configurar `PHOENIX_*_BIN`. No declares éxito hasta obtener versión real.

En Godot 4, comprueba que el binario corresponde a la versión del proyecto y que las plantillas de exportación están instaladas antes de exportar: la instalación del editor por sí sola no lo garantiza. Un export Web contiene archivos HTML/JS/WASM/PCK y necesita un servidor y navegador reales; no copies únicamente el HTML al chat. Crea una compilación nativa o una URL web alojada y comprueba la ejecución; si el usuario exige jugar dentro del chat, proporciona además una versión autocontenida HTML5 que pase las puertas de presets y gameplay.

## Godot AI MCP: editor real, no sustituto de los assets

El usuario puede pedir que Kira utilice [Godot AI](https://github.com/hi-godot/godot-ai), un complemento comunitario MIT. El recurso [Asset Library #5050](https://godotengine.org/asset-library/asset/5050) es **v3.2.1 para Godot 4.5+**; el protocolo v4 no es intercambiable con v3. El instalador fijado de Phoenix apunta a **v4.3.0 para Godot 4.7+**, verificado por SHA-256, y no debe pisar un addon anterior ni su migración firmada.

### Preparación automatizable solo al crear un juego Godot

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs doctor --target godot
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs doctor --target uv
# Si faltan y está autorizada la instalación:
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs ensure --target godot --allow-install
node apps/cli/config/agent-presets/code/skills/game-development/scripts/game-tools.mjs ensure --target uv --allow-install
node apps/cli/config/agent-presets/code/skills/game-development/scripts/godot-ai-addon.mjs plan --project RUTA_PROYECTO
node apps/cli/config/agent-presets/code/skills/game-development/scripts/godot-ai-addon.mjs install --project RUTA_PROYECTO --allow-install
```

El addon instalado debe activarse en **Godot: Project Settings > Plugins > Godot AI**. En el dock selecciona **DeepSeek Harness > Configure** (y confirma que Godot realmente está abierto en el proyecto). Esa opción registra `mcp-godot-ai` como `insert` de `$DSH_HOME/cordis.patch.yml`, con puente `godot-ai attach` y autenticación local que rota. El complemento oficial usa el plugin original `paquete del cliente DeepSeek original`, mientras que Phoenix publica `@phoenix-ai/dsh-mcp-client`. No copies configuraciones de HTTP 8000 sin capability ni fijas manualmente tokens/puertos.

```sh
node apps/cli/config/agent-presets/code/skills/game-development/scripts/godot-ai-bridge.mjs doctor --project RUTA_PROYECTO
# Tras revisar la configuración generada por el editor, autoriza solo el alias de integración:
node apps/cli/config/agent-presets/code/skills/game-development/scripts/godot-ai-bridge.mjs sync --allow-config-edit
```

Reinicia la sesión de Phoenix para cargar el registro. Kira debe llamar herramientas reales del namespace `godot-ai`: `editor_state`, `scene_get_hierarchy`, `session_activate` si hay varios proyectos, `node_create`, `animation_create`, `animation_manage`, `script_create`, `project_run`, `test_run`, `editor_screenshot`, `logs_read` y `game_manage`. No confundir “registro configurado” con “servidor conectado”: la verificación real exige respuesta del editor.

**Producción audiovisual:** diseñar primero presets coherentes; importar atlases por actor y escenarios por capa/TileMap, conectar estados e hitboxes/IA/FX/sonidos y ejecutar pruebas con capturas. El editor MCP puede ensamblar y ejecutar escenas pero no sustituye diseño de alta calidad ni audio original. Si un sprite o jefe no aparece en capturas del juego, no entregar como producción.

No ejecutar `godot-ai-addon.mjs install` para actualizaciones: usa **Update** en el dock y el proceso de migración v3→v4 firmado. Si Godot 4.7+ o `uvx` no están disponibles tras instalación, reportar el error real y no llamar a Godot AI listo. `GODOT_AI_DISABLE_TELEMETRY=true` desactiva la telemetría voluntaria.

## Preparar y comprobar

```sh
godot --version
godot --headless --path <proyecto> --editor --quit
godot --headless --path <proyecto> --script res://tests/smoke.gd
godot --path <proyecto>
godot --headless --path <proyecto> --export-release "Windows Desktop" <salida>/game.exe
```

Sustituye `godot` por el binario verificado. El smoke script debe existir y probar lógica/escenas; crearlo es parte del juego. Exportar requiere un preset configurado y plantillas instaladas que coincidan con la versión. No crees un archivo vacío ni omitas un fallo del export para declarar éxito. Ejecuta el export real además de la escena del editor.

Blender puede crear/procesar assets sin MCP: `blender --background --python <script.py>`. Modela/UV/materiales/rig/animaciones según el juego; exporta glTF/GLB, importa en Godot y comprueba escala, ejes, materiales, colisiones y clips. Un export correcto no prueba la apariencia ni animación en juego. Haz renders/capturas del asset y luego del juego.

## 2D

Usa `CharacterBody2D` para movimiento con `move_and_slide`, `AnimatedSprite2D`/AnimationPlayer para estados, TileMapLayer cuando haya tiles, Camera2D y recursos propios. Separa CollisionShape2D de apariencia. Define acciones en InputMap, gravedad/velocidad en unidades por segundo y reglas de pausa. Prueba límites, colisiones, enemigos/interacción que existan, feedback, guardado y menú/transiciones. Pixel art usa nearest y stretch/escala coherentes.

## 3D retro/PS1 moderno

Usa Godot 4 3D con renderer Compatibility si el target permite ese compromiso, resolución/paleta/filtro deliberados y low-poly original. `CharacterBody3D`, `Camera3D`, navegación e interacción según el género. Aspecto PS1 no es compatibilidad con PS1: la exportación sigue siendo PC/web u otro target moderno. Affine texture wobble, dithering o vertex snapping son efectos opcionales; no dañes legibilidad ni controles para imitar fallos técnicos.

## Aventura urbana/mundo abierto

Comienza con una sección completa: jugador, cámara, una zona coherente, personaje/vehículo original, entrar/salir/conducir si se pide, misión con inicio/progreso/éxito/fallo, UI, audio y guardado. Integra y prueba antes de ampliar. Continúa los distritos, misiones y sistemas del alcance acordado; el primer distrito no equivale al juego entero.

Separa jugador/vehículo/misiones/guardado y carga de zonas. Mide física, frame time, memoria y draw calls. Usa chunks/carga asincrónica, LOD, visibilidad/occlusion y pooling cuando las mediciones lo justifiquen. Prueba reinstanciar zonas, respawn, interrupción de misión, save/load y que no aparecen agentes, físicas o sonidos duplicados.

## Unity/Unreal

Conserva motor y versión del proyecto si existen o se piden. Usa CLI/editor oficial y su documentación; verifica módulos/presets/SDK de plataforma antes de exportar. Sus condiciones de licencia y cuenta se comprueban en el proyecto, no se presentan como gratuitos por defecto. Godot no reemplaza una entrega explícita de Unity/Unreal ni un SDK de consola real.
