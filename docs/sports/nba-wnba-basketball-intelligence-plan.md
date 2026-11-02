# PHOENIX Basketball Intelligence — plan maestro NBA + WNBA (research-first)

**Fecha:** 2026-11-02. **Estado:** especificación técnica para desarrollo; NO implica que el motor esté implementado, calibrado o fusionado.  
**Arquitectura:** NBA Specialist + WNBA Specialist independientes, ambos consumidos por Basketball Coordinator y después por el coordinador multideporte de 5–6 patas.  
**Premisa:** Kira investiga como analista experta y confronta hechos del partido, quintetos y jugadores, no predice automáticamente basándose solo en historial de ganados/perdidos o un Poisson/logístico genérico.

## A. Situación real de PHOENIX y objetivo

En \`main\` ya existen \`packages/core/tool-sports/src/nba-research.ts\` (forma reciente NBA: historial, márgenes, descanso; sin roster/injuries/odds afirmados), \`sports.ts\` (catálogo basketball NBA/WNBA y NCAA, ESPN y cuotas), \`sports-direct-stats.ts\` (atletas desde rosters verificados con estadísticas/gamelogs/splits según disponibilidad), \`sports-deep-context.ts\`, \`universal-matchup-factors.ts\`, \`sports-market-intelligence.ts\`, \`sports-forecast.ts\` (modelo exploratorio NO calibrado) y conectores/credenciales de cuotas. No duplicar lo que ya funciona. La implementación debe reconocer y conservar el **análisis individual NBA y WNBA por separado**, y nunca presentar esos módulos genéricos como un dossier profesional terminado.

**Resultado esperado por evento:** abrir cartelera real → filtrar por datos y valor de investigar → reconstruir roster/estado, quinteto y rotación probable → analizar equipos y cada jugador contra el adversario → escenarios de ritmo/posesiones/segmentos → noticias, bajas, árbitros, expertos → mercados **reales de la misma casa** → tesis, antítesis, precio, reglas y decisión con abstención cuando no hay evidencias → seguimiento tras finalizar y mejora.

**Objetivos de calidad:** precisión factual y trazabilidad; evitar falsas lesiones/lineups/IDs/odds; evaluación retrospectiva sin filtrado de información posterior al inicio; cobertura WNBA **tan explícita** como NBA. No se garantiza ganancia ni se equipara narrativa convincente a edge rentable.

## B. Dos especialistas; reglas y escalas distintas

| Dimensión | NBA | WNBA |
|---|---|---|
| Tiempo reglamentario | 4 × 12 min = 48 | 4 × 10 min = 40 |
| Overtime | verificar reglamento vigente del partido y reglas de casa (normalmente 5 min) | verificar reglamento vigente del partido y reglas de casa (normalmente 5 min) |
| Ritmo y puntos | estadísticas por 100 posesiones y pace/48 cuando fuente usa esa definición | estadísticas por 100 posesiones y pace/40 cuando fuente usa esa definición |
| Minutos para props | uso de minutos proyectados NBA, rotaciones y faltas | uso de minutos proyectados WNBA, rotaciones/plantilla y faltas |
| Temporada/calendario | temporada NBA, Play-In/Playoffs, back-to-back, viajes | calendario propio WNBA, playoffs y ventanas/participación según temporada |
| Datos oficiales | NBA.com/Stats e informes oficiales NBA, ESPN | WNBA.com/Stats, injury report oficial WNBA y ESPN |
| Profundidad | determinar por juego/temporada/fuente | determinar por juego/temporada/fuente: NUNCA asumir paridad de campos con NBA |

**No** trasladar medias NBA a WNBA; distinguir tasas por posesión, 36 minutos, 40/48 min y por partido, y diferenciar diferentes estructuras de temporada, reglas y comparabilidad. No deducir que WNBA está inactiva solo porque no hay encuentro hoy; consultar el calendario de su temporada.

## C. Fuentes y auditoría

1. **ESPN público Site/Core/Summary:** \`basketball/nba\` y \`basketball/wnba\`, scoreboards por fecha, eventId y competitionId, boxscores, jugadas, statistics, standings, teams, rosters, injuries, news y PickCenter/odds si existen; cada endpoint se prueba realmente y devuelve status de cobertura. No inferir que las dos ligas publican exactamente los mismos campos.
2. **NBA.com/Stats** oficiales (incl. glossary, teams/players advanced, four factors, lineups 5-player, on/off, clutch, shot charts, tracking, play types cuando disponibles y bajo acceso permitido). Documentar filtros de temporada, período, local/visita, rival, minutos y fechas; no burlar límites ni asumir licencias de tracking.
3. **WNBA.com/Stats** oficiales (advanced, lineup combinations, pace/40, shooting, play by play e impacto según cobertura real), **WNBA Injury Report** oficial por fecha; comprobar estatus y timestamp, dado que los reportes cambian durante el día.
4. **NBA Official Injury Report** cuando exista ruta fiable y uso autorizado; comunicados oficiales de equipos, entrenadores, jugadores y reporteros contrastados para availability, minute restriction y posibles quintetos; nunca traducir ausencia de registro como jugador disponible.
5. **Medios/opiniones y pronósticos:** ESPN, NBA/WNBA oficiales, Covers, analistas verificados, prensa local y fuentes públicas autorizadas. Cada pick externo requiere autor, publicación, liga, juego, mercado, línea, fuente y fecha; un titular no equivale a un pick.
6. **Cuotas:** ESPN cuando tenga proveedor real, The Odds API \`basketball_nba\`/\`basketball_wnba\`, proveedores de props autorizados, OddsHarvester si documenta soporte verificable, snapshots temporales de ofertas. Claves en vault de PHOENIX, nunca en salidas o logs.
7. **Estadística histórica/avanzada externa:** Basketball-Reference, datos públicos legales, play-by-play y herramientas de scouting licenciadas si el operador dispone de acceso; conservar definiciones. No copiar/scrapear sin permiso ni afirmar tracking existente en todas las temporadas.
8. **Metadatos obligatorios por evidencia:** \`league, season, eventId, teamId, playerId?, provider, route/url, observedAt, effectiveAt, competitionPhase, period, minutes, possessions?, sampleSize, metricName, value, units, coverageStatus, verifiedState, limitations\`. Estados: verified/provisional/stale/missing/contradictory. Nunca traducir missing en cero.

**Disponibilidad:** un game schedule puede estar disponible incluso si estadísticas avanzadas, lesiones o cuotas faltan; cobertura se clasifica por *encuentro y mercado*, no por reputación de la liga.

## D. 30 etapas de investigación humana por partido

**01. Cartelera de las dos ligas.** Juegos NBA y WNBA por fecha/temporada, fase regular/playoffs, tipoff, zona horaria del estadio y de República Dominicana, home/away, sede, estado; eventId auténtico. No proponer pregame si ya empezó. Pausa de temporada WNBA = sin juegos confirmados, no inventar enfrentamientos.

**02. Filtro de cobertura inicial.** Integridad del evento, identidad, archivos de temporada, scoreboards históricos, roster, estadísticas individuales, injuries, lineups, mercado comercial y ruleset; estados: profundizar / pendiente / descartar; no elegir ganador en el cribado.

**03. Récord, clasificación y nivel de adversarios.** W/L, conferencia, racha, ranking por fase, diferencial de puntos, dificultad del calendario, rendimiento contra rivales fuertes/débiles; distinguir temporadas y reconstrucciones de plantilla.

**04. Forma 5/10/15/20.** Resultados y márgenes, tendencia anotación/encaje, rival, local/visitante, calidad de adversarios, overtime, suplencias; no confundir promedio de margen con probabilidad de cubrir spread.

**05. Localía y visita.** W-L home/away, net rating, scoring, ritmo, precisión y volumen de tiro, desempeño en esa cancha, ventajas contextuales reales; controlar muestras y rival, no usar solo narrativa de público.

**06. Descanso y calendario.** Días desde último partido, back-to-back, 3 en 4 noches, 4 en 6, viajes, husos horarios, secuencia de sedes, altas de minutos, vuelos internacionales cuando verificables, series/playoffs y regreso de gira. Evaluar ambos equipos por separado.

**07. Historial H2H actualizado.** 5/10 últimos encuentros, resultados y márgenes, posesiones, lesiones, entrenador, quintetos entonces, cambios de roster y temporada. Los enfrentamientos históricos desactualizados son evidencia débil.

**08. Perfil ofensivo de equipo.** PPG (descriptivo), OffRtg por 100 posesiones, possessions, eFG%, TS%, FG2/FG3, volumen 3PA, puntos en pintura, asistencias, pérdidas, transition, half-court, drive-and-kick, paint touches, tiros libres; solo métricas realmente disponibles.

**09. Perfil defensivo de equipo.** DefRtg, oponentes eFG%/3PA/paint, tapones, rebotes defensivos, pérdidas forzadas, defensa del aro y perímetro, sistemas drop/switch/zone, capacidad contra pick-and-roll, segundas oportunidades. No equiparar steals a defensa global.

**10. Four Factors.** eFG%, TO%, OREB% y tasa de tiros libres de ambos equipos y rivales; confrontar ataque A vs defensa B en factores realmente medidos; documentar denominadores y definición de cada fuente.

**11. Pace y posesiones.** Posesiones por 48 NBA / 40 WNBA según fuente, pace reciente vs temporada, local/visita, pace adversario, primeras mitades, marcador y estilo; una proyección narrativa de total sin ritmo/eficiencia comprobados no justifica apuesta.

**12. Quintetos oficiales y probables.** Cinco titulares, posiciones, estaturas si relevantes, roles, tipo de quinteto, small ball, minutos reales, suplentes y two-way/cambios de roster según liga. Confirmado vs probable claramente diferenciado, roster no es quinteto.

**13. Roster entero y banco.** Por atleta: ID actual y club/temporada, status activo/lesionado/suspendido, últimos partidos, minutos, rol 1.º y 2.º quinteto, sustitutos, minutos de garbage time y disponibilidad. Evaluar rotación efectiva, no atribuir titularidad a nombre famoso.

**14. Cada jugador: producción y eficiencia.** PTS, REB, AST, 3PM/3PA, 2PM/2PA, FTA, STL, BLK, TOV, PF, +/- contextualizado, TS%, USG%, AST%, REB%, ORtg/DRtg, minutos y splits. Últimos 5/10/15 partidos, uso por rol y minutos; promedios por partido, por 36/40/48 y por 100 posesiones **separados**.

**15. Estrellas y disponibilidad hoy.** Lesiones oficiales con actualización, descansos, restricciones de minutos confirmadas o provisionales, regreso de cirugía, expulsiones previas y rotación; impacto de star OUT/in, sustituto y cambio de USG%/AST, no suponer resultados.

**16. Matchups: cada titular × rivales defensivos.** Matriz 5 atacantes vs defensores probables y principales suplentes: ball-handler vs point-of-attack defender, scorer perimetral vs lateral móvil, alero vs wing, poste vs pívot, spacing/closeouts, altura, longitud, faltas, switches. Confrontar tasa de posesiones defendidas si tracking lo publica; nunca inventar 5 duelos fijos para todo el juego.

**17. Quintetos de cinco y combinaciones.** On/off de estrella, quintetos más usados, minutos y net rating, quinteto titular vs rival, parejas que mejor/worst funcionan, restricciones por lesiones y coherencia de muestras; no deducir causalidad de on/off sin rival/contexto.

**18. Banco vs banco / segunda unidad.** Creadores cuando estrella descansa, eficiencia del banco, rebote, pérdidas, anotadores de micro-rotaciones, tramos al final Q1/comienzo Q2 y Q3/Q4, emparejamientos de reservas reales; WNBA especialmente verificar plantillas y profundidad en esa fecha.

**19. Ataque táctico vs cobertura defensiva.** Pick-and-roll handler/roller, pick-and-pop, handoff, isolation, post-up, cuts, spot-up, transition vs half-court, zone, switches, closeout y spacing; volúmenes/eficiencias reales cuando hay play-types licenciados.

**20. Rebote y faltas: riesgos de props.** OREB/DREB, tasa de rebotes disponibles cuando titular está en pista, tamaño de rival, faltas provocadas, jugadores que disputan puntos en pintura, riesgo de foul trouble y ajustes por ausencia del pívot/rim protector.

**21. Lanzamientos: 3PT, zonas y shot profiles.** Jugadores catch-and-shoot vs pull-up, triples de esquina/arriba, rim/floater/midrange, defensores cercanos, 3PM vs attempts, regresión de rachas y volumen, variación del esquema rival; no atribuir % a una sola muestra.

**22. Entrenador, ajustes y motivaciones verificables.** Historial de sustituciones, distribución de minutos, quintetos usados, lesiones, cambios de sistema, gestión del clutch y diferencia amplia, playoff positioning o eliminación. No inferir motivación psicológica como dato objetivo.

**23. Árbitros y disciplina del encuentro.** Crew designado, promedio de faltas y FT/partido y características por temporadas comparables cuando fuentes fiables; comprobar normas de arbitraje de la liga. No afirmar que un árbitro favorece a un equipo por un histórico pequeño.

**24. Noticias, expertos y mercado.** Confirmar periodistas, partes oficiales, equipos, reportes lesión, puntos de vista divergentes, recomendaciones ESPN/PickCenter/Covers cuando realmente publicados y línea exacta. Diferenciar opinión externa de inferencia de Kira y cuota implícita.

**25. Lectura por tramos Q1–Q4 y 1H/2H.** Tipoff, primeros 6 min, rotaciones, cierre Q1, segunda unidad Q2, ajuste al descanso, finales y clutch. Preguntar si la lectura sustenta línea FT o 1H/Q1; incluir overtime **solo cuando el mercado lo contemple**.

**26. Escenarios de juego narrativos.** Ritmo alto vs bajo, diferencia de tiro, remontada, noche de triples extraordinaria, estrella OUT o minutos limitados, faltas tempranas, blowout con sustitución de titulares, clutch, OT; cada escenario tiene hechos a favor/en contra y cómo cambia mercados. No fingir jugadas futuras ni precisión numérica.

**27. Menú real de mercados por liga y casa.** Moneyline, spread/handicap, total juego y por equipo, Q1/Q2/Q3/Q4, 1H/2H, alternate lines y player props PTS, REB, AST, 3PM, STL, BLK, TO, PRA/PR/PA/RA, double-double/triple-double si casa lo cotiza. Verificar nombres, line, units, price, timestamp, playerId, bookmaker, period, odds region y límites.

**28. Precio, settlement y contradicción.** Por ejemplo: casa total 220.5 y tesis apunta a más puntos por ritmo+eficiencia: **no** convertir en Over sin revisar escenarios de pace menor, defensa, faltas y posibles blowouts. Línea 220.0 tiene push cuando el marcador final elegible totaliza 220 según ruleset; 220.5 no. Props pendientes de DNP, eligible participation, overtime, suspensión, void. Multiplicar odds no prueba rentabilidad.

**29. Conclusión de Kira por mercado.** Clasificar \`research_ready | candidate_for_review | abstain\` con tesis, fuentes, contraargumentos, ausencia de jugadores, cambios que invalidarían, precio, snapshot y advertencias. No publicar P(win), EV o ventaja numérica sin modelo auditado/calibrado fuera de muestra; puede ofrecer interpretación cualitativa y abstención.

**30. Seguimiento retrospectivo.** Guardar expediente sellado ANTES de tipoff, rosters en ese momento, status de lesiones, opiniones, cuotas y decisiones; luego boxscore oficial, rotación real, minuto de lesión, resultado por cuarto y liquidación de casa. Evaluar aciertos, rechazos, desempeño por liga/mercado y errores de investigación; no reescribir snapshots tras el partido.

## E. Marco especial de la investigación individual y de quintetos

Una matriz profesional no se reduce a cotejar PPG vs puntos concedidos:

- **Guard/ball handler:** uso, AST, TOV, drives, pick-and-roll, blitz/traps y punto de ataque rival; props asistencias y pérdidas.
- **Shooting guard/wing:** intento y acierto 3PT, calidad de tiro, catch-and-shoot, defensa contra posiciones, minutos disponibles y closeouts; props triples y puntos.
- **Forward:** cortes, rebote, juego en transición, matchups de tamaño y defensa de cambios; PTS+REB/PRA.
- **Center:** rebotes contestados, minutos y faltas, rim protection, rollman/post/putbacks, oponente que abre pista o juega interior; REB/BLK/PTS/FT.
- **Suplentes clave:** cambio de uso y minutos cuando estrella sale; rotaciones, garbage time y segundos quintetos.

**Matriz de equipo** = \`lineup_5_on_5 × opponent_5_on_5\` por tramos cuando hay datos, correlaciones de PTS/AST/3PM de manejador y anotador, o REB de compañeros. Relevancia estadística solo con suficientes posesiones y períodos comparables, indicando sample size y el peso de rivales.

## F. Reglas del juego, períodos y settlement

1. NBA tiene 48 min reglamentarios; WNBA 40; preservar período \`regulation\`, \`full_game_including_ot\`, \`1h\`, \`2h\`, \`q1..q4\`, \`player_prop\`; la casa determina exactamente cuándo computa OT y void.
2. En NBA/WNBA el empate al final de tiempo reglamentario conduce a OT; los mercados ML/total/props pueden incluir OT dependiendo de la casa, mientras Q1/1H no deben absorber puntos de OT.
3. Spread -1.5 vs -2, totales 220 vs 220.5, línea entera push; alternate líneas y periodos no son equivalentes; revisar reglas de casa sobre abandono y suspensión.
4. Para props confirmar elegibilidad, jugador DNP, jugador que participa un instante, lesión/foul-out, sustituto, trade, datos oficiales de boxscore y cambios de stat corrections.
5. Combo de props \`PRA\` significa PTS+REB+AST y debe liquidarse con las estadísticas elegibles del mismo boxscore; triple-doble/doble-doble se define por los cinco rubros específicos según casa.
6. No confundir Player Point + Team Total + Game Total con selecciones independientes en una combinada: correlación y reglas SGP del operador.
7. Regular season vs playoffs, play-in y eventos especiales tienen ruleset y distribución de minutos diferentes. En WNBA no asumir la misma estructura de NBA.
8. Para todos los mercados \`line, odds, selection, bookmaker, observedAt, competition, source, ruleSet\` son obligatorios antes de llamar la apuesta cotizada.

## G. Modelo de datos y contrato para coordinador 5–6 patas

- \`BasketballDossierV1:\` league(nba|wnba), season, phase, eventId, opponentIds, scheduledAt, venue, sourceTimestamp, rosterSnapshot, lineupStatus, injuries, starters[5], bench, teamForm, teamAdvanced, playerStats, rotations, lineupFiveData, opponentMatchups, scenarios, thirdPartyPicks, missingEvidence, sourceCoverage, contradictions.
- \`BasketballResearchOpportunityV1\` (compatible con \`ResearchedOpportunityV1\` del coordinador): sport='basketball', league, bookmaker, eventId, teamId, playerId?, marketFamily, period, selection, line, decimalOdds, quoteUpdatedAt, sportsbookRuleId, evidence[], positiveFacts[], contradictions[], missingEvidence[], uncertaintyNotes[], correlationKeys[], recommendation, eligibleForTicket=false hasta validación.
- Identidad: evento ESPN ≠ evento casa; unirse con 2 equipos, horario y liga, verificando IDs cross-provider; un jugador traspasado no puede aparecer como prop del equipo anterior; torneo, fecha y reglas deben corresponder.
- \`probability\` opcional y documentada SOLO si existe metodología cuantitativa validada con backtesting cronológico; \`expectedValue\` no se inventa. No forzar ticket 5/6 patas cuando no hay ofertas suficientes; no mezclar precios de varias casas como un ticket realmente realizable.

**Estado de disponibilidad:** \`fixtureVerified, teamIdsVerified, lineupConfirmed, rosterCurrent, injuriesCurrent, opponentMatchupsObserved, minutesSupported, refereeVerified, freshPrice, settlementVerified, thirdPartyPickVerified, validatedProbability\`, cada campo con fuente, TTL y estado. Es preferible una abstención precisa a un falso nivel de certeza.

## H. Arquitectura PHOENIX y herramientas de Kira (propuestas)

**Separar módulos:**
- \`basketball-research-core.ts\`: contratos, fuente/coverage/snapshots, parsing, pregame gates, market-review interfaces; sin tácticas específicas.
- \`nba-evidence-research.ts\`: NBA cards, datos oficiales, scouting team/roster, lineup combinations, lesiones y matchups.
- \`wnba-evidence-research.ts\`: mismo alcance funcional pero adaptadores WNBA, pace/40, injury report y temporada independiente.
- \`basketball-rotations.ts\`: auditoría de minutos y quintetos/five-man units, carga y escenarios con fuentes.
- \`basketball-market-review.ts\`: mercado comercial verificado, reglas de período, contradicciones y abstención; no motor de cuotas sintético.
- \`basketball-settlement.ts\`: settlement 90? NO (esto era soccer). Para basketball usar OT, períodos, push, spreads, totales, props, stat corrections y void, con pruebas por liga/casa.
- \`basketball-audit.ts\`: replay de snapshots prepartido, boxscore final y reglas de liquidación.
- Usar \`sports-direct-stats.ts\`, \`sports-deep-context.ts\`, \`nba-research.ts\` y \`sports-market-intelligence.ts\` ya existentes en lugar de duplicar código.

**Herramientas de Kira:**
- \`sports_chat_basketball_slate\` (NBA/WNBA por fecha y temporada),
- \`sports_chat_nba_investigate\` y \`sports_chat_wnba_investigate\` (expediente profundo por eventId real),
- \`sports_chat_basketball_roster\` (quinteto 5+suplentes, minutos, lesiones),
- \`sports_chat_basketball_matchups\` (roles/defensores, lineup×lineup, banco×banco, página),
- \`sports_chat_basketball_market_review\` (mercados reales por casa y contradiction),
- \`sports_chat_basketball_audit\` (replay cronológico y desempeño).

**Orquestación eficiente:** descubrir slate para las dos ligas, filtrar, profundizar solo 2–5 partidos plausibles, caché de standings y stats de temporada, TTL cortos para lesiones/lineups/odds, fetch paralelo con semáforo, retry acotado, fuente caída reportada, Kira reevalúa solo dependencia cambiada (star OUT, lineup, price).

**Interfaz:** tema claro y tarjetas pequeñas: cartelera → 2 equipos → tendencia → quintetos/estrellas → matriz PG/SG/SF/PF/C vs defensor y banco → descanso/lesiones → four factors/pace → escenarios Q1/1H/FT → expertos → cuotas por casa → dictamen + contradicciones. Selector NBA/WNBA explícito; no combinar las dos en un supuesto promedio de puntos. Noticias en español con atribución.

## I. Entregas y aceptación

- **B0 — Este plan:** designar NBA y WNBA especialistas y backlog detallado, fuente+regla+histórico; no tocar runtime en PR documental.
- **B1 — Integridad NBA/WNBA:** carteleras futuras + event IDs y calendario/season de cada una; pruebas de no partidos WNBA fuera de temporada, horarios RD, marcador iniciado vs pregame y split season.
- **B2 — Rendimiento por equipo:** 5/10/20, home/away, back-to-back/rest days, standings, pace, Four Factors, offense/defense/net ratings, muestras y fuentes.
- **B3 — Roster/quinteto:** rosters actuales, posiciones, cinco titulares confirmados vs probables, minutos, injuries por liga, trade/suspensión, suplentes y ausencias; prueba de jugadores desactualizados.
- **B4 — Jugador y quintetos:** gamelog por atleta, per-36/per-40/per-100, on/off, rotaciones, five-man units, matchups por rol y oponentes, muestra pequeña, disponibilidad de tracking; benchmark en cada liga.
- **B5 — Noticias y escenarios:** reported changes, coach, travel, foul trouble/blowout, Q1/1H/FT, árbitros y picks externos; evidencia positiva/contraria y abstención.
- **B6 — Mercados y settlement:** ML, spreads, totals, team totals, quarters/halves, props PTS/REB/AST/3PM/PRA, OTT vs regulation, DNP/void, línea entera push, correlación, cuota real y casa.
- **B7 — Interoperabilidad:** \`BasketballResearchOpportunityV1\` y gateway al agregador 5/6 patas de MLB/Soccer/otros, con no independencia supuesta y restricciones SGP.
- **B8 — Verificación en la vida real:** partido NBA verificable con roster/5 titulares/5×5 matchups/bench y uno WNBA; cobertura por campo; casos de lesión o noticia tardía; UI y pruebas TypeScript/Windows.
- **B9 — Historial y evaluación:** replay de snapshots antes de juego, backtesting cronológico, cobertura de muestras y métricas por mercado; NO proclamar «modelo ganador» sin resultados fuera de muestra.
- **B10 — Promoción:** checks pertinentes en verde, sin secretos en logs, CI, SHAs main/stable comprobados. No saltar gates para esconder fallos.

**Criterios mínimos verificables:**
1. NBA y WNBA tienen **distinto researcher** con paridad de preguntas y escalan periodos/ritmo según reglamento.
2. En ambos, un expediente muestra **cinco titulares confirmados** si la fuente los da, y marca «no confirmado» si no; no reemplaza con último quinteto sin aviso.
3. Todos los titulares y suplentes pertinentes se analizan contra defensores y bancos reales o se presentan como matchups hipotéticos claramente condicionados.
4. Lesiones actuales y cambios de minuto tienen fuente/timestamp, sin inferir que un listado sin lesionados confirma salud.
5. Las cuotas de ML/spread/total y props de jugador se cotejan por evento, período, casa y jugador.
6. Pruebas cubren 48 vs 40, OT/no OT, Q1/1H/FT, DNP, total/spread entero push, props correlacionados, ausencia de jugador, equipos intercambiados, odds stale y abstención.
7. Ningún mercado se promueve por una proyección heurística ni por opinión de experto sin evidencia contradictoria y evaluación de precio.
8. Se registran faltantes por liga/temporada; nunca declarar «WNBA no tiene datos» cuando hay fuente oficial, ni inventar contenido si el endpoint no responde.
9. El optimizador interdeportes no forzará 5/6 patas, no mezclará books ni inventará same-game parlays.
10. Solo considerar el especialista terminado cuando exista prueba end-to-end real de ambas ligas, auditoría temporal y CI pertinente aprobado.

## J. Referencias y documentación a probar al implementar

- ESPN Site API usado por PHOENIX en \`sports.ts\`; raíz NBA \`/sports/basketball/nba\` y WNBA \`/sports/basketball/wnba\` (endpoints y contenidos se deben sondear).
- NBA glossary: https://www.nba.com/stats/help/glossary
- NBA FAQ de posesiones, Four Factors y alineaciones: https://www.nba.com/stats/help/faq
- WNBA Stats advanced/pace: https://stats.wnba.com/impact/advanced/
- WNBA Stats 5-player lineups: https://stats.wnba.com/lineups/advanced/
- WNBA injury report: https://www.wnba.com/wnba-injury-report
- WNBA FAQ reglamento/temporada: https://www.wnba.com/faq
- WNBA rules: https://www.wnba.com/wnba-rule-book
- Basketball-Reference glossary: https://www.basketball-reference.com/about/glossary.html
- Comprobar disponibilidad real, cambios contractuales, formato de temporada y acceso del proveedor por cada año: documentación NO equivale a cobertura verificada de hoy.
