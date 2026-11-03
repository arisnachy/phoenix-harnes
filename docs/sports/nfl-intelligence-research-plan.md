# PHOENIX NFL Research Intelligence — plan maestro evidence-first

**Fecha de diseño:** 2026-11-02. **Estado:** plan más implementación incremental, no reivindicación de precisión predictiva o apuestas ganadoras. Quinta disciplina: football americano / NFL tras MLB, soccer, NBA/WNBA y hockey NHL. No es soccer y no mezcla NCAA, CFL ni UFL.

## Objetivo y arquitectura

Construir un **especialista NFL** que investigue evidencias del partido, todas las posiciones de sus plantillas y enfrentamientos por unidad de juego, sin sustituir la investigación por un motor de probabilidad no validado. Reutilizar \`sports.ts\`, \`sports-direct-stats.ts\`, \`sports-deep-context.ts\`, \`sports-market-intelligence.ts\`, \`sports-editorial-discovery.ts\` y vault de odds; evitar cambios que degraden MLB/Soccer/NBA/WNBA/NHL. Flujo: identificación fixture → standings/forma/descanso → 11 ofensivos, 11 defensivos y equipos especiales con estado **confirmado / probable / desconocido** → producción individual del roster → matchups de QB, línea y secondary → lesiones, tiempo meteorológico, coaching, noticias → escenarios por drive/cuarto → comparación con casa real, precio y reglas → abstención o oportunidad para revisar → snapshot y auditoría.

## Investigación: 32 etapas de cada juego

1. Calendario NFL por temporada/semana y fecha, kickoff real en huso de sede y RD, \`eventId\`, \`competitionId\`, fase regular/playoffs, estatus, estadio.
2. Verificación de kickoff futuro: no vender pregame después del inicio; detectar aplazamiento, cambio de sede, tiempo incierto.
3. Ranking divisional/conferencia, W-L-T, diferenciales, strength-of-schedule y rivales realmente enfrentados.
4. Forma últimos 3/5/8 partidos; puntos a favor/en contra, EPA/play y success rate solo donde el proveedor realmente los ofrezca.
5. Splits local/visitante, césped/cubierta, clima y muestras; diferencias de playoffs/regular.
6. Historial head-to-head con el QB, coordinadores, rosters y entrenadores correspondientes; no extrapolar caras antiguas.
7. Descanso desde juego anterior, Thursday/Sunday/Monday, viaje, bye week, distancia y cambios horarios; carga de snaps.
8. Identidad de QB1: roster QB no equivale a QB titular. Verificar game status, parte médico y fuente que lo confirma.
9. QB últimos 3/5 juegos: dropbacks, pass attempts, completions, yards, TD, INT, sacks, passer rating, air yards, pressure-to-sack, EPA/dropback, scramble/rush, splits vs cobertura.
10. Línea ofensiva completa: LT/LG/C/RG/RT, disponibilidad, sacks/pressure allowed, pass block/run block win rate solo si hay tracking licenciado; suplentes y cambios por lesión.
11. Running backs: carries, yardas, explosivos, yards after contact, oportunidades en red zone, goal line, rutas y snaps, uso cuando RB1 se ausenta.
12. Wide receivers y tight ends: target share, route participation, receptions, yards/target, depth of target, drops, separación, 3rd down y red-zone targets; stats por jugador/partido.
13. Equipo ofensivo: plays/game, neutral pass rate, yards/play, EPA/play, 3rd/4th down, red-zone TD%, turnovers, explosivos y situación marcador.
14. Defensa terrestre: rush yards/attempt, explosive runs allowed, tackling, interior/front seven y matchups contra OL/RB.
15. Pass rush y presión: blitz%, sacks, QB hits, presión, edge/DT, stunt, contención de scrambling QB; protección rival.
16. Coberturas secundarias: CB1/CB2/nickel/safeties, man/zone, EPA allowed, completions/targets; no asegurar assignments con solo posición.
17. **Matriz WR/TE vs CB/LB/S**, incluyendo rutas probables, cobertura man/zone, altura, red zone, faltas, ausencia del CB1; confirmar tareas defensivas únicamente con fuente.
18. **Matriz QB+OL vs pass rush+secondary**, dropback, pressure, sacks, blitz pickups, ball security, hot reads y tempo.
19. **Matriz RB+OL vs front seven**, box counts, EPA/run, early down, short-yardage y goal line.
20. Once ofensivo y once defensivo: IDs verificados, probable vs confirmed; snap counts por posición/grupo y substitutes; no inferir titulares por ranking del roster.
21. Rotaciones y coordinadores: cambio de play-caller, 11/12/21 personnel, shotgun/under-center, pace, motion, RPO, no-huddle, ajustes y game script.
22. Special teams: kicker FG% por distancia, PAT, punts, field position, returns, fumbles, punt block y lesiones.
23. Lesiones oficiales NFL/equipos: questionable/doubtful/out/IR, practice participation, kickoff inactives (90 min previos), jugadores traspasados; fecha y timestamp.
24. Clima: viento por hora, ráfagas, precipitación/nieve, temperatura/humedad, domo, superficie, altura; NO afirmar causalidad fuerte sin evidencia.
25. Entrenadores y decisiones: 4th-down aggressiveness, timeouts, challenges, clock management, field goals, red zone/2-min drill; noticias contrastadas.
26. Contexto del referee crew: penalties, pass interference/holding y tasa de banderas si identificados con muestra suficiente; no inventar sesgo.
27. 1Q/2Q/3Q/4Q, 1H/2H y final: movimientos por drives, posesiones, 2-minute, lead protection, trailing pass scripts, OT con reglas específicas de temporada/fase.
28. Expertos y noticias: picks ESPN/Covers/VegasInsider y prensa real con autor, fecha, línea, método; un titular indexado no es un pick verificado.
29. Mercados reales: 2-way ML (o empate cuando aplicable), spread y alt spread, total, team total, 1H/Q1, touchdowns, QB passing yards/attempts/INT/rush, RB rushing, WR/TE receiving yards/receptions/TD, kicker FG, defensa sacks e INT cuando casa cotiza.
30. Comparación casa/mercado/line/price/period/eventId/playerId/date/quoteUpdatedAt; no confundir NFL con NCAAF o cuotas entre partidos. Reglas DNP, overtime, aplazamientos, push y cambios de estadísticas.
31. Kira produce tesis, antítesis, nivel cobertura, escenarios que invalidan, cuestionamiento de cada mercado y decisión: investigar/abstener; nunca inventar porcentajes calibrados ni EV.
32. Snapshot prekickoff y replay después: rosters e inactivos entonces, prices, news, boxscore, cierre de spread, settlement y errores de investigación; evaluación por temporada y mercado sin data leakage.

## Regla de los 22 titulares

El objetivo de investigación **son 11 ofensivos y 11 defensivos por club** (44 titulares en total por encuentro), más ST y profundidad. Son unidades distintas por equipo, no 22 atletas totales para el partido. Guardar \`confirmedStarter\` solo si existe fuente que identifica a cada individuo y unidad; profundidad de roster, profundidad de depthchart o participación previa **no** implica 11 starters confirmados. Las formaciones reales pueden ser distintas y cambiar por drive. Si un QB1 titular no está verificado, Kira debe indicarlo y no cotizar una prop como si participara seguro.

## Fuentes

- ESPN Site \`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=YYYYMMDD\`, summary/roster/news/injuries/standings; ESPN Core donde disponible.
- NFL oficial \`https://www.nfl.com/stats\`, gamebooks, rosters, transactions, injury reports y boxscores, bajo términos de acceso. NFL Next Gen Stats para tracking/EPA si publicado/licenciado, sin inventar muestras.
- PFR/Pro Football Reference y datasets externos solo con derecho de uso; fuentes complementarias con temporalidad documentada.
- Open-Meteo por coordenadas comprobadas del estadio, cubierta/domo verificada; predicción por hora y control de cambios. No usar clima si lat/long inciertos.
- Bookmaker The Odds API \`americanfootball_nfl\`, ESPN odds existentes, fuentes verificables de casas/mercados; no inventar props o event IDs.
- Noticias ESPN, NFL y reporteros oficiales, terceros indexados Covers/VegasInsider como titulares, no picks confirmados.

Campos mínimos de provenance: source, url, observedAt, eventId, teamId, playerId?, season, week, phase, status verified/provisional/missing/stale/contradictory, sample, denominator, units, limitations.

## Mercados y liquidación

- ML, spreads y totales por período: diferencias de **incluye overtime** vs solo tiempo reglamentario, líneas enteras (push) vs medias, reglas de empates y aplazamientos específicas de la casa.
- Props: player passing/rushing/receiving yards, receptions, TD, INT, sacks, kicker, attempts, combos solo si cotizados; ID real del atleta y período, DNP/void/inactive, lesión en juego y correcciones del boxscore.
- Same-game parlay: dependencia fuerte QB passing y WR receiving; RB rushing y guion de partido; scoring/team total y touchdown props; no multiplicar odds como independencia ni dar ticket si no todas las patas son admitidas por la misma casa.
- Exigir fuentes separadas para partido, odds y reglas de casa, incluso con ESPN como base.

## Arquitectura en PHOENIX

- \`nfl-evidence-research.ts\`: consulta segura de calendario, expediente pregame con ID exacto, rosters/estadísticas de equipo/atleta, QB/WR/RB/TE/OL/defensa y duelos por función; conserva faltantes.
- \`nfl-market-settlement.ts\`: reglas aritméticas de marcador por período y props con ID/boxscore, únicamente cuando los datos y reglas son explícitos.
- Tools Kira: \`sports_chat_nfl_slate\`, \`sports_chat_nfl_investigate\` y ampliación posterior \`sports_chat_nfl_players\`, \`sports_chat_nfl_matchups\`, \`sports_chat_nfl_market_review\`, \`sports_chat_nfl_audit\`.
- UI: fondo claro, tarjetas pequeñas, historial reciente, posibles starters no confirmados, QB, OL/WR vs CB/pass rush, lesión, clima y mercado, sin noticias falsas, sin filas gigantes.
- Contrato \`ResearchedOpportunityV1\`: sport football, league nfl, eventId, playerId?, market, selection, period, bookmaker, line, decimalOdds, source, quoteTimestamp, facts[], contradictions[], unknowns[], correlatedWith[], eligibleForTicket=false hasta verificación independiente.

## Hitos / aceptación

N0 documentación; N1 slate, estados e ID; N2 roster vigente y quarterback; N3 métricas individuales y 22 starters por club con evidencias; N4 OL/vs pass rush y WR/CB; N5 injuries/inactives oficiales; N6 clima/descanso y fuentes; N7 mercados props y rulesets; N8 UI Kira; N9 casos reales 2 partidos regular + playoff y falla de fuente; N10 snapshot y benchmark; N11 integración main/stable con checks.

**No declarar completo** hasta tener evidencias reales de los titulares, matchup por jugadores, fuente médica, precios por mercado, replay cronológico, pruebas y SHA de producción. El primer PR operacional no equivale a N0–N11 terminados. No se fuerzan pronósticos ganadores.
