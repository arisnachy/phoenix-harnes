# PHOENIX Hockey Intelligence — plan maestro research-first NHL + hockey mundial

**Diseño:** 2026-11-02 · **Ámbito:** hockey sobre hielo, empezando por NHL · **Producto:** especialista de Kira para investigación, fuentes y contraste de mercados; NO garantía de predicción rentable.

## 0. Decisión arquitectónica

Construir el **quinto deporte especializado** de PHOENIX sobre el mismo contrato de investigación auditable de MLB, Soccer, NBA y WNBA. Kira no elige ganadores por promedios aislados: examina **portero titular contra estructura de tiros y líneas ofensivas rivales**, emparejamientos defensivos, 5v5, power play/penalty kill, cambios de líneas y plantillas, cansancio, lesiones, contexto, noticias, odds vigentes y contradicciones. El motor es la investigación; números por sí solos no sustituyen la lectura profesional del encuentro.

El nivel NHL debe ser profundo. Luego ampliar por **adaptadores por competición**, nunca inventando estadísticas donde no existan: AHL (Norteamérica); KHL (Eurasia/Rusia, sujeto a cobertura legal), SHL (Suecia), Liiga (Finlandia), DEL (Alemania), National League (Suiza), Extraliga (República Checa), HockeyAllsvenskan, Champions Hockey League, IIHF y torneos olímpicos, ligas júnior como OHL/WHL/QMJHL, hockey femenino PWHL e internacional cuando haya identidad y fuentes fiables. No confundir field hockey con ice hockey. El hockey internacional usa OT, puntajes, calendario, sanciones y criterios particulares: NO heredar reglas NHL.

## 1. Fuentes, acceso y procedencia

**Primarias NHL (públicas, no necesariamente documentadas ni garantizadas):**
- NHL Web API \`https://api-web.nhle.com/v1/score/YYYY-MM-DD\`, \`/schedule/YYYY-MM-DD\`, \`/standings/YYYY-MM-DD\`, \`/gamecenter/{gameId}/landing\`, \`/boxscore\`, \`/play-by-play\`, \`/roster/{TEAM}/current\`, \`/club-stats/{TEAM}/{season}/{gameType}\`, \`/player/{id}/landing\` y \`/player/{id}/game-log/{season}/{gameType}\`. **No inferir lineup titular a partir del roster, ni portero confirmado a partir del primer jugador listado**.
- NHL Stats REST \`https://api.nhle.com/stats/rest/en/...\` para reportes skater/goalie/team, power play, penalty kill, días de descanso, saves by strength, shooting y shift charts cuando haya identificadores compatibles. Verificar esquema/permiso en cada llamada.
- ESPN \`hockey/nhl\` Site/Core, eventos y \`summary\`, equipos, rosters, lesiones, noticias, odds/PickCenter **cuando responda y aplique**. Identidades ESPN y NHL Game ID son espacios distintos; reconciliar con fecha, abreviaturas y equipos, jamás hacer match solo por nombres de estrella.
- NHL EDGE, seguimiento avanzado de ubicación, velocidad, tiros y zonas desde las temporadas cubiertas; disponibilidad y licencia varían. xG, GSAx, HDCA y mapas pueden requerir proveedor distinto y una definición documentada; no calcular una métrica ficticia por ausencia.
- NHL.com y clubes: información oficial de goalies confirmados, morning skates, reportes de disponibilidad, suspensiones, entrenamiento de líneas y coach, timezone de la sede.
- Otros proveedores autorizados: MoneyPuck u otra fuente analítica con términos válidos, The Odds API v4 \`icehockey_nhl\`, ESPN odds, medios especializados, Covers, VegasInsider y prensa identificable.
- Para ligas internacionales: IIHF y liga/federación oficial y feed autorizado por país; almacenar reglas específicas y señalar la disponibilidad real.

**Átomo de evidencia:** source,url,observedAt,effectiveAt,league,season,gameIdNHL,eventIdESPN,teamId,playerId?,metric,unit,sample,numerator?,denominator?,gameState,scope (season,last5,last10,home,away,5v5,PP,PK,regulation,OT),status (verified/provisional/stale/missing/conflicting),limitations. Nunca traducir falta de datos como cero.

## 2. Las 32 etapas de investigación por partido

1. **Calendario:** encuentro real por fecha y liga, NHL Game ID, hora RD y local, estado, home/away, sede, temporada y fase.
2. **Verificación cruzada:** ESPN vs NHL oficial; equipos, IDs, horario y fase; bloquear pregame si comenzó/cambió.
3. **Tabla:** puntos, récord reglamentario, derrotas OT, porcentaje puntos, diferencia goles, divisiones y conference.
4. **Forma 5/10/20:** resultados, cambios de rival, desempeño si el partido llegó a OT/shootout y diferenciales por situación.
5. **Local/visita:** promedios de goles/tiros, xGF/xGA si existe, portero y calidad de rivales; muestras por estadio.
6. **H2H contextual:** últimos enfrentamientos, portero titular entonces, lesiones, entrenador, líneas y localía; evitar sesgo por pocos juegos.
7. **Goles/tiros 5v5:** GF/GA, SF/SA, shot attempts, Corsi/Fenwick ajustados si proveedor fiable, oportunidades y 5v5 goal share.
8. **Calidad de oportunidades:** zonas, slot, rebounds, high-danger, rush chances, xG 5v5/PP y estabilidad de la muestra solo si se dispone de fuente.
9. **Shot profile rival:** tipos, distancia, ángulo, lateralidad, tiros permitidos en inferioridad, rebound chances.
10. **Porteros actuales:** roster oficial de goalies, titulares probables vs confirmados; **NINGÚN "confirmed" sin noticia/acta/fuente explícita**.
11. **Portero vs tiros del rival:** SV%, GAA, starts, shots against, paradas recientes, splits casa/visita, xG contra y GSAx cuando existe; carga y tiempo de descanso.
12. **Portero suplente:** diferencia de escenarios por cambio tardío, enfermedad, descanso, pulled goalie, lesiones o scratch.
13. **Skaters completos:** roster vigente, forwards, defensa y goalies por ID; situación de lesión, IR, suspensión, scratch y traspasos.
14. **Producción individual:** G, A, P, +/- contextualizado, SOG/60, intentos, shooting%, TOI, PPG/PPA, faceoffs, hits, blocks, PIM, últimos 5/10; tasa por minutos SOLO con denominador.
15. **Líneas ofensivas:** línea 1–4 y centros/alas, TOI conjunto, química, frecuencia real observada de combinaciones; el roster solo NO determina líneas confirmadas.
16. **Parejas defensivas:** D1–D3, lado, cobertura en slot, bloques, salidas de zona, duelos contra forecheck, cambios y parejas nuevas.
17. **Matchup forward line × defensive pair:** top line A vs pareja B bajo casa/visita y last change; reconocer que los cambios rompen emparejamientos.
18. **Skater × goalie:** tiradores más peligrosos vs perfil de paradas del portero, calidad de tiro, especialidad de PP y rebotes; BvG de muestra pequeña tiene peso bajo.
19. **Cara a cara centros/faceoffs:** FO%, zonas defensiva/ofensiva, draws especiales, salidas, posesión ganada y estilo; no inferir causalidad automática.
20. **Power play:** PP%, oportunidades/game, PP1/PP2, entradas y tiros, producción del primer grupo y matchups contra penalty kill rival.
21. **Penalty kill:** PK%, goles/ocasion, disciplina, estructura, clearing, short-handed threats, paradas del arquero en PK.
22. **Penalizaciones/árbitros:** minor/major, PIM, penalizaciones provocadas/recibidas, officials confirmados, tendencia por muestra; revisar reglamento de liga.
23. **Fatiga y viajes:** back-to-back, 3 en 4 noches, 4 en 6, distancia, husos horarios, portero que jugó ayer, turnos y TOI recientes.
24. **Lesiones y noticias:** reportes NHL/club, DTD, IR, probable/confirmed, morning skate, líneas, suspensiones, fecha y fuente; no tratar rumor como titular confirmado.
25. **Entrenador y rivalidades:** cambios de coach, estrategia forecheck, neutral-zone trap, cycle, tempo, zonas, cierre de períodos, vaciar portería, manejo de lead.
26. **Contexto estadio y calendario:** hielo/calidad, altura, sedes neutrales, fase regular/playoffs, playoff positioning/series; climatología exterior solo si evento al aire libre.
27. **Tercer período y empty-net:** frecuencia/condiciones en que se saca portero, gol de portería vacía, no asumir último período igual a los dos primeros.
28. **Escenarios narrados P1/P2/P3:** salida fuerte, presión, especial teams, goalie hot/cold, penalties, comeback, empate a 60, OT, shootout, sin asignar porcentajes inventados.
29. **Expertos/otras lecturas:** NHL.com, ESPN, Covers y otros con autor, fecha y argumento completo cuando disponible; contradicciones y posible dependencia entre fuentes.
30. **Mercados vigentes y reglas:** cotejar sportsbook + evento + selección + período + línea + precio fresco (ver §4). No agregar 60-min 3-way a 2-way OT/SO.
31. **Dictamen de Kira:** tesis, antítesis, portero confirmed/probable, 5v5, PP/PK, frescura, escenarios contrarios, qué invalida la tesis, market alternativo si existe, abstención y fuente.
32. **Auditoría:** snapshot antes del puck drop, alineaciones/portero y quote entonces, boxscore posterior, OT/shootout, reglas, errores/faltantes y aprendizaje por mercado.

## 3. Porteros, skaters y matrices de roles

La matriz NHL no es una tabla arbitraria 18×18 de cruces directos. Son **líneas ofensivas 1–4 vs parejas de defensas 1–3, con portero titular**, además de power-play unit 1/2 vs PK unit 1/2, faceoffs específicos y especialistas de shootout si aplican. Cada entidad tiene playerId, club vigente, posición, TOI y proporción de turnos demostrada por shift chart o líneas publicadas. Si esas fuentes faltan, solo se presentan **candidatos por posición**, no enfrentamientos confirmados.

**Porteros:** evaluar últimos 5/10 starts, carga de tiros, consistencia, rebounds, high-danger SV%, SV% en PP/PK, descanso, GSAx vs expectativas si existe fuente independiente; evitar confundir GAA bajo con más calidad individual cuando defensa restringe tiros. Para goalie saves props investigar tiros rival por 60, calidad, estilo defensa y riesgo de pulled goalie.
**Forwards:** G/A/P, SOG, SOG/60, shooting%, TOI, PP time, faceoffs de centros, Corsi/shot share 5v5, últimas cinco salidas, roles por línea. 
**Defense:** blocks, hits, shots, carry-outs, +/- contextual, penalty kill time, parejas defensivas, rival forwards; métricas observadas por fuente.
**Banquillo:** scratches, cambios y suplentes, definición por situación NHL.

## 4. Menú de mercados y liquidación

- **Moneyline 2-way NHL:** normalmente incluye OT + shootout para ganador, pero verificar términos del operador.
- **Regulation 3-way:** local/empate/visitante exactamente a los 60 min reglamentarios; el empate existe para este mercado.
- **Puck line ±1.5 y alternativos:** determinar si incluye OT/SO y cómo se refleja shootout decisive goal según casa.
- **Totals O/U 4.5/5/5.5/6/6.5/7+, team totals, P1/P2/P3, first 2 periods:** línea entera push cuando corresponda, half lines win/loss, OT/SO y reglas de cómputo según casa.
- **Props skaters:** goals, anytime goal scorer, assists, points, SOG, blocked shots, hits, faceoffs won, PP points, si cotizados con playerId y reglas DNP.
- **Props goalies:** saves, shots against, goals allowed, shutout, goalie win, cuando se publican; verificar uso parcial, pulled goalie y final stats.
- **Special teams:** PP goal, penalty minutes, power-play points si cotiza la casa.
- **First goal, score first, first period/no goal, period spread/totals y series markets:** reglas específicas y hora, no extrapolar del full-game.
- **Playoff series:** resultado del partido no iguala ganador de serie; en playoffs NHL empate a 60 lleva a períodos adicionales y no shootout.
- **Suspensión/abandonos, empty-net y shootout:** verificar reglas de liquidación antes de recomendar.
- **SOG vs shot attempts:** son métricas distintas; prop tiros a puerta no se liquida con todos los intentos.

La cotización **no es un pronóstico**. No declarar probabilidad/EV calibrado sin investigación histórica reproducible y prueba fuera de muestra. Se puede abstener en todos los mercados.

## 5. Experiencia de Kira y herramientas

Herramientas propuestas:
- \`sports_chat_hockey_slate\`: cartelera NHL por fecha, fixture original y estado de API.
- \`sports_chat_nhl_investigate\`: dossier con portero, skaters, líneas, PP/PK, clima contextual, noticias y cuotas verificadas.
- \`sports_chat_hockey_goalies\`: comparación explícita de porteros con starts, SV%, GAA, uso reciente y certificación de titular.
- \`sports_chat_hockey_players\`: ficha skater/goalie desde playerId comprobado y gamelog.
- \`sports_chat_hockey_market_review\`: mercado por identidad de evento, casa, línea, regla y contrapruebas.
- \`sports_chat_hockey_leagues\`: descubrimiento internacional verificable y cobertura por competición.
- \`sports_chat_hockey_audit\`: replay pregame y seguimiento posterior.

**Interfaz:** fondo claro, tarjetas compactas, pequeños logos, resumen + tabs goalie/battle of lines/5v5/PP&PK/health/schedule/media/market/hypotheses, noticias en español con atribución, estados «sin datos» vs «0» separados, páginas de atletas con presupuesto. No 30 paneles gigantes.

## 6. Contrato multideporte

\`HockeyResearchedOpportunityV1\`: \`sport='hockey'\`, \`league\`, \`season\`, \`gameId\`, \`eventIdESPN?\`, homeId/awayId, schedule, goalies:{home,away,confirmation}, keySkaters, lineGroups[], defensivePairs[], form, specialTeams, rest, injuries, evidence[], contradictions[], unknowns[], marketFamily, period, playerId?, bookmaker, quoteId, point, decimalOdds, updatedAt, settlementRules, correlationKeys[], decision (investigate|candidate|abstain), eligibleForTicket:false hasta validar, probability?:solo si calibrada con método/documento reproducible.

La selección para ticket de 5/6 patas no debe forzarse. Múltiples legs del mismo encuentro o mercado dependen de estados y correlaciones. No mezclar cuotas de varias casas ni ofrecer SGP si la casa no lo admite.

## 7. Hitos operativos con pruebas

**H0** plan NHL+mundo documentado, con fuentes/limitaciones.
**H1** fixture NHL por fecha e ID oficial, cruce con ESPN, season playoffs; tests error/fecha/evento inexistente.
**H2** roster por club, stats por skater/goalie, player landing/last5; usar IDs y datos observados.
**H3** investigar porteros y su estatus probable/confirmado, SV% GAA starts, noticia y fuente; prohibir confirmación a partir de roster.
**H4** 5v5 por club, PP/PK y cambios por línea/pareja; shift charts y xG donde se autoricen.
**H5** forma local/visita, calendario, fatigue, lesión y noticias/coach; endpoints con TTL.
**H6** research matchups line×pair y goalie×shooters con evidencia por situación, sin líneas ficticias.
**H7** cuotas reales con house+fecha+market+period y settlement 60min/OT/SO/player props; pruebas 3-way vs ML y push.
**H8** integración con Kira UI/chat compacto y generador mixto 5/6-patas sin forzar.
**H9** prueba real de al menos 1 NHL regular season y 1 playoff + fallo de fuentes + muestra internacional, fuentes independientes.
**H10** snapshots históricos y replay (antes de juego), errores por escenario/mercado, validación predictiva si se usa P(win).
**H11** revisión CI integradora, sync main/stable con SHA iguales, sin falsear checks.

**Criterios irrenunciables:** fixture id verificado; goalies no confirmados por roster; skaters correctos; shots/blocked attempts separados; PP/PK no confundidos; lineups no inventados; 60 vs OT/SO bien liquidados; NHL playoffs sin SO; odds frescas y coincidentes; TTL; pruebas aisladas y caso real; cobertura internacional no fingida; no afirmar «completo» hasta H0-H11.

## 8. Referencias

- NHL Web API no oficial (documentación comunitaria): https://github.com/pseudo-r/Public-NHL-API
- API endpoints NHL públicos: https://api-web.nhle.com/v1/score/now
- NHL EDGE oficial: https://www.nhl.com/edge
- IIHF rulebook oficial: https://www.iihf.com/en/statichub/4719/rules-and-regulations
- API oficial NHL Stats: https://api.nhle.com/stats/rest/en/team
- PHOENIX sports.ts autoriza actualmente \`api-web.nhle.com\` y \`icehockey_nhl\`, con adaptador de odds ya existente.


## 9. Primera implementación funcional del especialista NHL en este PR

- \`nhl-evidence-research.ts\` ya consulta la cartelera NHL oficial por fecha, solo acepta un \`gameId\` que aparezca en ella y que continúe en estado FUT/PRE con hora futura; identifica equipos, rosters de forwards, defensa y goalies; llama al perfil oficial por ID de skater/goalie en un presupuesto de solicitudes acotado; extrae las métricas y últimos cinco juegos que realmente aparecen, tabla NHL y los últimos diez resultados de cada club con descanso/localía cuando el calendario responde. Cruza tiradores potenciales con todos los porteros candidatos del equipo contrario **SIN afirmar starter confirmado**. Etiqueta evidencia ausente y se abstiene de recomendar picks.
- \`nhl-market-settlement.ts\` diferencia explícitamente **regulation 3-way** del ganador que incluye OT/SO, evalúa puck line y totales con período declarado, deja pendientes resultados no oficiales y obliga a verificar el ruleset de cada casa. No implementa todos los props skater/goalie.
- \`index.ts\` registra \`sports_chat_hockey_slate\` y \`sports_chat_nhl_investigate\`. Las cuotas observadas son de \`icehockey_nhl\` y se concilian por fecha, equipos y timestamp; ningún mercado se convierte en aprobado de manera automática.
- \`tests/nhl-evidence-research.test.mjs\` cubre IDs correctos, roster/goalies con no-confirmación, forma por temporada sin mirar juegos futuros, cuotas válidas y caducadas, fallos de fuente, juego empezado, empate 60 minutos/OT/SO, totales, líneas y push; workflow propio ejecuta pruebas Node24 y TypeScript host.

**Lo que este PR NO entrega todavía**: cobertura completa de AHL/KHL/IIHF/PWHL; porteros titulares confirmados en tiempo real; validación de líneas ofensivas y defensivas mediante shifts; análisis real de PP/PK y 5v5 xG/GSAx con fuentes autorizadas; injury report oficial y contraste de picks completos; props SOG/saves/hits/blocks plenamente cotejados por libro; optimizador de tickets mixtos y auditoría cronológica. **No confundir un expediente real básico con el cierre de H0–H11**. Se fusionará solo tras verificaciones pertinentes y podrán iniciarse las pruebas en PHOENIX; las etapas profundas requerirán iteraciones adicionales.
