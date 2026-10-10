---
name: game-development
description: >-
  Use when creating, improving or debugging playable games: browser arcade, Snake, puzzles, 2D/3D,
  Game Boy, NES, SNES, Sega, PlayStation/PS1/PSX, GTA-style open worlds, Godot, Unity, Unreal,
  homebrew ROMs, controls, levels, game assets, audio, builds or playtesting.
---

# Crear y entregar videojuegos

## Reabrir un juego solicitado (Pac-Man, Snake, Tetris y cualquier juego)
Si el usuario dice «déjame verlo», «abre Pac-Man», «quiero jugar» o pide recuperar un juego anterior, NO respondas «está más arriba» sin una prueba verificable. La interfaz de Phoenix reabre directamente en este turno un artefacto REAL de Game Studio (MIME application/vnd.phoenix.game+html) cargado en la conversación y coincidente con el título pedido. Si no hay un artefacto ejecutable disponible, no inventes una publicación: crea o reconstruye el HTML jugable y llama a phoenix_game en el turno actual, con manifest_json y preflight reales. Comprueba el resultado de la herramienta y el identificador artifactId; una respuesta puramente textual o un título en Biblioteca NO prueba que el juego exista. Si la reconstrucción falla, describe el bloqueo concreto y no declares el juego listo. No regeneres un juego anterior ya ejecutable y recuperable.


El resultado es un juego ejecutable adecuado al género, plataforma y alcance pedido. Si solicitan jugar en el chat de Phoenix, la entrega mínima es invocar la herramienta `phoenix_game` con HTML5 ejecutable autónomo: publica el MIME `application/vnd.phoenix.game+html` directamente en el visor del chat, no una imagen PNG, spritesheet, manifiesto o explicación. Incluye un manifiesto JSON `phoenix-game-manifest` y script ejecutable; confirma el resultado de la herramienta antes de presentar la misión como terminada. Una hoja de sprites no marca terminado el juego, incluso si image_generation respondió exitosamente. Comprueba las herramientas realmente expuestas (habilidad, archivos, shell, equipo y publicación de artefactos) antes de informar que no están disponibles. El proyecto incluye `examples/game-studio/jungle-echo.html` como punto de partida offline adaptable; revisa también `.agents/skills/phoenix-game-studio/SKILL.md`. Pide La Forja mediante el equipo real cuando el usuario la solicita; si falla la delegación, continúa por una ruta autónoma viable y menciona el fallo concreto. Nunca afirmes que se probó una partida sin pruebas ejecutadas. Responde en el idioma de la solicitud, también después de una revisión externa. Las referencias del usuario orientan calidad o estilo; un ejemplo no impone su diseño a todos los juegos.

## Kira: el manifiesto y el preflight van PRIMERO, nunca después del rechazo

Antes de generar o publicar un videojuego en el chat, **escribe el manifiesto JSON real** del juego según el género: `schemaVersion:1`, `title`, `genre`, `gameType`, `controls`, `level`, `audio` y las entidades realmente implementadas (protagonista, enemigos, jefes, animaciones, escenarios, armas, poderes, objetos y efectos cuando procedan). Usa como referencias de esquema `examples/game-studio/jungle-echo.manifest.json` y `lumen-circuit.manifest.json`, sin copiar personajes ni afirmar que algo existe si no está creado.

En la **primera** llamada a la herramienta real `phoenix_game`, envía `html` completo y `manifest_json` como cadena JSON independiente. El publicador incrusta automáticamente el bloque HTML requerido `<script id="phoenix-game-manifest" type="application/json">`, o corrige un bloque JSON válido que solo carecía del `id`. También valida controles, nivel y audio y no inventa activos. Si `html` ya lleva un manifiesto válido y coincide con `manifest_json`, lo conserva. Evita el ciclo «primer intento rechazado → descubro el manifiesto → segundo intento». Una validación estructural no prueba que el juego sea jugable o visualmente profesional.

## Producción completa del juego: no te detengas en el protagonista

Cuando el usuario pide un juego ilustrado (especialmente de disparos/aventura), el atlas del héroe es **solo una tarea de una producción conjunta**. Antes de crear el primer dibujo:

1. Define el reparto en el manifiesto real: héroe, cada tipo de enemigo, jefe y fases, aliados/NPC cuando correspondan; niveles y capas; armas/proyectiles, poderes/pickups, objetos interactivos, VFX y audio. Establece para cada tipo su id, papel jugable, estilo visual y estados.
2. Ejecuta `node examples/game-studio/plan-game-assets.mjs manifest.json plan.json` y trata **cada tarea pendiente** como trabajo real, no como evidencia de producción. Kira coordina arte/animación, mundo/comportamiento y audio/QA, con máximo tres colaboradores reales y sin duplicar encargos.
3. Produce recursos originales **para todas las familias**, no un solo spritesheet aislado: enemigos con poses de movimiento/ataque/daño/muerte; jefe con silueta distinta y frames de cada fase; armas y fogonazos, balas, habilidades, cofres/cajas, objetos, explosiones; capas de cielo, fondo y primer plano; música y efectos asociados a eventos.
4. Convierte los spritesheets a recursos reales del motor y embébelos en el HTML offline. El manifiesto de producción de un run-and-gun exige `art.enemies`, `art.bosses` y `phaseAnimations`, `art.backgrounds` para cada `level.layers[].id`, `art.weapons`, `art.projectiles`, `art.powers`, `art.props`, `art.effects`, además del `art.hero`. Cada entrada tiene `id`, `imageId`; los actores también `frameWidth`, `frameHeight` y `animations` válidas. **La imagen tiene que ser cargada y dibujada de verdad**. Los PNG de diseño no utilizados no cuentan.
5. Integra estados, hitboxes, IA, aparición y derrota de enemigos, transición real de fases del jefe, pickups y poderes, impactos, efectos, audio y parallax. Prueba con capturas del juego en distintos estados y compara escala, detalle y coherencia con el arte aprobado. No declares calidad de producción con geometría sustituta. Reintenta solo los fallos observados y documenta bloqueos.
6. Solo cuando la escena esté realmente integrada, ejecuta preflight y publica mediante `phoenix_game`. Su revisión estructural **no es prueba de juego completado**, que requiere controles, animaciones, audio y observación real en navegador.

Para juegos abstractos de tablero, carreras, estrategia y otros géneros, adapta el reparto y los activos a sus mecánicas; no inventes un jefe o una pistola innecesaria. Los assets pueden variar por género, pero nunca desaparecen silenciosamente elementos que el usuario solicitó. Si aún faltan recursos, usa `art.mode="prototype"` y explica el alcance; no lo llames juego terminado.

## Puerta obligatoria: el personaje diseñado debe ser el personaje jugable

Si el usuario enseña una ilustración o aprueba un diseño del protagonista, **esa misma identidad debe aparecer dentro del juego**. No uses un retrato bonito solo en la conversación mientras el juego dibuja cajas, líneas o un muñeco genérico. Antes de declarar acabado:

1. Guarda la ilustración/asset de referencia real y crea un sprite atlas original compatible, con transparencia real y poses distintas de caminar/correr/saltar/caer/apuntar/disparar/daño/muerte. Un retrato aislado NO equivale a una animación. Revisa visualmente cada frame, pasos alternados, proporciones, manos y armas.
2. Incorpora el atlas y al menos un fondo ilustrado en el HTML offline; vincula `document.getElementById('hero-art')` y el fondo con llamadas efectivas a `ctx.drawImage(hero, ...)` y `ctx.drawImage(bg, ...)`. Espera `HTMLImageElement.decode()` o un evento `load` cuando proceda antes de usar píxeles para renderizar.
3. En el manifiesto dentro de `<script id="phoenix-game-manifest" type="application/json">`, además de `schemaVersion`, `title`, `genre`, controles, nivel y audio, registra `art.mode: "production"`, `art.designReference`, `art.hero.imageId`, `frameWidth`, `frameHeight`, `animations` con **índices reales**, y `art.backgrounds` con cada imagen `imageId`. Las dimensiones deben corresponder al PNG real; `run` incluye mínimo cuatro frames distintos. `phoenix_game` rechaza imágenes enlazadas remotamente, atlases ausentes y los que no se dibujan realmente.
4. Usa las herramientas del repositorio: `node examples/game-studio/embed-game-assets.mjs input.html images.json con-assets.html` (PNG locales a data URI sin CDN), y `pnpm exec tsx examples/game-studio/prepare-game.ts con-assets.html manifest.json publicable.html` (inserción/validación del manifiesto). Si el origen ya lleva manifiesto, debe coincidir exactamente con el JSON externo, sin duplicarlo.
5. Ejecuta el resultado **de verdad** en navegador y captura fotogramas comparables, como mínimo quieto, corriendo, apuntando arriba/abajo, disparando, salto y enemigos, más vista de escenario. Compara con el arte de referencia del propio usuario; corrige incoherencias antes de terminar. Prueba sonido tras gesto y revisa consola. Una validación de PNG/JSON no sustituye esta puerta visual.

Cuando aún falte el atlas o el escenario, declara conscientemente `art.mode: "prototype"`; el publicador y el visor lo marcarán como **arte provisional**, no como un juego final impecable. No simules `art.mode: "production"` ni inventes imágenes, hashes o evidencias. Si no puedes convertir el arte aprobado a sprites animados, informa del bloqueo real en lugar de sustituirlo por primitivas. Para juegos abstractos (puzles y tablero) no impongas un protagonista artificial. Kira debe abrir la habilidad y estos contratos ANTES del primer intento de publicación, no aprenderlos mediante errores repetidos.

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
