# PHOENIX Sports — postmortem del boleto del 15-nov-2026 (RD)

## Resultado observable y fecha de corte

**3/5 acertadas; combinada perdida.** No se realizaron apuestas desde el motor. Las cinco cuotas son las que aportó el usuario: son observaciones reportadas de ESPN/DraftKings, no una reconstrucción de las cotizaciones aceptadas por un operador.

| Evento | Selección | Cuota | Estimación exploratoria no calibrada | Resultado oficial | Estado |
|---|---|---:|---:|---|---|
| DAL@BOS | Boston | 1.10309 | 59% | Boston 131–94 Dallas | Acierta |
| HOU@WAS | Houston | 1.28986 | 62.5% | Houston 147–119 Washington | Acierta |
| EDM@PHI | Edmonton | 1.67568 | 60% | Edmonton 5–2 Philadelphia | Acierta |
| NSH@SJS | Nashville | 1.58824 | 68.6% | San Jose 4–2 Nashville | Falla |
| VAN@VGK | Vegas | 1.24390 | 65.1% | Vancouver 6–3 Vegas | Falla |

**Separación temporal obligatoria:** PRE = dato publicado antes de iniciar el evento. POST = marcador e información que solo se conoce después. Nunca permitir que la sección POST influya en una decisión retrospectiva presentada como prepartido.

## Datos PRE que PHOENIX omitió o no contrastó

- **Boston/Dallas:** el parte NBA del 15-nov a 1:00 p. m. ET ya marcaba a Kyrie Irving questionable, a Dereck Lively II out, Gafford probable; Dallas jugó el día anterior en Cleveland. Fuente original con fecha: https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-15_01_00PM.pdf y previa de Boston Globe https://www.bostonglobe.com/2026/11/15/sports/celtics-mavericks-preview-for-november-15-2026/ . **No** afirmar que Irving estaba confirmado out a la 1:00 p. m.; eso se resolvió más tarde.
- **Houston/Washington:** el parte oficial de las 3:00 p. m. ET señalaba VanVleet y Capela out, Adams available; Washington tenía a Tre Johnson questionable. Fuente: https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-15_03_00PM.pdf . Ratings netos previos (+9.1 HOU, −5.5 WAS) en https://readthegame.com/today?date=2026-11-15&season=2026-27 .
- **Edmonton/Philadelphia:** NHL.com identificó Jarry y Vladar como porteros probables y ambos equipos jugando en noches consecutivas. Probable NO es confirmado. Fuente 15-nov: https://www.nhl.com/news/edmonton-oilers-philadelphia-flyers-game-preview-november-15-2026 .
- **Nashville/San Jose:** el resumen previo de AP separaba los últimos diez 8-1-1 vs 3-6-1; 8–2 y 3–7 ocultan el resultado en prórroga/shootout. San Jose había ganado el H2H anterior 3–2 en shootout. Marchessault estaba lesionado, Saros probable y Nedeljkovic proyectado; la última visita Nashville–Vegas requirió 40 atajadas de Saros. Fuentes: https://www.foxsports.com/articles/nhl/predators-bring-win-streak-into-matchup-with-the-sharks y https://www.nhl.com/news/nashville-predators-san-jose-sharks-game-preview-november-15-2026 y https://www.nhl.com/predators/news/topic/game-previews/game-day-preds-at-sharks-november-15-2026-11-15 .
- **Vegas/Vancouver:** exigencia de 80.39% de aciertos según cuota. El dato histórico exploratorio 65.1% no es validado: diferencia de 15.29 puntos. NHL.com proyectaba Carter Hart/Adin Hill por Vegas y Lankinen/Meriläinen por Vancouver, con Hanifin lesionado en Vegas y Thatcher Demko fuera en Vancouver. Chytil formaba parte de la línea ofensiva rival. Fuente: https://www.nhl.com/goldenknights/news/vancouver-canucks-vegas-golden-knights-game-preview-november-15-2026 .

## Información POST (nunca usar como señal previa)

- Boston 131–94: https://www.nba.com/game/dal-vs-bos-0022600240
- Houston 147–119: https://www.nba.com/game/hou-vs-was-0022600242/blueprint
- Edmonton 5–2: https://www.nhl.com/news/edmonton-oilers-philadelphia-flyers-game-recap-november-15-2026
- Nashville 2–4: Celebrini y Smith sumaron tres puntos cada uno, Nedeljkovic hizo 32 paradas: https://www.nhl.com/news/nashville-predators-san-jose-sharks-game-recap-november-15-2026
- Vegas 3–6: Chytil dos goles, Meriläinen 34 paradas: https://www.cbssports.com/nhl/gametracker/recap/NHL_20261115_VAN%40LV/

## Fallos y criterios de corrección

1. **Comparar la cuota con la estimación, sin confundirlas:** equilibrio por 1/cuota es 90.65% BOS, 77.53% HOU, 59.68% EDM, 62.96% NSH, 80.39% VGK. Proyecciones históricas del usuario: 59, 62.5, 60, 68.6 y 65.1. Diferencias grandes generan revisión de alternativas, NO un EV negativo científicamente demostrado.
2. **No usar «últimos 10» como única señal:** para NHL comparar ventanas de 3/5/10, partidos reglamentarios vs OT/SO, defensa, juego especial y nivel del rival. El repunte de un oponente con 2 de las 3 últimas victorias aunque tenga hasta 4 de 10 debe iniciar una verificación adicional, como regla heurística por validar, no exclusión calibrada.
3. **Porteros, bajas y cinco titulares:** recoger publicaciones PRE con URL, edición/hora, estatus y event IDs. Un probable o candidato no es un confirmado. No tomar un 200 vacío como equipo sano ni un jugador del roster como titular.
4. **Comparar y reemplazar:** si hay discrepancia >=5 puntos entre p exploratoria y equilibrio, precio de equilibrio >=80%, o porteros NHL no confirmados, mostrar `alternativeReviewRequired`; cotejar las reservas con precio de la MISMA casa antes de cerrar el ticket. Si no hay alternativas con cuota auténtica, informar el hueco sin inventarlas.
5. **Evitar sesgo retrospectivo:** no declarar una alternativa «mejor» por haber ganado ayer sin contar con precio, alineación y snapshot prepartido. Antes de cambiar umbrales comprobar Brier/log-loss, CLV, retornos por deciles y cobertura en varios meses *out-of-sample*.

## Pruebas de regresión

- Cinco precios/estimaciones del 15-nov deben disparar revisión de Boston, Houston y Vegas, no convertir estas estimaciones en EV.
- Simulación NHL de favorito de 8–1–1 frente a rival con forma global mala y 2/3 victorias recientes debe quedar como `uncertain`; mismo histórico pero sin repunte no debe activar la alerta.
- Precios ESPN observados se aceptan con coincidencia exacta; otra API opcional caída no invalida el partido ni la cuota ESPN.
- El estado final siempre distingue `priced`, `researchStatus`, `approvedForBetting:false`, `placed:false` y resultado real POST.

**Límite:** un boleto de cinco selecciones tiene probabilidad conjunta de fallar aunque cada favorito sea sólido. Este postmortem señala observaciones y errores evitables de presentación/selección; no prueba que cualquier sustitución concreta habría ganado.
