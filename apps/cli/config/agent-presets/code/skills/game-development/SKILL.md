---
name: game-development
description: >-
  Use when creating, improving or debugging playable games: browser arcade, Snake, puzzles, 2D/3D,
  Game Boy, NES, SNES, Sega, PlayStation/PS1/PSX, GTA-style open worlds, Godot, Unity, Unreal,
  homebrew ROMs, controls, levels, game assets, audio, builds or playtesting.
---

# Crear y entregar videojuegos

El resultado es un juego ejecutable adecuado al género, plataforma y alcance pedido. Las referencias del usuario orientan calidad o estilo; un ejemplo no impone su diseño a todos los juegos.

## Decidir antes de construir

Inspecciona el proyecto y conserva su motor. Registra un breve `GAME_PLAN.md`: género y bucle jugable; plataforma y formato de entrega; motor y versión; dirección artística; controles de teclado/mando/táctil; contenido y criterios de aceptación; presupuesto de rendimiento; herramientas disponibles; prueba técnica, visual y de juego; instrucciones de ejecución.

Para «tipo Game Boy/NES/SNES/Sega/PlayStation» ofrece estética moderna por defecto. Solo crea ROM o imagen de disco cuando se solicite hardware/emulador real. No declares una web como ROM. Si un requisito esencial falta, pregunta por él mientras avanzas en lo independiente.

| Pedido | Ruta inicial si no existe motor |
|---|---|
| Arcade/puzzle pequeño de navegador | HTML/CSS + Canvas y JavaScript; Phaser si la complejidad justifica esa dependencia |
| Plataforma, RPG, aventura 2D | Godot 4; tiles/sprites y animaciones cuando corresponda |
| PS1 moderno, low-poly, 3D o mundo abierto original | Godot 4 3D + Blender; una sección jugable completa antes de ampliar contenido |
| Web 3D | Three.js/Babylon.js o exportación web de Godot según límites y controles |
| Unity/Unreal existentes o pedidos explícitamente | Motor solicitado, comandos/editor y documentación de la versión instalada |
| Hardware retro real | SDK nativo de la plataforma; compilación y emulación independientes |

## Preparar herramientas

Lee el recurso correspondiente antes de ejecutar comandos: [navegador](references/browser-games.md), [Godot/Blender](references/godot-games.md), [ROM y PlayStation real](references/native-retro.md).

Ejecuta `node <base-de-esta-habilidad>/scripts/game-tools.mjs doctor --target web` o el target necesario: `godot`, `blender`, `gameboy`, `nes`, `snes`, `genesis`, `sms`, `ps1`. Salida JSON: 0 listo para los requisitos comprobados, 1 no listo, 2 comando inválido/error. Un compilador detectado no demuestra que el SDK completo, emulador o exportación estén listos.

`plan --target godot|blender` muestra una instalación sin ejecutarla. `install --target godot|blender` instala solo ese motor gratuito mediante winget/Homebrew/Flatpak, dentro de la autorización del trabajo. Requiere un gestor disponible y su fuente configurada; mantiene su verificación de paquetes. Repite doctor y prueba el motor. Las rutas configuradas `PHOENIX_GODOT_BIN` y `PHOENIX_BLENDER_BIN` prevalecen sobre autodetección. No instales todos los motores ni arranques editores al iniciar Phoenix.

MCP es opcional: usa conectores ya configurados o herramientas de archivos, shell, navegador, visión y comandos locales. Descubre una capacidad necesaria con `connector_list`/`connector_discover`; valida su origen y la autorización antes de instalarla. La ausencia de MCP no bloquea un juego ejecutable.

## Construcción y revisión

Kira coordina trabajo real y verifica resultados; delega piezas independientes con criterios y límites claros, y reutiliza evidencia y assets válidos. El modelo/imagen/conector disponible determina la capacidad real. Mantén el layout de Phoenix.

La dirección artística determina la producción: en arcade/tablero abstracto, geometría, CSS y Canvas deliberados y pulidos pueden ser finales. Para actores/entornos representacionales, carga [producción de arte](references/production-art.md); usa raster/modelos/animación adecuados, visión y procedencia. No conviertas colisiones o placeholders en personajes finales.

Implementa el bucle, estados, controles, pausa/reinicio, progreso/guardado, sonido y accesibilidad que correspondan al género. Divide una petición grande en entregables completos, conserva el objetivo completo y continúa hasta cumplirlo; no llames «GTA completo/AAA» a una escena o una sección jugable.

Cierra con tres pruebas separadas: build/importación/tests; captura actual inspeccionada; partida ejecutada que pruebe los criterios, controles, transiciones y fallos. Comprueba consola/logs, rendimiento material y guardado tras recarga/reinicio. Prueba desktop y móvil si ambos son targets. Corrige y repite solo lo invalidado.

Entrega fuentes, versión y comandos reproducibles, ejecutable/ROM/web solicitado, controles y evidencia verificable. Un screenshot no prueba gameplay; un build no prueba acabado; una puntuación interna no prueba calidad. Informa exactamente lo no probado o bloqueado.
