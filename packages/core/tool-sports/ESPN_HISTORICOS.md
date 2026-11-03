# ESPN Site/Core: manual operativo de Kira (español)

Estas rutas son **no oficiales** y pueden cambiar, devolver HTTP 403/404 o conservar únicamente mercados antiguos. Un HTTP 200 con count>0 indica datos, no cuotas actualmente negociables.

## Variables y método

Site: https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}

Core: https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}

Deportes habituales: baseball/mlb, basketball/nba, football/nfl, hockey/nhl, soccer/eng.1. Hay ligas adicionales pero no se debe suponer cobertura de cuotas.

| Endpoint | Propósito | Uso histórico |
|---|---|---|
| Site scoreboard?dates=YYYYMMDD | events[].id, competitions[].id, partidos y posibles odds[] | Por día; el precio puede faltar |
| Site summary?event={eventId} | odds y pickcenter, resumen del juego | A veces conserva cuotas anteriores |
| Core events/{eventId}/competitions/{competitionId}/odds | Colección y proveedores reales; items pueden ser objetos o referencias | Conserva datos de algunos partidos |
| Core .../odds/{providerId} | Oferta de un proveedor concreto | No garantiza fecha o precio de cierre |
| Core .../odds/{providerId}/history/0/movement | Movimiento del moneyline, índice según ejemplos comunitarios | Serie si el proveedor la publica |
| Core .../odds/{providerId}/history/1/movement | Movimiento de spread, índice comunitario | Serie si existe |
| Core .../odds/{providerId}/head-to-heads | Comparación H2H del proveedor | Según liga |
| Core .../probabilities | Probabilidades ESPN del evento | Son modelo, NO apuestas |
| Core .../predictor | Predictor ESPN | No convertirlo a cuota |
| Core seasons/{year}/types/2/teams/{teamId}/ats | Récord contra el spread | Estadística agregada |
| Core seasons/{year}/types/{type}/teams/{teamId}/odds-records | Rendimiento respecto a odds | Agregado por temporada |
| Core seasons/{year}/futures | Mercados de campeonato o temporada | Histórico si ESPN conserva esa temporada |
| Core teams/{teamId}/odds/{providerId}/past-performances | Resultados y líneas por equipo/proveedor | Candidato para series históricas |
| Core providers | Catálogo de proveedores ESPN | Identidades, no disponibilidad de cuotas |

## Instrucciones para Kira

1. Para conocer rutas, invocar sports_chat_espn_core_catalog. Devuelve patrón de URL, parámetros y uso de las 14 rutas.
2. Para recuperar históricos por fecha: sports_chat_espn_historical_odds(sport=baseball,league=mlb,date=2025-10-29,days=1). Examina scoreboards diarios, Core por juego y fallback summary. Incluye límites de tres días, ocho eventos por día, 42 peticiones. No garantiza que ESPN tenga archivos completos.
3. Para estudiar un evento específico: obtener eventId/competitionId en scoreboard. Consultar sports_chat_espn_core(mode=odds), luego provider con ID realmente devuelto. Para cambios en la línea consultar movement con movementType 0/1.
4. Para retrospectiva por equipo: past_performances, ats, odds_records. Para futuros de años anteriores: futures con season correspondiente.
5. Para precios actuales: usar sports_chat_odds, con filtro de partido FUTURO, casa identificada, mercado, selección y fecha de actualización.

### Protección de datos históricos

La fecha del partido no es fecha del precio: si falta lastUpdated/lineDate, no declarar precio de apertura o cierre. Cada registro del recuperador histórico está etiquetado historical=true y priceStatus=historical_unverified. Nunca enviarlo al generador de tickets actuales.

Si Core devuelve referencias $ref, solo seguir HTTPS al host público ESPN para deporte, liga, evento y competición ya identificados. No seguir hosts arbitrarios ni URL enviadas por usuarios. Cachear y limitar; no prometer acceso gratuito ilimitado.

Los IDs de proveedor no son universales: comparar provider.id y provider.name de la respuesta concreta, no asignar ciegamente 58 a ESPN BET o 41 a otra casa.

Si un día resulta vacío, informar cobertura, fechas y errores; no afirmar que no existen históricos de todo ESPN. Mantener SportsbookReview, MLB históricos y snapshots propios como fuentes distintas con su procedencia.
