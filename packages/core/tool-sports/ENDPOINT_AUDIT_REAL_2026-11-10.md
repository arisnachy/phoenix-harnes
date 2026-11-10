# PHOENIX · Auditoría real y completa de endpoints deportivos
**Corte:** 10 de noviembre de 2026, hora de ejecución en GitHub Actions (UTC).
**Ejecución reproducible:** [GitHub Actions #42808292764](https://github.com/arisnachy/phoenix-harnes/actions/runs/42808292764).
**Método:** peticiones HTTP reales sin autenticación, cada URL registrada con código HTTP, forma de JSON, conteo y metadatos; no se inventan partidas, cuotas ni lesiones.

## Resumen
Se realizaron **119 verificaciones HTTP**. Las respuestas vacías en una liga sin actividad NO significan error de endpoint. Las respuestas 200 cuyo formato no coincidía con el esquema simplificado del *auditor* se inspeccionaron de nuevo: varias sí tienen datos en `results`, `depthchart`, `events` o `splitCategories`.
**Hallazgos:** 5 feeds completos de lesiones por liga (NBA/WNBA/NFL/MLB/NHL); ESPN Core odds colecciones y detalles de DraftKings con moneylines actuales publicados pero sin `lastUpdated`; respuestas vacías de `/teams/{id}/injuries` (usar feed de liga); NBA CDN HTTP 403; ESPN página HTML odds HTTP 202 sin contenido; estadísticas de equipo JSON bajo `results`.

## Criterios de confianza
- `Datos encontrados`: respuesta con forma y contenido verificables, no implica que sean prepartido, actuales o publicados por la casa elegida.
- `Vacía`: resultado sin objetos de la fecha o temporada (no es fallo técnico).
- `HTTP 200 → []`: endpoint accesible pero no útil para ese paso; hay que probar respaldo y no afirmar plantilla sana.
- `HTTP 403/404`: acceso restringido/ruta no disponible desde este entorno, con respaldo específico.
- **ESPN Core**: cuota observada y atribuida a proveedor; sin hora del bookmaker no se declara aceptación por Juancito ni cotización actual demostrada.

## Matriz individual de endpoints (119 solicitudes)
| Deporte / liga | Paso | HTTP | Resultado | Registros | Endpoint probado |
|---|---|---:|---|---:|---|
| basketball/nba | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=8) |
| basketball/nba | Cartelera | 200 | Datos encontrados | 6 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261110) |
| basketball/nba | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams) |
| basketball/nba | Histórico · muestra histórica | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261109) |
| basketball/nba | Clasificación | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/v2/sports/basketball/nba/standings) |
| basketball/wnba | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20261110) |
| basketball/wnba | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams) |
| basketball/nba | Lesiones por liga | 200 | Datos encontrados | 29 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries) |
| basketball/wnba | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/news?limit=8) |
| basketball/wnba | Clasificación | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/v2/sports/basketball/wnba/standings) |
| basketball/wnba | Histórico · muestra histórica | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20260912) |
| football/nfl | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261110) |
| football/nfl | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams) |
| basketball/wnba | Lesiones por liga | 200 | Datos encontrados | 14 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/injuries) |
| football/nfl | Clasificación | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/v2/sports/football/nfl/standings) |
| baseball/mlb | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261110) |
| football/nfl | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=8) |
| football/nfl | Histórico · muestra histórica | 200 | Datos encontrados | 13 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261108) |
| baseball/mlb | Histórico · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261015) |
| baseball/mlb | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams) |
| baseball/mlb | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit=8) |
| football/nfl | Lesiones por liga | 200 | Datos encontrados | 32 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries) |
| hockey/nhl | Histórico · muestra histórica | 200 | Datos encontrados | 3 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261109) |
| hockey/nhl | Cartelera | 200 | Datos encontrados | 7 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=20261110) |
| baseball/mlb | Clasificación | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings) |
| baseball/mlb | Lesiones por liga | 200 | Datos encontrados | 30 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/injuries) |
| hockey/nhl | Clasificación | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings) |
| hockey/nhl | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams) |
| hockey/nhl | Lesiones por liga | 200 | Datos encontrados | 31 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries) |
| soccer/eng.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261110) |
| soccer/eng.1 | Catálogo de equipos | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams) |
| hockey/nhl | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=8) |
| soccer/eng.1 | Histórico · muestra histórica | 200 | Datos encontrados | 5 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261108) |
| soccer/usa.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard?dates=20261110) |
| soccer/esp.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261110) |
| soccer/mex.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard?dates=20261110) |
| soccer/eng.1 | Noticias | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/news?limit=8) |
| soccer/ita.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/ita.1/scoreboard?dates=20261110) |
| soccer/uefa.champions | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=20261110) |
| soccer/ger.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/ger.1/scoreboard?dates=20261110) |
| soccer/fra.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/fra.1/scoreboard?dates=20261110) |
| soccer/por.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/por.1/scoreboard?dates=20261110) |
| soccer/bra.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=20261110) |
| soccer/ned.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/ned.1/scoreboard?dates=20261110) |
| soccer/arg.1 | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard?dates=20261110) |
| soccer/fifa.world | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20261110) |
| soccer/uefa.europa | Cartelera | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.europa/scoreboard?dates=20261110) |
| soccer/eng.1 | Clasificación | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings) |
| football/college-football | Cartelera | 200 | Datos encontrados | 3 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261110) |
| basketball/mens-college-basketball | Cartelera | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261110) |
| hockey/nhl | NHL oficial | 200 | Datos encontrados | 7 | [Abrir](https://api-web.nhle.com/v1/score/2026-11-10) |
| baseball/mlb | MLB oficial | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-10) |
| basketball/nba | ESPN web de cuotas | 202 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://www.espn.com/nba/odds) |
| basketball/nba | NBA CDN | 403 | HTTP 403 (bloqueo/no disponible) | — | [Abrir](https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json) |
| basketball/nba | NBA oficial (índice) | 200 | Datos encontrados | 34 | [Abrir](https://official.nba.com/nba-injury-report-2026-27-season/) |
| basketball/nba | Resumen | 200 | Datos encontrados | 7 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909960) |
| basketball/nba | Estadísticas de equipo | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/18/statistics) |
| basketball/nba | Roster real | 200 | Datos encontrados | 17 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/18/roster) |
| basketball/nba | Depth chart | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/18/depthcharts) |
| basketball/nba | Lesiones por equipo | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/18/injuries) |
| basketball/nba | Estadísticas de equipo | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/15/statistics) |
| basketball/nba | Depth chart | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/15/depthcharts) |
| basketball/nba | ESPN Core odds | 200 | Datos encontrados | 1 | [Abrir](https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909960/competitions/401909960/odds) |
| basketball/nba | Lesiones por equipo | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/15/injuries) |
| football/nfl | ESPN Core odds · muestra histórica | 200 | Datos encontrados | 1 | [Abrir](https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401873038/competitions/401873038/odds) |
| football/nfl | Resumen · muestra histórica | 200 | Datos encontrados | 9 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401873038) |
| football/nfl | Roster real · muestra histórica | 200 | Datos encontrados | 6 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/1/roster) |
| football/nfl | Depth chart · muestra histórica | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/1/depthcharts) |
| football/nfl | Estadísticas de equipo · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/1/statistics) |
| football/nfl | Lesiones por equipo · muestra histórica | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/1/injuries) |
| football/nfl | Roster real · muestra histórica | 200 | Datos encontrados | 6 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/4/roster) |
| football/nfl | Estadísticas de equipo · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/4/statistics) |
| football/nfl | Depth chart · muestra histórica | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/4/depthcharts) |
| baseball/mlb | ESPN Core odds · muestra histórica | 200 | Datos encontrados | 1 | [Abrir](https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/401908025/competitions/401908025/odds) |
| baseball/mlb | Resumen · muestra histórica | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401908025) |
| football/nfl | Lesiones por equipo · muestra histórica | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/4/injuries) |
| baseball/mlb | Roster real · muestra histórica | 200 | Datos encontrados | 5 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/5/roster) |
| baseball/mlb | Depth chart · muestra histórica | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/5/depthcharts) |
| baseball/mlb | Estadísticas de equipo · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/5/statistics) |
| baseball/mlb | Lesiones por equipo · muestra histórica | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/5/injuries) |
| baseball/mlb | Roster real · muestra histórica | 200 | Datos encontrados | 5 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/30/roster) |
| baseball/mlb | Depth chart · muestra histórica | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/30/depthcharts) |
| baseball/mlb | Estadísticas de equipo · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/30/statistics) |
| hockey/nhl | ESPN Core odds | 200 | Datos encontrados | 1 | [Abrir](https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/401892683/competitions/401892683/odds) |
| baseball/mlb | Lesiones por equipo · muestra histórica | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/30/injuries) |
| hockey/nhl | Resumen | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/summary?event=401892683) |
| hockey/nhl | Roster real | 200 | Datos encontrados | 5 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/21/roster) |
| hockey/nhl | Depth chart | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/21/depthcharts) |
| hockey/nhl | Estadísticas de equipo | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/21/statistics) |
| hockey/nhl | Lesiones por equipo | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/21/injuries) |
| hockey/nhl | Roster real | 200 | Datos encontrados | 5 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/17/roster) |
| hockey/nhl | Lesiones por equipo | 200 | HTTP 200 → [] (usar lesiones por liga) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/17/injuries) |
| hockey/nhl | Estadísticas de equipo | 200 | Datos encontrados | 1 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/17/statistics) |
| hockey/nhl | Depth chart | 200 | HTTP 200 → depthchart (formato real) | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/17/depthcharts) |
| soccer/eng.1 | ESPN Core odds · muestra histórica | 200 | Datos encontrados | 2 | [Abrir](https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/401879244/competitions/401879244/odds) |
| soccer/eng.1 | Resumen · muestra histórica | 200 | Datos encontrados | 8 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=401879244) |
| soccer/eng.1 | Roster real · muestra histórica | 200 | Datos encontrados | 34 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/331/roster) |
| soccer/eng.1 | Depth chart · muestra histórica | 200 | Esquema diferente / dato no probado | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/331/depthcharts) |
| soccer/eng.1 | Estadísticas de equipo · muestra histórica | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/331/statistics) |
| soccer/eng.1 | Roster real · muestra histórica | 200 | Datos encontrados | 29 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/337/roster) |
| soccer/eng.1 | Estadísticas de equipo · muestra histórica | 200 | Vacía / sin datos de esta fecha | 0 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/337/statistics) |
| soccer/eng.1 | Depth chart · muestra histórica | 200 | Esquema diferente / dato no probado | — | [Abrir](https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/337/depthcharts) |
| basketball/nba | Roster real | 200 | Datos encontrados | 18 | [Abrir](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/15/roster) |
| basketball/nba | Cuota Core detallada | 200 | Datos encontrados | 15 | [Abrir](https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401909960/competitions/401909960/odds/100?lang=en&region=us) |
| soccer/eng.1 | Cuota Core detallada · muestra histórica | 200 | Datos encontrados | 17 | [Abrir](https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/401879244/competitions/401879244/odds/100?lang=en&region=us) |
| hockey/nhl | Cuota Core detallada | 200 | Datos encontrados | 15 | [Abrir](https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/401892683/competitions/401892683/odds/100?lang=en&region=us) |
| football/nfl | Cuota Core detallada · muestra histórica | 200 | Datos encontrados | 16 | [Abrir](https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401873038/competitions/401873038/odds/100?lang=en&region=us) |
| basketball/nba | Estadísticas jugador | 200 | Datos encontrados | 1 | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/4683730/stats) |
| basketball/nba | Gamelog | 200 | HTTP 200 → events/seasonTypes | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/4683730/gamelog) |
| basketball/nba | Gamelog | 200 | HTTP 200 → events/seasonTypes | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/5164559/gamelog) |
| basketball/nba | Splits | 200 | HTTP 200 → splitCategories | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/4683730/splits) |
| basketball/nba | Estadísticas jugador | 200 | Datos encontrados | 3 | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/5164559/stats) |
| soccer/eng.1 | Estadísticas jugador · muestra histórica | 404 | HTTP 404 (bloqueo/no disponible) | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/111114/stats) |
| basketball/nba | Splits | 200 | HTTP 200 → splitCategories | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/5164559/splits) |
| soccer/eng.1 | Gamelog · muestra histórica | 200 | HTTP 200 → events/seasonTypes | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/111114/gamelog) |
| soccer/eng.1 | Splits · muestra histórica | 404 | HTTP 404 (bloqueo/no disponible) | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/111114/splits) |
| soccer/eng.1 | Gamelog · muestra histórica | 200 | Esquema diferente / dato no probado | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/249527/gamelog) |
| soccer/eng.1 | Splits · muestra histórica | 404 | HTTP 404 (bloqueo/no disponible) | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/249527/splits) |
| soccer/eng.1 | Estadísticas jugador · muestra histórica | 404 | HTTP 404 (bloqueo/no disponible) | — | [Abrir](https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/249527/stats) |

## Reparaciones del motor vinculadas a esta evidencia
1. Priorizar `/injuries` por liga para recibir lesiones reales de ambos rivales, intentando `/teams/{id}/injuries` solo si faltan grupos.
2. Interpretar `statistics.results`, `depthchart.depthchart` y `splitCategories`; mantener los datos realmente publicados.
3. Mostrar ESPN Core odds con proveedor, mercado, precio observado y la distinción de fecha desconocida. No etiquetar como cero precios si hay líneas de referencia.
4. Renderizar para cada pata el checklist `verified/partial/missing`, el detalle y las rutas principales/respaldos previstos, junto con noticias e imágenes verificadas.
5. El índice oficial de informes NBA es fuente complementaria real; falta verificación automática del contenido PDF para afirmar conciliación clínica completa.

## Límites de esta corrida
- El HTML de ESPN odds dio HTTP 202 y no fue interpretable, pero ESPN Core respondió por separado.
- NBA CDN respondió 403 desde GitHub Actions: no es una fuente de respaldo operativa en este ejecutor.
- Los endpoint de WNBA/MLB fuera de temporada pueden estar sanos pero no proporcionar partidos del día.
- Este inventario prueba rutas una a una, no certifica que cualquier selección tenga un modelo probabilístico calibrado.