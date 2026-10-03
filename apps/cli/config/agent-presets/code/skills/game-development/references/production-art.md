# Arte representacional y producción audiovisual

Esta referencia se aplica cuando el juego requiere personajes, escenarios, sprites, modelos, cinemáticas o assets representacionales. Las reglas de reparto, animación y densidad de mundo corresponden a esos elementos y al alcance contratado. Snake, Pong, Tetris, 2048 y juegos de tablero pueden tener gráficos geométricos finales deliberados y audio procedural; su calidad se juzga por legibilidad, interacción, composición y pruebas, sin inventar NPCs o buscar packs que no necesitan.

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


### Benchmark obligatorio contra el juego actual

Cuando el usuario pida mejorar un juego existente, **el propio juego actual es el primer benchmark**. Antes de cambiar
arte, UI o presentación, ejecuta la versión vigente y captura al menos una escena representativa. Conserva esa evidencia
como baseline y repite una captura comparable después de los cambios: misma zona o una equivalente, viewport/cámara
comparables y actores visibles suficientes para juzgar protagonista, enemigo, NPC/actor interactivo y entorno.

La iteración solo puede cerrar como mejora si el candidato muestra una ganancia material observable sin introducir
regresiones relevantes. Compara, según aplique: legibilidad y silueta de actores, riqueza/densidad del escenario,
variedad de tiles/props, integración del HUD, claridad de combate/interacción, cobertura y fluidez de animación,
feedback/VFX, sonido, frame-time y estabilidad. Si el usuario dijo "mejor que el juego actual", "más bonito" o equivalente,
un resultado meramente distinto o funcional **no satisface la petición**.

Las referencias externas sirven para elevar la barra, no para copiar IP. Captura atributos de dirección artística,
composición, densidad, lectura, animación, cámara y UI; crea assets, personajes, niveles y música originales.

### Pipeline de herramientas primero, no primitivas de reemplazo

Para arte 2D/raster, pasa primero por el router `asset-first`: un modelo textual/rápido o una sesión sin
backend artístico fuerte debe buscar recursos licenciados antes de intentar dibujarlos. Cuando el router determine que
la generación original puede igualar o superar los candidatos encontrados, usa `image_generation` con `backend=auto`
y `read_image` para inspeccionar el resultado antes de integrarlo. Para pixel art/tilesets, usa Aseprite/Tiled si están
instalados o disponibles de forma segura; para 3D usa Blender y el pipeline nativo del motor; para audio usa el
conector/generador autorizado disponible o síntesis procedural adecuada. Usa `connector_list` y
`connector_discover` para encontrar la herramienta específica cuando no esté visible.

Un motor puede renderizar sobre canvas/WebGL, pero **canvas no es licencia para dibujar el arte final con rectángulos,
círculos y líneas**. Del mismo modo, HTML/CSS/SVG pueden alojar el juego o su UI, pero no sustituyen sprites, tiles,
fondos, retratos, personajes, enemigos, NPC ni VFX finales cuando la dirección pide arte representacional.

Si `image_generation` no está disponible, no caigas silenciosamente a cajas CSS. Para pixel art genera raster real
mediante matrices/capas de píxeles, normaliza paleta y transparencia, crea spritesheets/atlases y revísalos con visión.
Si una dependencia artística bloquea de verdad el nivel solicitado, mantén la misión abierta o declara el bloqueo exacto.

Para juegos retro/top-down, evita que las heurísticas de diseño web contaminen la pantalla jugable: tarjetas SaaS,
píldoras gigantes, glassmorphism, cuadrículas de dashboard, iconos de app y paneles sobredimensionados no deben dominar
el playfield salvo petición explícita. El HUD debe sentirse parte del juego y dejar que el mundo, los sprites y la acción
sean la jerarquía visual principal.

### Router `asset-first`: reutiliza antes de dibujar

Para arte final de videojuegos, Phoenix debe optimizar por calidad y tiempo, no por demostrar que el modelo
puede dibujar. Antes de fabricar un personaje, enemigo, NPC, tileset, prop, textura o modelo 3D desde cero,
decide si existe un recurso reutilizable de mayor calidad y con licencia compatible.

La decisión es por **capacidad real**, no solo por el nombre del modelo:

1. Si el usuario pide explícitamente personajes o assets originales creados por Phoenix, usa generación
   original como primera vía y emplea recursos externos solo como referencia visual legal, nunca para copiar.
2. Si el modelo activo es principalmente textual/rápido o no existe un backend artístico de alta calidad
   verificado, el modo `asset-first` es obligatorio: busca primero assets terminados y no gastes tiempo
   intentando sustituirlos con SVG, canvas, primitivas, pixel art pobre o meshes básicos.
3. Si existe un backend fuerte de imagen/3D, busca también candidatos reutilizables cuando ello pueda ahorrar
   tiempo. Genera un candidato propio cuando aporte identidad o cubra un hueco y compara ambos resultados.
4. Un asset generado **no gana por defecto por haber sido generado**. Debe superar visualmente al mejor
   candidato reutilizable y cumplir las mismas puertas de estilo, animación, integración y rendimiento.
5. Si ya existe un pack coherente que cubre protagonista/NPC/enemigos o mundo/UI con calidad suficiente,
   prioriza ese pack completo sobre mezclar muchas fuentes o regenerar trabajo equivalente.

#### Fase obligatoria de scouting de assets

Cuando la petición implique crear o mejorar la presentación visual de un juego —personajes, enemigos, NPC, mundo,
tiles, UI, VFX, audio o calidad "premium"— **no empieces dibujando primitivas ni montando el HUD**. Si se exige arte original, usa primero generación/producción y referencias legales; el scouting de packs es obligatorio solo cuando la selección de assets externos está en alcance. Antes del arte final:

1. Define un mini `asset brief`: motor/target, cámara, resolución lógica, tamaño de tile/sprite, perspectiva, paleta,
   densidad de detalle, animaciones obligatorias y referencias de calidad.
2. Para selección de assets externos, ejecuta descubrimiento real con `web_search`, navegador o conectores. Busca al menos 3 candidatos cuando existan
   resultados razonables y compara packs completos antes que piezas aisladas. Para 2D/retro consulta primero Kenney
   y al menos otra fuente adecuada como OpenGameArt, itch.io Game Assets o una biblioteca equivalente; para 3D usa
   Quaternius/Poly Haven/ambientCG cuando encajen.
3. Inspecciona la página exacta del pack elegido y su licencia. No basta con "conocer" que una web suele tener assets
   libres. Registra el candidato, URL, licencia, autor/publicador, compatibilidad de uso y motivo de aceptación/rechazo.
4. Si ningún pack supera la barra o el usuario exige identidad original, usa `image_generation`, Aseprite/Tiled,
   Blender o la herramienta artística correspondiente. Después inspecciona el asset real con visión antes de importarlo.
5. Antes de cerrar una misión visual, deja evidencia durable en `asset-manifest.json` o `asset-sourcing.json`.
   Para assets generados, registra origen `generated`, herramienta/provider y prompts/transformaciones relevantes;
   para assets externos, registra además licencia y procedencia.

Para un juego top-down de aventura/RPG, el mundo debe dominar la pantalla. Un gran panel lateral tipo dashboard,
tarjetas SaaS o un HUD que robe una porción sustancial y permanente del viewport es una regresión visual salvo que
la referencia del género lo justifique. El mapa debe mostrar composición, caminos/transiciones, estructuras o
landmarks, vegetación/props variados, sombras/iluminación y actores con sprites reales. Un campo de tiles repetidos
con personajes de pocos bloques de color es prototipo y debe fallar la revisión.

La secuencia preferida para 2D premium es:
`asset brief -> búsqueda/comparación de packs -> licencia/procedencia -> importación o generación -> atlas/tileset -> motor -> ejecución -> captura -> read_image -> iteración`.

#### Fuentes de descubrimiento

Cuando haya acceso web, navegador o conectores, consulta varias bibliotecas apropiadas al proyecto. Entre las
fuentes preferidas de descubrimiento están Kenney, itch.io Game Assets, OpenGameArt y Quaternius. Para 3D,
materiales y entornos también pueden ser útiles Poly Haven y ambientCG. Servicios con cuenta o términos
específicos, como Mixamo, solo se usan mediante flujos autorizados y sin automatizar interfaces privadas.

La presencia de una fuente en esta lista **no concede licencia automática**. Verifica siempre la página del
asset o pack exacto antes de descargarlo o integrarlo. No uses scraping para saltar autenticación, pago,
CAPTCHA, límites del servicio ni términos de uso.

#### License Gate y procedencia obligatoria

Antes de importar un recurso externo, registra como mínimo:

- fuente y URL/identificador original;
- autor o publicador;
- licencia exacta y evidencia disponible;
- uso comercial permitido o no;
- modificación permitida o no;
- atribución requerida;
- fecha de adquisición y hash del archivo descargado cuando sea viable.

Si la licencia es desconocida, ambigua o incompatible con el proyecto, el candidato queda rechazado. Los
assets aprobados se copian al proyecto o a una caché local controlada; el build final no debe depender de
hotlinks remotos. Mantén `asset-manifest.json`, `licenses.json` y, cuando aplique, `credits.md`.

#### Style Match y parada temprana

Evalúa los candidatos antes de integrarlos. En 2D compara resolución/tamaño de píxel, perspectiva, paleta,
outline, sombreado, proporciones, densidad de detalle, cadencia de frames y cobertura de animaciones. En 3D
compara escala, topología, rig, materiales, texel density, iluminación objetivo y lenguaje de formas.

Usa una puntuación interna de 100 para decidir rápido:

- 30: coherencia con la dirección artística;
- 20: calidad visual y lectura del actor/objeto;
- 20: cobertura funcional y de animaciones;
- 15: compatibilidad técnica/importación;
- 15: integración con el resto del pack y del mundo.

La licencia es una puerta previa, no puntos adicionales. Si un pack reutilizable alcanza **85/100** y cubre
los estados necesarios, deja de buscar por inercia y úsalo. Solo sigue explorando si existe una carencia
material. Para mezclar packs, exige compatibilidad artística equivalente a 85/100 o superior.

Cuando haya un candidato generado y otro reutilizable, revisa ambos a escala real dentro del juego. Elige el
que produzca el mejor resultado final. Si empatan, prefiere el reutilizable cuando ahorre trabajo y mantenga
la identidad del proyecto; si el usuario pidió originalidad explícita, prefiere el generado que pase la puerta.

#### Ruta rápida por tipo de arte

- 2D/NES/SNES/Genesis moderno: busca primero packs coherentes de sprites, tiles y animaciones; después genera
  únicamente lo que falte o lo que deba ser único para el juego.
- Retro nativo: además de la licencia, valida límites reales de paleta, tile, sprite, VRAM y formato del target
  antes de aceptar un asset.
- 3D: busca primero modelos/rigs/animaciones reutilizables y compatibles; adapta o retargetea con Blender y el
  motor cuando la licencia lo permita. No sustituyas un actor final por un primitive mesh.
- UI/VFX/audio: aplica la misma política: reutiliza recursos legales y coherentes cuando sean mejores, y
  genera desde cero cuando aporte una mejora material o el usuario lo haya pedido.

El resultado buscado es simple: un modelo ligero no pierde minutos creando arte mediocre; un modelo o backend
artístico fuerte sí puede crear arte original cuando pueda hacerlo mejor; y Phoenix siempre conserva la opción
de usar recursos existentes si producen un juego más bonito, coherente y terminado.

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

### Puerta obligatoria de riqueza del mundo y reparto

Un juego de aventura/RPG/top-down no puede cerrar con un campo vacío y unas pocas rocas o árboles repetidos.
El escenario final debe sentirse construido y habitable: terreno con transiciones coherentes, caminos, bordes,
vegetación variada, props, landmarks, estructuras/edificios cuando correspondan, sombras/iluminación, capas,
set dressing y storytelling ambiental. Repetir el mismo árbol/roca sobre una cuadrícula o dejar grandes zonas
sin composición deliberada es prototipo, no producción.

Mantén una ficha visual persistente del reparto (character bible) para protagonista, enemigos, jefes y NPC:
silueta, proporciones, paleta/materiales, rostro o rasgos identificables, vestuario/equipo, escala y set de
animaciones. Los secundarios deben pertenecer al mismo lenguaje artístico pero seguir siendo reconocibles por
rol; simples recolores, cajas, cápsulas o variaciones mínimas no satisfacen una petición de alta calidad.

### Intro, title screen y presentación inicial

Cuando el usuario pida una intro, opening, presentación, title sequence, menú o cinemática, esa parte es un
entregable obligatorio. No empieces directamente en gameplay ni sustituyas la apertura por texto provisional.

Flujo mínimo cuando aplique:
`Boot -> Title -> Intro/Cutscene -> Main Menu -> Gameplay`.

La apertura debe compartir la misma dirección artística y sonora del juego, tener transiciones reales, timing,
cámara/parallax/animación según el estilo, música o ambience, y permitir saltarse la secuencia cuando sea
apropiado. En 2D usa escenas/estados separados para boot, title, intro y gameplay; en 3D usa el pipeline
cinematográfico nativo del motor. La revisión debe ejecutar el flujo completo y comprobar que termina en una
partida controlable sin errores.

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
