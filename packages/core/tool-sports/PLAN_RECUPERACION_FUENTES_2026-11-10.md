# Plan verificable de recuperación de fuentes — PHOENIX Sports

**Corte y evidencia:** auditoría de 119 respuestas HTTP reales del 10-11-2026. Ver [matriz HTTP](ENDPOINT_AUDIT_REAL_2026-11-10.md) y [ejecución Actions](https://github.com/arisnachy/phoenix-harnes/actions/runs/42808292764).

## Regla de arquitectura

**Fallo de adquisición ≠ jugador sano, equipo débil, mercado inexistente ni selección fallida.** Un candidato nunca pierde puntuación deportiva por timeout o una API con esquema diferente. Para cada paso obligatorio, registrar (1) partido/IDs exactos, (2) proveedor y ruta efectivamente llamada, (3) estado HTTP, (4) datos parseados con valor y sello temporal, (5) identidad y fecha verificadas, (6) fallback efectivamente intentado, (7) conflicto o incertidumbre residual. Los tiempos de petición y actualización del proveedor son distintos. La lista de respaldos NO certifica que funcionen: necesita prueba viva.

## Checklist NBA/WNBA — adquisición por partido

| Paso | Fuente primaria probada | Respaldo | Dato esperado | Evidencia de prueba |
|---|---|---|---|---|
| Partido e IDs | ESPN Site basketball/{liga}/scoreboard?dates=YYYYMMDD | ESPN summary?event={id} | evento, hora, nombres, localía, IDs | NBA 6 juegos, HTTP200 |
| Historial 5-10 y local/visita | scoreboards ESPN por fechas sueltas | ESPN lastFiveGames en summary | fecha, resultado, margen, descanso | Scoreboards históricos NBA HTTP200; 5-10 juegos/club por cotejar |
| Rosters | ESPN Site teams/{id}/roster | ESPN summary boxscore | IDs individuales y posición | HTTP200 con jugadores |
| Estadísticas | ESPN Site teams/{id}/statistics.results | ESPN Common v3 athletes/{id}/stats | ORtg, DRtg, pace, TS%, rebote, pérdidas cuando existan | `results.stats` HTTP200; extracción reparada |
| Forma individual/splits | ESPN Common v3 athletes/{id}/gamelog y /splits | ESPN summary leaders | últimas salidas y local/visita | HTTP200, `events/seasonTypes` y `splitCategories` observados |
| Lesiones | ESPN Site basketball/{liga}/injuries (liga) | **NBA** índice oficial y PDF horario; summary injuries | atletas, estatus, fecha individual y del feed | NBA 29, WNBA 14 grupos; ruta /teams/{id}/injuries dio [] |
| Quintetos y minutos | ESPN summary/boxscore cuando confirmados | reporte oficial de partido/equipo | cinco jugadores reales por lado, minutos/restricciones | **No completamente probado** |
| Cuotas | ESPN Core event/competitions/{id}/odds -> items[].$ref | ESPN scoreboard odds, summary/pickcenter, proveedor externo permitido | precio por lado, casa, mercado, open/current, fecha | DraftKings NBA -1100/+700; sin lastUpdated |
| Noticias | ESPN Site news?limit=8 | editoriales atribuidas | enlace, fecha y fotografía vinculada al rival | HTTP200 8 artículos en muestra |

## Checklist NFL

Evento ESPN NFL (scoreboard), forma últimos 3-5 encuentros, roster y profundidad de ambos equipos, QB realmente titular, OL/pass rush, lesiones de liga ESPN (**32 equipos reportados**), parte final de inactivos NFL (pendiente de prueba exacta), estadio/meteorología Open-Meteo, moneyline/spread/total ESPN Core (**probado**) y noticias ESPN. Mostrar cada verificación y problemas de calendario semanal.

## Checklist NHL

ESPN NHL scoreboard (**7 partidos**) + `api-web.nhle.com/v1/score/{YYYY-MM-DD}`; roster, portero titular (no aceptar candidato como confirmado), GSAx/xG 5v5 (fuente específica **pendiente de prueba**), PP/PK, descanso, lesiones ESPN NHL (**31 grupos**) y scratches, cuotas Core NHL (**+130/-155** observadas en muestra) con comparación de mercado 60 min frente a OT/SO, clima no aplicable cuando es arena cubierta.

## Checklist MLB

ESPN MLB scoreboard (en temporada; 0 hoy no significa falla), `statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher`, rosters MLB Stats, lineups, pitcher vs bateador y muestra, bullpen últimos 3 días, parque/viento/techo, lesiones ESPN MLB (**30 grupos**), cuotas MLB Core/ESPN y verificación por casa. En noviembre se usan encuentros de muestra histórica, no fingir cartelera actual. Bullpen y BvP a nivel partido **pendientes de cierre integral**.

## Checklist fútbol global

ESPN soccer/{liga}/scoreboard; plantillas y H2H; forma 5-10, casa/fuera; partido resumen; xG/xGA con proveedor concreto (**no verificado universalmente**), bajas/sanciones por liga/club, once probable versus confirmado, descanso y viajes; 1X2 incluyendo empate, doble oportunidad solo si cotizada. La Premier inglesa respondió scoreboard histórico y Core odds con precios **-125/+320**, pero Common v3 player stats retornó **404** para atletas de muestra: hay que usar respaldo por liga y no afirmar 'sin estadísticas'. Verificar cada liga por separado.

## Checklist tenis ATP/WTA

Cartelera real del circuito; ranking y perfiles; superficie; 5-10 partidos recientes por superficie; servicio/retorno/hold/break; H2H; fatiga/viajes; indisponibilidad; moneyline, sets y juegos con precio exacto. **No probados aquí** resultados de ATP/WTA: no marcar cobertura confirmada hasta ejecución por torneo y atleta.

## Política del motor y UI

1. Escanear cartelera del día y cotejar evento, ambos equipos, fecha y hora RD/UTC.
2. Para cada candidato crear checklist de deporte *vacío*. Llamar primario, validar esquema y datos; en fallo/empty ejecutar fallback por prioridad.
3. Registrar cada estadística con valor, unidad, período, hora fuente y partido. Mostrar inmediatamente en el progreso de investigación si la arquitectura permite emisiones parciales; al final exhibir el checklist íntegro con hechos.
4. En lesiones identificar bajas **propias y del rival** y estimar impacto de minutos/uso solo cuando estadísticas compatibles existan, nunca sustituir un parte de juego con roster.
5. Citar los precios ESPN Core como **observaciones verificadas de proveedor**, distinguiendo fecha de consulta de `lastUpdated`; no declarar aceptación de Juancito ni cambiar de bookmaker silenciosamente.
6. Elegir en función del desempeño + lesiones confirmadas + emparejamientos, no por cuota sola ni por número de pasos que una API dejó vacíos.
7. Al final del ticket mostrar explicación Kira por pata, motivos, contraargumentos, estadísticas, noticias/imágenes atribuidas, fuentes efectivamente llamadas, odds y evaluación posterior.
8. Backtest sin leakage temporal (nunca datos que se publicaron luego del inicio); comparar baselines y calibración fuera de muestra, no asignar 90% sin validación.

## Criterios de aceptación (antes de considerar concluido)

- [x] Matriz real individual 119 URL con código HTTP y esquema.
- [x] Evidencia real de lesiones ESPN NBA/WNBA/NFL/MLB/NHL.
- [x] ESPN Core odds colección y detalle real, precio con proveedor.
- [x] Corrección league-first lesiones; fuente vacía de equipo no se interpreta como sana.
- [x] Corregir rutas de extracción `statistics.results`, `depthchart`, `splitCategories`.
- [x] Checklist por paso y fuentes mostrado en contrato UI.
- [ ] Validación CI sin regresiones, incluida ejecución REAL de los tres adaptadores.
- [ ] Integración automática probada del PDF oficial NBA con reconciliación de nombre/partido/fecha.
- [ ] Cerrar fuentes de starters, xG, bullpen/BvP, inactivos NFL, tenis y cobertura por liga con muestras reales.
- [ ] Replay de ticket completo de 5/6 patas, con todos los expedientes y citas trazables.
- [ ] Revisión histórica con resultados finales y calibración (sin fuga de datos).

La etiqueta `[x]` significa código/ensayo implementado y observado en esta rama; NO significa validación completa ni despliegue a main/stable.
