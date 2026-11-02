# PHOENIX Baseball Intelligence — plan maestro por disciplina

**Fase actual:** diseño técnico y primera base matemática exploratoria. **No es un predictor calibrado ni un ticket ganador.**

## Objetivo

Kira coordina una investigación reproducible como la de un analista de béisbol: cartelera global → filtros por equipos → evaluación individual de todo el roster → confrontaciones vs abridor y cada relevista → simulación turno por turno → probabilidades por mercado → cruce con cuotas de la casa → selección conjunta de tickets de 5–6 patas.

El sistema debe admitir MLB, KBO, NPB, LIDOM, LMB y otras ligas **según cobertura verificada de cada fuente**, con reglas, tamaños de muestra y modelos calibrados por liga. La arquitectura será mundial, pero la validación comienza por MLB.

## Expediente por partido — 14 investigaciones sucesivas

1. **Cartelera:** descubrir todos los encuentros futuros, ligas, temporadas, sedes, fechas, estatus, lanzadores anunciados y reglas específicas de cada competición. Nunca transformar partidos comenzados en candidatos prepartido.
2. **Primer filtro de equipos:** récord, forma últimos 5/10/20, carreras a favor/en contra, calidad del rival, rachas, series, descanso, días consecutivos, localía y rendimiento fuera de casa. Filtrar antes de investigar en profundidad.
3. **Estadios:** dimensiones de jardines, altitud, orientación, superficie, techo, factores por temporada para HR/hits/carreras, historial de local/visitante en ese parque, fiabilidad y ajuste por adversarios.
4. **Clima:** viento en dirección relativa al campo, temperatura, humedad, lluvia, cambios previstos durante el juego, riesgo de interrupción y techo abierto/cerrado. No usar el viento exterior como efecto directo si el techo está cerrado.
5. **Lanzador abridor:** oficial/probable, mano, ERA, FIP/xFIP, WHIP, K%, BB%, K/9, HR/9, roletazos, repertorio y velocidad, últimas cinco aperturas, lanzamientos, descanso, splits contra zurdos/derechos, fortalezas frente a tipo de bateador y contexto del parque.
6. **Bullpen:** disponibles y lesionados, relevistas principales/cerradores, K%, BB%, ERA/FIP, splits de mano, lanzamientos y apariciones últimos 1–3 días, fatiga, funciones de los relevistas y escenarios de cambios durante las entradas.
7. **Roster y titulares:** vincular cada jugador con ID actual de equipo, cambios de plantilla y estado de alineación confirmado/probable. Para los 9 bateadores, suplentes y posibles emergentes: PA, AVG, OBP, SLG, OPS, wOBA/wRC+ o equivalentes disponibles, ISO, BB%, K%, BABIP, contacto, hard-hit/barrel, robos, últimos 7/15/30 juegos, splits por mano, estadio, localía y adversario.
8. **Matriz completa bateador × pitchers:** comparar **cada bateador vs abridor rival** y **cada bateador vs cada relevista que podría enfrentar**. Incluir BvP, historial de pitcheos, repertorio, zonas, velocidad, tasas de swing/whiff/contacto, afinidad vs lanzamiento cuando fuentes lo permitan. Controlar muestras pequeñas con regularización/shrinkage y mostrar intervalos; 5 turnos históricos no justifican un pronóstico fuerte. Construir una matriz por tramo del juego porque cambian pitchers y orden al bate.
9. **Defensa y bases:** receptor, defensa por posiciones, outs de campo, errores, framing si está disponible, dobles matanzas, robos, velocidad, suplencias, estrategia y manager. No extrapolar estadísticas MLB avanzadas inexistentes en otras ligas.
10. **Noticias, lesiones y expertos:** verificación oficial de lesiones, estrellas confirmadas, alineaciones, cambios de pitcher, viajes; referencias públicas ESPN/Covers/VegasInsider/OddsPortal y otras con fecha y fuente. Separar predicción propia, opinión de experto y precio implícito de mercado; un enlace de catálogo NO demuestra investigación real.
11. **Simulación integral inning-by-inning:** derivar probabilidades de resultado de cada aparición al plato (ponche, BB/HBP, out en juego, sencillo, doble, triple, HR y otros según fuente), condicionadas por bateador, pitcher, estadio, clima y defensa. Simular bases, outs, carreras, orden al bate, avance/robos/dobles jugadas, cambios del abridor por fatiga/pitch count, bullpen, emergentes, entradas 1–9 y extra innings conforme a reglas de la liga; no jugar la baja de la novena si el local ya va delante. Usar Monte Carlo con semilla reproducible, incertidumbre de parámetros y control del error de muestreo. **Los resultados de un mismo recorrido simulado deben alimentar simultáneamente total, diferencia, F3/F5, ponches de pitchers, hits/HR/bases totales de bateadores y demás props**, para preservar correlación.
12. **Predicción y validación:** producir distribuciones de carreras y diferencia para F3/F5/FT, probabilidad de ganador/empate según regla, totales, run line ±1.5/2.5, K de pitcher y props verificables. Walk-forward por liga, temporada y mercado; Brier, log-loss, ECE, calibración por bandas, intervalos, MAE de carreras, baseline y comparación con cuotas históricas observadas en su momento. No usar datos de después del primer lanzamiento.
13. **Cuotas y liquidación exacta:** emparejar fuente, casa, evento, selección, jugador, línea, período, cuotas, timestamp y reglas. Comparar precio y modelo mediante P(ganar), P(push), P(perder) y EV. Ej.: con media de **9 carreras** y línea **8**, el over **no está aprobado automáticamente**: hay probabilidad de 8 carreras (push, sujeto a casa), 9+ (ganar) y 0–7 (perder). No atribuir vigencia a históricos ni usar líneas de cuarto sin liquidación parcial implementada.
14. **Auditoría y aprendizaje:** guardar inputs prepartido, versión del modelo, resultados simulados, probabilidades, cotizaciones, razones de selección y disponibilidad; después evaluar la liquidación oficial. Identificar errores del roster, abridor, bullpen, estadio, clima, incertidumbre y pricing. Solo promover nuevos modelos cuando mejoren fuera de muestra.

## Contrato de resultados para especialistas de todos los deportes

Cada selección debe producir **OpportunityV1**:
- Identificación: `sport, league, eventId, scheduledAt, teamIds, playerIds?, sourceIds`.
- Evidencia: `modelVersion, ruleSetVersion, observations, dataCoverage, sampleSize, confidenceInterval, calibrated, validationPeriod`.
- Mercado: `bookmaker, quoteId, marketFamily, period, line, selection, decimalOdds, updatedAt, observedAt`.
- Predicción: `pWin, pPush, pLoss, expectedNetReturnPerUnit, uncertainty, risks, simulationId`.
- Correlación: `sharedRiskKeys` (mismo partido/equipo/pitcher/serie/clima), `eligibleForTicket`, `ineligibleReasons`.

Los especialistas de fútbol, NBA, NFL, NHL y tenis reutilizarán **este contrato**, no la fórmula de carreras del béisbol. El código que selecciona tickets no debe volver a usar una heurística independiente de la probabilidad especializada.

## Optimizador de combinadas de 5 y 6 patas

1. Fusionar oportunidades elegibles de todas las disciplinas con cuotas verificadas y reglas conocidas; distinguir cada casa.
2. Estimar **probabilidad conjunta** a partir de escenarios/correlaciones, no multiplicar ciegamente P individuales. Los mercados del mismo juego requieren cuota especial aceptada por el operador; no crear SGP sintética.
3. Ofrecer **frontera de Pareto** entre probabilidad de acertar el ticket, EV, riesgo y posible ganancia; comparar 5 contra 6 patas en vez de suponer que más patas son mejores. Más retorno bruto no equivale a mayor probabilidad ni mayor EV.
4. Exigir la **misma casa** que realmente cotiza el ticket y comprobar cada mercado, momento, reglas, push/void y restricciones comerciales.
5. No forzar 5/6 piernas cuando faltan modelos validados o precios vigentes: comunicar borrador incompleto y motivos. No colocar apuestas ni afirmar ganancias garantizadas.

## Entregas incrementales

- **M0 — Primera base disponible en esta rama:** `src/baseball-market-probability.ts` calcula un baseline Poisson para total, total de equipo y run line F3/F5/FT, con pushes de línea entera, EV neto y prohibición expresa de promoverse a ticket (`calibrated=false`, `eligibleForTicket=false`). Pruebas unitarias en `tests/baseball-market-probability.test.mjs`.
- **M1 — Datos/identidad:** calendario global por liga, MLB como primer adaptador completo; roster, ID de cada atleta, pitcher, bullpen, parque, clima y fuentes con sello temporal. Prueba de expediente de un partido MLB con faltantes explícitos.
- **M2 — Matchups individuales:** matriz 9 bateadores × abridor + 9 × relevistas; splits, repertorio, recencia, estabilidad estadística, lesiones y lineups; pruebas de IDs, temporada y muestra.
- **M3 — Simulación:** base/out/inning state machine, PAs, cambios de pitcher, lineups y extras/reglas de cada liga, escenarios correlacionados, seeding y error Monte Carlo; fixtures de juegos reales.
- **M4 — Calibración y mercado:** validación walk-forward y comparación mercado vs predicción para líneas exactas, pushes, F3/F5/FT, run lines, ponches/hits y props disponibles; promoción exclusivamente si supera métricas.
- **M5 — Combinadas globales:** `OpportunityV1` de béisbol y otros especialistas, optimización multicriterio, dependencias, 5/6 patas reales, estado incompleto cuando aplique.
- **M6 — UI compacta en español:** cartelera → shortlist → expediente por partido → comparación bateador/pitcher/bullpen → simulación → mercados → ticket, con fuente, fecha, incertidumbre y explicaciones. Recalcular si cambian las alineaciones o el pitcher.

### Guardarraíles de ingeniería

Sin manipular tasas para que salgan recomendaciones, sin cuotas inventadas, sin acceder a datos no autorizados, sin pronósticos de jugadores sin ID de roster confirmado, sin mezclar periodos y sin promesa de ticket ganador. La primera pieza **no utiliza datos reales ni está integrada al flujo productivo**: es exclusivamente el cálculo base para integrar cuando el simulador especializado quede validado.
