# PHOENIX · Procedimiento verificable de datos NBA + NFL

**Corte:** 12/11/2026. **No confundir HTTP 200 con extracción exitosa.**
Fuentes de ESPN Site/Common/Core son interfaces públicas no documentadas oficialmente: comprobar respuesta real, contrato y procedencia en cada ejecución.

## 1. Ejecución reproducible

Desde raíz del proyecto, con Node.js 24:

```powershell
node --experimental-strip-types scripts/phoenix-nba-nfl-endpoint-proof.mjs 20261112
```

Sin fecha, usa el calendario de Santo Domingo. Produce `phoenix-nba-nfl-endpoint-proof.json`. Desde GitHub Actions, buscar el workflow **PHOENIX Sports real endpoint matrix** y su artefacto **phoenix-nba-nfl-endpoint-proof**. Para exigir HTTP y plantillas utilizables en ambas ligas:

```powershell
$env:PHOENIX_SPORTS_PROOF_STRICT="1"
node --experimental-strip-types scripts/phoenix-nba-nfl-endpoint-proof.mjs 20261112
```

La salida contiene por liga: `schedule`, `weeklySchedule` (NFL si procede), `injuries`, `standings`, `news`, `eventId`, `teams[].roster`, `teams[].depthChart`, `teams[].teamStatistics`, `teams[].schedule`, `teams[].athlete.routes`, y los datos **ya interpretados** por el adaptador en `adapter.teams[].athletes[].coverage`.

## 2. Fuente → endpoint → validación

`S = https://site.api.espn.com/apis/site/v2/sports`
`W = https://site.web.api.espn.com/apis/common/v3/sports`
`V = https://site.api.espn.com/apis/v2/sports`

| Paso | NBA (basketball/nba) | NFL (football/nfl) | Evidencia mínima |
|---|---|---|---|
| Cartelera, hora RD, local/visitante, eventId | `S/basketball/nba/scoreboard?dates=YYYYMMDD` | `S/football/nfl/scoreboard?dates=YYYYMMDD`; si 0, `?season=YYYY&seasontype=2&week=N` | `events[].id`, fecha y los dos `competitors` |
| Resumen y boxscore | `S/basketball/nba/summary?event=EVENTID` | `S/football/nfl/summary?event=EVENTID` | `header`, `boxscore` y participantes; prever resumen parcial antes del inicio |
| Plantilla real | `S/basketball/nba/teams/TEAMID/roster` | `S/football/nfl/teams/TEAMID/roster` | Contar IDs reales en `athletes[]` o `athletes[].items[]` |
| Depth chart | `S/basketball/nba/teams/TEAMID/depthcharts` | `S/football/nfl/teams/TEAMID/depthcharts` | Reconocer `depthchart.positions` o `depthCharts[].positions`; extraer posición, rango y jugador |
| Estadísticas equipo | `S/basketball/nba/teams/TEAMID/statistics` | `S/football/nfl/teams/TEAMID/statistics` | Inspeccionar `results` o `categories`; no inferir pace, xG, EPA o TS% si no existen |
| Calendario/resto | `S/basketball/nba/teams/TEAMID/schedule` | `S/football/nfl/teams/TEAMID/schedule` | IDs de partidos, resultados, fechas y tipo de temporada |
| Lesiones | `S/basketball/nba/injuries` | `S/football/nfl/injuries` | `injuries[]`; unir por ID del equipo y del atleta; contrastar parte oficial |
| Clasificaciones | `V/basketball/nba/standings` | `V/football/nfl/standings` | `children`; **NO** usar `apis/site/v2/.../standings` |
| Noticias | `S/basketball/nba/news?limit=8` | `S/football/nfl/news?limit=8` | `articles[]` con fecha de publicación |
| Estadísticas jugador | `W/basketball/nba/athletes/ATHLETEID/stats` | `W/football/nfl/athletes/ATHLETEID/stats` | Métricas realmente interpretadas y temporada |
| Gamelog jugador | `W/basketball/nba/athletes/ATHLETEID/gamelog` | `W/football/nfl/athletes/ATHLETEID/gamelog` | Eventos con IDs, fechas y estadísticas, no promedios disfrazados de partidos |
| Splits situación | `W/basketball/nba/athletes/ATHLETEID/splits` | `W/football/nfl/athletes/ATHLETEID/splits` | Dimensiones local/visitante u otras **solo si aparecen**, sin rellenar con cero |
| Odds ESPN Core | `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/EVENTID/competitions/EVENTID/odds` | `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/EVENTID/competitions/EVENTID/odds` | Proveedor, selección, mercado, precio y observación; no confundir con aceptación en otra casa |

### Endpoints que ya mostraron fallas de **usabilidad** en la auditoría real anterior

- **NBA y NFL, `/teams/{TEAMID}/injuries`**: HTTP 200 con `[]`. No marcar «sin lesionados»: consultar `/injuries` por liga y filtrar equipos.
- **Depth chart**: HTTP 200 con datos estructurados bajo `depthchart`; el anterior extractor de métricas numéricas lo interpretaba erróneamente como vacío. Usar ahora `parseEspnDepthChart`.
- **NBA CDN**: hubo HTTP 403 desde GitHub Actions. No bloquear todo el dossier por el CDN: usar ESPN summary/boxscore con procedencia.
- **NBA/NFL atleta /splits**: disponibilidad variable. HTTP 200 sin campos interpretables no es split comprobado. Registrar URL, esquema, conteo y temporada.

Estas observaciones proceden de la auditoría de **119 peticiones HTTP del 10/11/2026**, no de una afirmación de disponibilidad continua. Consultar `packages/core/tool-sports/ENDPOINT_AUDIT_REAL_2026-11-10.md`.

## 3. Investigación obligatoria de Kira, por partido

1. Obtener calendario y resolver **IDs del evento y de cada equipo**. Verificar que fecha, localía y hora RD correspondan al juego.
2. Leer últimos 5, 10 y 20 resultados (solo partidos previos al inicio), calidad de rivales, casa/visita, descanso y viajes. En NFL activar el fallback de semana; no marcar «sin juegos» por un día sin actividad.
3. Leer estadísticas de **ambos** equipos. NBA: ORtg/DRtg/NetRtg/Pace, eFG%, TS%, rebotes, pérdidas, triples, FT, on/off cuando exista una fuente real. NFL: EPA/play, success rate, pase/carrera, presión/sacks, red zone, 3rd down, turnovers, special teams y lesiones. No llamar «verificada» una métrica no recibida.
4. Obtener **toda la plantilla**, luego seleccionar un subconjunto útil para llamadas individuales; conectar cada métrica a un `ATHLETEID` del roster. Depth chart indica prioridad, no disponibilidad confirmada.
5. Para cada jugador elegido, `stats`, `gamelog`, `splits`. Guardar las rutas con `available`, `empty` o `unavailable`; las estadísticas local/visita solo existen si se recibieron como tales.
6. Correlacionar lesiones con reportes **oficiales** y noticias publicadas; distinguir «probable», «questionable», «out» y starter confirmado. En NFL contrastar lista oficial de inactivos antes del inicio; en NBA parte médico oficial y quintetos.
7. Registrar odds como observaciones atribuidas y comprobar mercado/período/proveedor. Calcular o estimar probabilidades únicamente con modelo contrastado, indicando incertidumbre y sesgo.
8. Registrar `sources[]`, el conteo por fuente, campos faltantes y respaldo consultado. No reducir a «12 faltantes» si se trata de 12 comprobaciones diferentes.
9. Si un endpoint responde 200 pero parser extrae 0, **error de extracción o esquema por auditar**, no «dato inexistente». Conservar muestra limitada de llaves JSON y activar respaldo.
10. Publicar el dossier y ticket con datos **realmente encontrados**, riesgos y cobertura; no inventar titulares, lesiones, splits ni ganadores certeros.

## 4. Criterio de aceptación verificable

Para una muestra NBA y una NFL se exige:
- HTTP y esquema registrados en JSON; roster con jugadores identificables en ambas ligas.
- Depth chart con nombres y rangos cuando la fuente los publica; `adapter.teams[].depthChartRows > 0` cuando el endpoint contiene atletas estructurados.
- Comprobación de `athlete.stats`, `gamelog` y `splits` con cobertura individual, incluso si algunos responden vacíos.
- Parte de lesiones por liga leído y correlacionado (si existe); distinguir lesión no encontrada de feed no accesible.
- La CI publica un artefacto y falla en modo estricto si **no logra obtener ninguna plantilla utilizable** por liga.
- Ninguna afirmación de «todos los campos disponibles» sin conteos, horas y fuentes verificables.

### Referencias internas

- `packages/core/tool-sports/src/sports-direct-stats.ts` — extracción de plantilla, métricas y depth chart.
- `packages/core/tool-sports/src/espn-nfl-weekly.ts` — NFL fallback temporal y de semana.
- `packages/core/tool-sports/src/basketball-evidence-dossier.ts` — NBA expediente.
- `packages/core/tool-sports/src/nfl-evidence-research.ts` — NFL expediente.
- `.github/workflows/phoenix-sports-endpoint-audit.yml` — pruebas y evidencias HTTP.
