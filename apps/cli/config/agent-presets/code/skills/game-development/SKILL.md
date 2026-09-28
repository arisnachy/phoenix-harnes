---
name: game-development
description: >-
  Diseña, construye, prueba y pule videojuegos modernos o retro. Úsala para Unreal, Unity, Godot, Blender,
  pixel art, NES, SNES, Sega Mega Drive/Genesis, Master System, Game Gear, Game Boy, ROM homebrew,
  emulación, gameplay, niveles, assets, shaders, audio, builds y depuración visual.
---

# Desarrollo de videojuegos

Phoenix debe tratar un videojuego como un producto ejecutable, no como una demo de código. El objetivo incluye
gameplay, arte coherente, audio, controles, rendimiento, build reproducible y una ronda real de juego/pruebas.

## Mandato premium de producción

Cuando el usuario pida un videojuego terminado o de alta calidad, Phoenix/Hardness debe asumir que también es responsable
de la producción audiovisual necesaria para que el resultado alcance ese nivel. No puede limitarse al código y esperar
que el usuario aporte después los personajes, escenarios, UI, texturas, animaciones, efectos o sonido salvo que el usuario
haya reservado explícitamente esa parte.

El objetivo por defecto es competir con referencias actuales fuertes de la misma categoría y, cuando el alcance y las
herramientas lo permitan, superarlas en acabado, coherencia, legibilidad, respuesta y personalidad. No afirmes que se
superó a una referencia solo por intención: exige evidencia visual, técnica y jugable.

Antes de producir, identifica 2-5 referencias relevantes por género/plataforma/estilo cuando exista acceso web y extrae
atributos concretos que importan al proyecto: densidad visual, iluminación, siluetas, animación, feedback, cámara, UI,
mezcla sonora, ritmo, rendimiento y claridad. Usa esas referencias como barra de calidad, nunca para copiar personajes,
niveles, marcas, música o assets protegidos.

Hardness debe crear o coordinar activamente, según el proyecto:

- dirección artística, paleta, shape language y style bible;
- concept art y diseño final de personajes, enemigos, NPC, props y criaturas;
- escenarios, fondos, tilesets, set dressing, iluminación y storytelling ambiental;
- modelos 3D, materiales, texturas, UV, rig, facial/body animation y LOD cuando corresponda;
- sprites, tiles, backgrounds, parallax, portrait art y animación pixel-perfect en 2D/retro;
- VFX, partículas, shaders, hit effects, camera shake y feedback audiovisual;
- HUD, menús, iconografía, tipografía, accesibilidad visual y UX;
- música, ambience, Foley/SFX, UI sounds, loops, transiciones y mezcla;
- trailers/capturas/material de presentación solo después de que el juego real tenga calidad suficiente.

Usa `image_generation` para producir recursos raster originales cuando sea apropiado y Blender para 3D cuando haga falta.
Si existe un conector de audio/generación musical autorizado, úsalo para el audio original; si no existe, crea sonido
procedural cuando sea viable o usa únicamente recursos con licencia compatible y documenta su procedencia. Nunca presentes
un silencio, beep temporal, cube/mannequin por defecto, checker texture o placeholder como producción final.

### Puerta obligatoria de calidad para personajes, enemigos y NPC

Todo actor que el jugador vea o con el que pueda interactuar —protagonista, enemigo, jefe, aldeano/NPC,
criatura, aliado o comerciante— debe existir como un asset visual de producción reconocible y animado.
La geometría de colisión puede ser simple internamente, pero **nunca debe usarse como apariencia final**.

No aceptes como actor final un `fillRect`, rectángulo, caja, círculo, cápsula, emoji, letra, texto, silueta de
un solo bloque, maniquí del motor o primitive mesh, salvo que el usuario haya pedido explícitamente una
dirección artística abstracta/minimalista y esa decisión esté respaldada por referencias y evidencia visual.
Si un personaje puede describirse honestamente como "una caja con ojos", la revisión debe fallar y regenerarlo.

Para 2D/pixel art, exige como mínimo:

- silueta distinta por rol y lectura inmediata a la escala real de juego;
- cabeza/cuerpo/extremidades o shape language equivalente, con detalles de identidad y varias regiones de
  color/valor; no un bloque plano;
- densidad de píxel, paleta, outline, sombreado y escala coherentes con el tileset y con el resto del reparto;
- fondo transparente y atlas/sprite sheet limpio, sin halos ni antialiasing accidental;
- `idle` y `walk` en todas las direcciones relevantes; en top-down, usa cuatro direcciones por defecto;
- para actores de combate: `attack/telegraph`, `hurt` y `death` además de locomoción;
- para NPC interactivo: `idle` y al menos una respuesta visible de interacción cuando corresponda;
- hitbox/collision shape separada del sprite para que la lógica no degrade la apariencia.

Para 3D, exige modelado/materiales/rig/animación que comuniquen el rol del actor; un cubo, cápsula,
maniquí, rig por defecto sin personalización suficiente o mesh temporal no puede cerrar producción.

Pipeline preferido para sprites/actores raster:
`image_generation` o herramienta artística autorizada -> limpieza/transparencia -> normalización de
paleta/resolución/pixel grid -> corte de frames/atlas -> importación al motor -> ejecución -> captura ->
revisión visual. Si no hay generador disponible, crea pixel art procedural por matrices/capas de píxeles o
assets vector/raster propios con detalle suficiente; **no reemplaces la generación por primitivas geométricas
de una sola capa**.

La prueba visual debe incluir al menos una captura reciente a escala normal de gameplay y otra inspección
ampliada de los actores principales. El revisor debe comparar jugador, al menos un enemigo y un NPC/actor
interactivo cuando existan. Si cualquiera resulta indistinguible, inconsistente, desproporcionado, sin
animación suficiente o visualmente provisional, el resultado es `needs_changes`, no PASS.

### Rúbrica interna de 100 puntos

Usa esta rúbrica como guía de iteración, no como sustituto de evidencia:

- 15: dirección artística y coherencia visual;
- 15: personajes, siluetas, rig y animación;
- 15: ambientes, iluminación, composición y storytelling;
- 10: VFX, shaders, cámara y feedback;
- 10: UI/UX, legibilidad y accesibilidad;
- 10: música, ambience, SFX y mezcla;
- 15: gameplay feel, controles, cámara, colisiones, combate/interacción y pacing;
- 10: rendimiento, estabilidad, tiempos de carga y calidad del build.

Un promedio alto no compensa una categoría esencial ausente. Para un entregable que se presenta como premium, apunta a
90/100 o más y no aceptes ninguna categoría material por debajo de un nivel profesional. Si una categoría no aplica,
redistribuye su peso entre las categorías relevantes y documenta el criterio.

### Puerta de finalización

Hardness no debe permitir PASS final mientras ocurra cualquiera de estas condiciones:

- quedan placeholders, assets de template o elementos visuales incoherentes;
- personajes principales parecen genéricos o tienen animaciones claramente provisionales;
- escenarios relevantes están vacíos, repetitivos o sin iluminación/set dressing suficiente;
- falta música/ambience/SFX material para la experiencia o la mezcla resulta deficiente;
- la UI parece prototipo o rompe la identidad artística;
- el gameplay solo fue compilado pero no ejecutado y probado;
- no existe evidencia audiovisual reciente del juego real en ejecución;
- el rendimiento objetivo no se verificó cuando es material;
- el proyecto depende de una afirmación de "calidad AAA/premium" sin comparación observable.

## 1. Detecta el tipo de proyecto antes de elegir herramientas

Inspecciona primero el workspace.

- Unreal: existe un `.uproject`, `Config/DefaultEngine.ini` o el usuario pide UE/AAA/fotorrealismo.
- Unity: existe `ProjectSettings/ProjectVersion.txt`, `Assets/` o el usuario pide Unity.
- Godot: existe `project.godot` o el juego es 2D/indie/retro moderno y no se exige otro motor.
- Retro nativo: el usuario pide ROM o compatibilidad real con NES, SNES, Mega Drive/Genesis,
  Master System/Game Gear o Game Boy.
- Retro moderno: el usuario pide "tipo NES/SNES/Sega", pixel art o estética 8/16-bit, pero no exige
  ejecutar en hardware original. En ese caso prefiere Godot para 2D salvo que el proyecto ya use otro motor.
- Blender: úsalo cuando hagan falta modelos 3D, rigging, UV, materiales, animación, LOD o conversión de assets.

No cambies de motor solo porque otro parezca mejor. Un proyecto existente conserva su motor salvo petición explícita.

## 2. Selección automática de conectores

Antes de improvisar una integración con un editor:

1. Si ya ves herramientas `mcp__unreal__*`, `mcp__unity__*`, `mcp__godot__*`,
   `mcp__blender__*` o `mcp__gameplay__*`, usa la que corresponde al proyecto.
2. Si el conector no está visible, llama `connector_list` con un target específico.
3. Si no hay coincidencia, usa `connector_discover` para el producto concreto.
4. Instala desde el registro oficial solo cuando el resultado permita instalación y el usuario apruebe.
5. No ejecutes automáticamente paquetes stdio o repositorios GitHub de terceros descubiertos al azar.
6. Si no hay MCP fiable, continúa mediante archivos, shell/PowerShell, CLI oficial del motor y computer/visión
   cuando estén disponibles. La ausencia de MCP no bloquea la creación del juego.

La prioridad de control es: conector específico del motor > CLI/editor oficial > automatización de escritorio.
No uses computer para editar cientos de propiedades si un conector o API del motor puede hacerlo de forma determinista.

## 3. Motores modernos

### Unreal Engine

Úsalo por defecto para 3D de alta fidelidad, iluminación avanzada, cinemáticas, mundos grandes,
Blueprints complejos o cuando el usuario pida calidad visual cercana a AAA.

Con el conector Unreal, prioriza operaciones estructuradas para niveles, actores, Blueprints, materiales,
Niagara, Behavior Trees, UMG, Sequencer y compilación. Usa Python/C++ solo cuando la API estructurada
no cubra la operación. Después de cambios importantes: guarda, compila, inicia PIE, recoge errores y verifica
visualmente el viewport o el juego.

### Unity

Úsalo cuando el proyecto ya sea Unity o cuando importen especialmente móvil, XR, multiplataforma,
ecosistema C# o paquetes específicos de Unity.

Con el conector Unity, usa operaciones de escena/GameObject/componentes/assets antes de editar YAML interno.
Ejecuta tests, Play Mode y build target cuando existan. No declares terminado un cambio que solo compila C#.

### Godot

Es la opción preferida para 2D de alta calidad, pixel art, plataformas, metroidvania, RPG 2D,
arcade y retro moderno cuando no existe una restricción de motor.

Usa escenas/nodos/resources de Godot de forma estructurada. Mantén pixel snapping, filtrado nearest y escalado
entero cuando el estilo lo requiera. Ejecuta el proyecto y revisa errores de GDScript y comportamiento real.

### Blender

Para assets 3D, usa el conector oficial de Blender cuando esté disponible. Crea topología limpia, UV,
materiales PBR, rig y animaciones con nombres estables. Exporta al formato que mejor conserve el pipeline
del motor. No añadas detalle geométrico que destruya el presupuesto de rendimiento.

## 4. Retro moderno de alta calidad

"Tipo NES/SNES/Sega" no significa producir un juego pobre. Mantén las reglas visuales esenciales de la era,
pero aplica diseño, animación, controles, UX y contenido modernos.

Antes de crear arte define un perfil técnico:

- resolución lógica y relación de aspecto;
- tamaño de tile y sprite;
- paleta y presupuesto de colores;
- número de frames y siluetas;
- reglas de scrolling/parallax;
- tipografía pixel;
- audio/chiptune o híbrido;
- FPS objetivo.

Para estética NES usa como referencia restricciones de 8-bit solo cuando ayuden al estilo.
Para SNES/Mega Drive permite más capas, color, parallax y animación. Evita mezclar pixel sizes o aplicar
antialiasing borroso. Mantén una cuadrícula de píxeles consistente.

Aseprite y Tiled son herramientas preferidas cuando estén instaladas. Si no existen, Phoenix puede generar
assets raster y procesarlos, pero debe revisar escala, paleta, bordes, transparencia y consistencia antes de importarlos.

## 5. Retro nativo: ROM para hardware real

Cuando el usuario pida compatibilidad real, no uses Godot/Unity como sustituto.

- NES: cc65/ca65/ld65 y librerías homebrew apropiadas; prueba ROM con Mesen o RetroArch.
- SNES: PVSnesLib u otra toolchain homebrew explícitamente elegida; verifica LoROM/HiROM y mapa de memoria.
- Mega Drive/Genesis: SGDK; respeta VRAM, tiles, palettes, DMA y límites del VDP.
- Master System/Game Gear: devkitSMS/SMSlib o toolchain equivalente validada.
- Game Boy/Game Boy Color: GBDK-2020 cuando ese sea el target.
- Emulación: RetroArch o un emulador específico sirve para pruebas, no para copiar ROMs o assets comerciales.

No distribuyas ROMs, BIOS, música, sprites ni contenido propietario de terceros. Los juegos creados deben usar
código y assets propios o debidamente licenciados.

En hardware real, valida tamaño final de ROM, memoria, banco, VRAM, sprites por scanline, sonido,
input y timings según el target. Si una restricción es crítica, conviértela en test o chequeo de build.

## 6. Assets, audio y contenido

Usa `image_generation` para concept art, backgrounds, UI, texturas y sprites cuando aporte calidad.
Para pixel art generado, normaliza después la resolución, paleta, transparencia y escala; no introduzcas
píxeles semitransparentes o tamaños inconsistentes sin intención.

Para 3D, pasa por Blender cuando haga falta modelado o rig. Para audio, prioriza formatos, sample rate,
loop points y compresión apropiados al motor/target. En retro nativo, el presupuesto de canales y memoria
forma parte del diseño.

## 7. Bucle de calidad obligatorio

Después de implementar una parte jugable:

1. compila o exporta;
2. ejecuta el juego o ROM;
3. observa pantalla/logs y, si existe, usa el conector gameplay o computer/visión;
4. prueba controles, colisiones, cámara, UI, audio, transiciones y estados de fallo;
5. mide FPS/frame time y memoria cuando corresponda;
6. corrige defectos;
7. repite hasta que el criterio de aceptación se cumpla.

Una captura bonita no demuestra un juego funcional y una suite verde no demuestra buen gameplay.
La entrega final necesita ambas cosas: evidencia técnica y una pasada visual/jugable.
