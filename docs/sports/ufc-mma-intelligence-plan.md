# PHOENIX UFC/MMA Intelligence — plan maestro por peleador y combate

**2026-11-02 · etapa de especificación previa al desarrollo.** El propósito es investigar cada pelea como experto en MMA; no inferir victorias de los récords, no inventar PPV, resultado, método, cuotas ni lesiones. Separar UFC de PFL, boxing, kickboxing y MMA amateur.

## 28 etapas de investigación

1. Consultar \`mma/ufc/scoreboard?dates=YYYYMMDD\`; \`eventId\`, cartelera, estado y hora real del evento, no inventar comienzo exacto del combate si solo existe comienzo de la velada.
2. Cada combate mediante \`competitionId\` y dos \`athleteId\` explícitos (no confundir ID de competidor con athlete ID).
3. Prelims/main card, orden de peleas y cambios. Sólo clasificar si la fuente lo identifica.
4. Categoría peso, división femenina/masculina, título y reglas específicas 3/5 asaltos; no inferir por evento.
5. Identidad y récord oficial por pelea (victorias, derrotas, empates y no contests).
6. Altura, alcance, stance y lateralidad de ambas personas cuando el proveedor las ofrece.
7. Últimas 3–5 peleas con rivales, divisiones, métodos, asaltos, finalización y fechas observadas.
8. Tiempo desde última pelea, fatiga/recuperación e historial de short notice verificable.
9. Golpes significativos conectados por minuto (SLpM) y recibidos (SApM), volumen y definición estadística.
10. Accuracy/defense del striking, guardia, counters y puntos débiles.
11. Potencia y knockdowns, knockdown rate y muestras, sin convertir KO pasados en KO futuro.
12. Takedowns intentados/conseguidos por 15 min, TD accuracy/defense.
13. Sumisiones intentadas, control de suelo y tiempo de control observables.
14. BJJ/wrestling/clinch/ground-and-pound, efectividad histórica contra rivales similares.
15. Estilos ortodoxo vs zurdo, distancia y rango; evaluar quién presiona, contragolpea, derriba y puede mantener combate de pie.
16. Estadísticas frente a estilo comparable; desagregar peso, años, ronda, oponente y decisión.
17. Cardio por asaltos, velocidad de caída en volumen/accuracy, rendimiento a 3 o 5 asaltos cuando la fuente provee datos.
18. Corner/camp, entrenador, cambio de team y viajes solo con fuente y fecha.
19. Pesaje oficial de ambos, fallo de peso y efectos en reglas; no inferir deshidratación clínica.
20. Lesiones/rehabilitación, sustituciones de oponente y cambios de fecha únicamente cuando se documenten.
21. Árbitro, comisión atlética, fouls, deducciones, decisión dividida, no contest y ruleset oficial.
22. Confrontación técnica: striking A vs defensa de golpeo B, lucha A vs antiwrestling B, clinch A vs B y transiciones a submissions.
23. Escenarios por round, decisión vs finish, ritmo, posibilidad de scrambles, cortes y penalizaciones; hechos favorables/contrarios.
24. Fuentes: ESPN Site/Core, ficha UFC oficial (fight stats y octagon), perfil UFCStats autorizado, reportes oficiales de comisiones, noticias identificables y analistas con autor/fecha.
25. Mercados auténticos por **la misma pelea**: moneyline, método KO/TKO/submission/decision, round totals, fight goes distance, ganador por round si casa cotiza; no usar MMA genérico para pelea de otra promoción.
26. Cotejar bookmaker, fightId/competitorId, athleteId, timestamp y period; reglas de empate, no contest, cancelación, DQ y retirada; nunca declarar apuesta aprobada sin comprobante.
27. Síntesis de Kira: argumentos a favor y en contra de cada peleador/mercado, limitaciones y decisión \`investigate | abstain\`, sin win% o EV inventados.
28. Snapshot prematch y replay postfight con metodologías de liquidación, precisión factual, fallos y resultados por mercado; historial cronológico sin datos futuros.

## Contrato de datos
\`UfcBoutV1\`: eventId, competitionId, fightStartUtc? (null si no verificado), eventStartUtc, arena, boutOrder?, formatRoundCount?, division?, titleFight?, [athleteId, fighterName, stance?, rank?, last3?, strikeStats?, grapplingStats?, weightVerified?, availability?]×2, bettingMarkets[], unavailableFacts[], sourceObservations[], fitEvidence[], opposingEvidence[], status.

## Implementación por etapas
**U0** documento; **U1** calendario y validación de competencia/atletas; **U2** perfil por atleta, récord y estadísticas reales; **U3** estilo vs estilo y pesos/lesiones verificadas; **U4** análisis por rounds, 3/5 y métricas contrastadas; **U5** mercado y settlement por método/round/no contest; **U6** Kira tool + tarjeta compacta; **U7** pruebas deterministas + verificación real UFC, fail closed; **U8** evaluación histórica; **U9** integración main/stable verificada.

No afirmar U0–U9 completos por plan. Por integridad, la identidad del deportista procede de \`competitors[].athlete.id\`, no de \`competitors[].id\` (que puede ser ID de participación). Si solo se conoce la hora de inicio del evento, el motor no asignará esa hora a una pelea individual ni cotejará cuotas como frescas contra un kickoff inventado.

## Fuentes técnicas por verificar en implementación
- ESPN UFC scoreboard: https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard
- ESPN MMA Core: https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events
- UFC Stats oficial: http://ufcstats.com/statistics/events/completed?page=all
- UFC oficial: https://www.ufc.com/events
- Sportsbook autorizado y reglas por evento: The Odds API usa generalmente \`mma_mixed_martial_arts\` para MMA global (NO significa una liga UFC verificada); conciliar ambos peleadores, evento y organización con fuente independiente.

Las fuentes ESPN son públicas pero no tienen contrato permanente. No eludir autenticación, restricciones de acceso ni inventar información de fuentes caídas.
