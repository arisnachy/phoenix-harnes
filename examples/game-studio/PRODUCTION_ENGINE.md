# Phoenix Game Studio 2.0 — ejecución con pruebas

El usuario pide un videojuego, **no** una galería de imágenes o presets. Kira conserva el alcance del encargo en un manifiesto por género y un GDD; el coordinador de producción recupera el progreso después de una interrupción, y solo acepta evidencia asociada a artefactos reales. No sustituye los motores, la producción audiovisual ni el agente que juega.

## Inicio y recuperación

Desde la raíz del repositorio:

```sh
node examples/game-studio/production-engine.mjs init mi-juego/manifest.json mi-juego/production-state.json
node examples/game-studio/production-engine.mjs next mi-juego/production-state.json
node examples/game-studio/production-engine.mjs status mi-juego/production-state.json
```

La segunda ejecución de `init` se rechaza. Se utiliza siempre `next` para recuperar la fase exacta. Se rechazan cambios en el manifiesto o artefactos registrados sin volver a planificar/invalidad la fase. El estado usa escritura atómica y un lock exclusivo para impedir escrituras concurrentes; solo la coordinadora modifica el estado.

## Puertas del ciclo de producción

| Fase | Evidencia requerida |
| --- | --- |
| `design` | `gdd`, `roster-and-levels` (o `rules-and-levels` para un género abstracto) |
| `vertical-slice` | `playable-build`, `core-loop-test` |
| `asset-production` | `visual-assets`, `audio-assets` cuando aplique |
| `integration` | `runtime-bindings`, `integrated-build` |
| `gameplay-qa` | `complete-playthrough`, `visual-review`, `audio-review` cuando aplique, `regression`, `performance` |
| `publication` | `distributable`, `license-audit`, `quality-gate` |

Ejemplo de confirmación **después** de generar el GDD:

```sh
node examples/game-studio/production-engine.mjs record mi-juego/production-state.json design gdd GAME_PLAN.md kira-director
```

El archivo indicado debe estar dentro del directorio donde vive `production-state.json`. Este comando registra el hash, **no** lee el documento como prueba semántica de calidad. Kira verifica el contenido antes de registrar la evidencia.

## Contrato de integración real

`runtime-bindings` requiere un JSON de la forma:

```json
{
  "bindings": [
    {
      "family": "hero",
      "id": "hero",
      "source": "assets/hero.png",
      "runtimeTarget": "scenes/hero.tscn::AnimatedSprite2D",
      "proof": "qa/hero-running-frame.json",
      "observedCount": 28
    }
  ]
}
```

La muestra es ilustrativa: un manifiesto real necesita una entrada por CADA tarea de `production-state.json.assets`. El motor verifica los archivos `source` y `proof`, su ubicación y hash SHA-256, y rechaza IDs duplicados, elementos sin observación y elementos ausentes. Un contador inventado es inválido como evidencia; las trazas deben proceder de un juego realmente ejecutado, con captura visual/auditiva adicional.

**No reutilizar un asset o sonido sin conexión real con escenas, estados y eventos.** Para Godot, verificar con runtime, import, headless smoke y partida visible. Para HTML5, observar `drawImage`/sprites y reproducción de audio con navegador real; un documento JSON no basta.

## Puerta de calidad sobre 100 puntos

El último paso exige un archivo `quality.json` con calificaciones basadas en evidencia y fallos críticos abiertos:

```json
{
  "scores": {
    "mechanics": 20,
    "animation": 15,
    "enemiesAndBosses": 15,
    "levelDesign": 15,
    "narrative": 10,
    "audio": 10,
    "performance": 10,
    "presentation": 5
  },
  "criticalFailures": []
}
```

Estos valores son **máximos de ejemplo**, NO resultados de una evaluación real. Se exige 90/100 o más, con cero fallos críticos; se normalizan las dimensiones que no apliquen al género, sin exigir jefes a un puzle. Las puntuaciones no sustituyen la inspección de capturas, audio, partida jugada y revisión independiente. `releaseCertified` permanece `false` hasta que exista una certificación externa real.

## Reparación reproducible

```sh
node examples/game-studio/production-engine.mjs invalidate mi-juego/production-state.json gameplay-qa "Fase final del jefe imposible"
node examples/game-studio/production-engine.mjs next mi-juego/production-state.json
```

Invalidar elimina la evidencia de la etapa afectada y de todas sus sucesoras, no destruye escenas ni activos anteriores. La reparación se concentra en el fallo reproducible y las regresiones invalidadas. Los especialistas trabajan sobre un mismo manifiesto, biblioteca de assets y estado; Kira no vuelve a comenzar con nuevos planes cada vez que cambia de modelo.
