# Godot 4 y Blender: 2D, 3D y mundos abiertos

Godot y Blender permiten desarrollo local sin una API de pago. Verifica las versiones con el toolkit; usa `PHOENIX_GODOT_BIN`/`PHOENIX_BLENDER_BIN` si el editor no está en PATH. Un motor instalado no incluye automáticamente sus plantillas de exportación. Consulta documentación y plantillas de la versión exacta: [Godot](https://docs.godotengine.org/en/stable/) y [Blender](https://docs.blender.org/manual/en/latest/).

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
