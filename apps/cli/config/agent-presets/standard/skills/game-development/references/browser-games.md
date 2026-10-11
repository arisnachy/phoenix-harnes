# Juegos de navegador

Para un arcade pequeño usa una carpeta autónoma con `index.html`, `game.js`, `styles.css`, assets necesarios y `tests/`. Mantén lógica de juego separada del render/input para poder probarla con `node --test`. Añade Phaser solo si facilita escenas, físicas, animaciones o mapas; fija la versión en el proyecto y conserva lockfile.

Sirve por HTTP local, por ejemplo `python -m http.server 8000 --bind 127.0.0.1 --directory <proyecto>`, y abre con el navegador de Phoenix. También puedes usar un servidor Node existente o Vite en el proyecto. No dependas de `file://` para módulos, audio o assets. Documenta cómo arrancar y detener el servidor.

## Motor y calidad: no elijas por costumbre

Antes del primer sprite, ejecuta el selector de motor del toolkit (`game-tools.mjs route --genre "beat-em-up" --delivery chat|desktop|web --quality production`) y revisa el resultado. Un juego premium con combate animado y exportación independiente debe construirse en Godot 4 cuando sea compatible con la entrega; usa Tiled y FFmpeg cuando sean necesarios y verifica con `doctor` / `ensure --allow-install` solo tras autorización. Godot requiere recursos artísticos reales: no convierte automáticamente dos muñecos vectoriales en un buen juego. Los presupuestos de sprites, sonido e integración se auditan como un trabajo aparte.

Para jugar dentro de Phoenix, `phoenix_game` exige HTML ejecutable autocontenido. La exportación Godot Web no es un HTML único: necesita archivos JS/WASM/PCK, servidor y requisitos de navegador. Usa HTML5/Canvas con PNG/sonido real integrado si el destino es el chat; un proyecto Godot adicional se entrega por separado. Nunca envíes al visor de Phoenix únicamente el `index.html` exportado por Godot.

## Patrón ejecutable

1. Estados separados `ready`, `playing`, `paused`, `won/game-over`; máquina de estados y reglas deterministas.
2. `requestAnimationFrame` para pintar, paso fijo/acumulador para simulación. Limita recuperación tras pestaña oculta; pausa con `visibilitychange`. No aceleres según la frecuencia de pantalla.
3. Teclado y Pointer Events/táctil según targets; evita scroll solo dentro del playfield controlado. Botones accesibles, foco visible y controles configurables cuando proceda. Reinicio elimina temporizadores/estado previo.
4. `localStorage` versionado con parse y fallback seguro; falla sin bloquear la partida cuando no está disponible. Guarda solo progreso/récord, nunca datos del proveedor de modelos.
5. Web Audio tras una interacción real para respetar autoplay; mute y volumen. Síntesis es válida para arcade/chiptune. Usa música/ambience/sonidos originales o licenciados si el género los necesita.
6. Diseño propio: composición, tipografía legible, color coherente, feedback y layout responsive. Una carcasa de consola es una dirección posible, no un layout universal. Pixel art preserva escala entera y filtrado nearest.

Snake/Pong/Tetris/2048 pueden usar celdas o geometría como arte final. No añadas una búsqueda de packs, NPCs, sprites con cuatro direcciones o mundo 3D para cumplir un checklist ajeno al género. Si el usuario pide personajes o ilustraciones representacionales, utiliza el pipeline de arte correspondiente.

## Pruebas

Prueba reglas en Node: input simultáneo, colisión, límites, puntuación, reinicio, pausa y aleatoriedad inyectable. En Snake, impedir invertir 180 grados y acumular varias direcciones entre ticks; comida fuera del cuerpo y victoria al llenar el tablero. Estas son pruebas del género, no una plantilla obligatoria para otros juegos.

Con navegador real: empezar, jugar, perder/ganar, pausar/reanudar, reiniciar, recargar el récord, teclado/táctil y viewport móvil. Inspecciona screenshot actual con visión y errores de consola/red. Mide fluidez y comprueba que no hay timers duplicados ni audio infinito después de reiniciar. Entrega el juego, no el servidor de desarrollo como única salida.

Para 3D web, conserva el mismo contrato y usa el motor apropiado: cámara y pointer lock con salida, carga progresiva, sombras/LOD y presupuesto de draw calls. Un request de mundo abierto necesita NPCs/misiones/vehículos y streaming si lo exige el alcance; una demo de cubos no lo satisface.
