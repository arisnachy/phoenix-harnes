# ESPN Core pública: inteligencia deportiva y cuotas (PHOENIX)

**Estado:** integradas familias de rutas, no garantía de HTTP 200 en todas las ligas.
Fuente no oficial: https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c
y https://github.com/pseudo-r/Public-ESPN-API .

## Rutas (ESPN Core v2)

Base: `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}`

| Herramienta (mode) | Ruta | Uso |
| --- | --- | --- |
| odds | `/events/{eventId}/competitions/{competitionId}/odds` | Cuotas publicadas por encuentro |
| provider | `/events/{eventId}/competitions/{competitionId}/odds/{providerId}` | Detalle de un bookmaker |
| movement | `/events/{eventId}/competitions/{competitionId}/odds/{providerId}/history/0/movement` | Movimiento histórico |
| head_to_heads | `/events/{eventId}/competitions/{competitionId}/odds/{providerId}/head-to-heads` | Mercado de enfrentamiento |
| ats | `/seasons/{season}/types/{seasonType}/teams/{teamId}/ats` | Against the Spread (regular=2) |
| futures | `/seasons/{season}/futures` | Futuros, si existen |
| past_performances | `/teams/{teamId}/odds/{providerId}/past-performances` | Histórico de desempeño vs odds |
| odds_records | `/seasons/{season}/types/{seasonType}/teams/{teamId}/odds-records` | Récord según estatus de cuota (default=0) |
| probabilities | `/events/{eventId}/competitions/{competitionId}/probabilities` | Probabilidades ESPN, NO apuestas |
| predictor | `/events/{eventId}/competitions/{competitionId}/predictor` | Proyecciones ESPN, NO cuotas |
| providers | `/providers` | Catálogo de bookmakers ESPN |

Ejemplo de URL: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401220181/competitions/401220181/odds?limit=25&page=1` (ID histórico de referencia, no cotización vigente).

### Kira (herramientas nativas)

1. `sports_chat_espn_core_catalog` — descubre modos, sin peticiones HTTP.
2. `sports_chat_espn_core` — requiere `mode,sport,league`; añade `eventId`/`competitionId`, `season`/`teamId` o `providerId` según modo. Devuelve `state: data|empty|unavailable`, `error`, `source`, `endpoint`, `observedAt`, `count`, `items`, `details`, `page`. Hasta 12 ejemplos y 6 referencias Core expandidas por consulta. Para el resto, incrementa `page`.
3. `sports_chat_odds` — conserva el canal para cuotas cotizables; ahora interpreta `h2h`, `totals` y `spreads` de ESPN cuando los campos tienen un precio explícito. Mantiene opciones de OddsHarvester y proveedores comerciales si están configurados.

### Seguridad, límites y rendimiento

- URLs construidas por el backend; solamente HTTPS y `sports.core.api.espn.com`. Las referencias internas exactas `sports.core.api.espn.pvt` se convierten a `.com` sin habilitar dominios arbitrarios.
- `eventId`, `competitionId`, `teamId`, `providerId` deben ser identificadores numéricos; deporte y liga son segmentos validados.
- Caché temporal de 60 s y solicitudes compartidas por URL. La herramienta no recorre indiscriminadamente todos los jugadores/temporadas ni hace peticiones de IA por elemento. Los errores 404/403 se informan sin fabricar datos.
- Los archivos ATS, odds_records, past_performances, futures, probabilities y predictor son contexto; NO sustituyen un precio de bookmaker vigente y no se multiplican para cotizar tickets.
- **No hay garantía de disponibilidad, acceso ilimitado o exactitud legal/licenciamiento.** Respeta las condiciones de ESPN y los límites implícitos. Los endpoints son una interfaz no oficial.
- Para validar en un host real, compara la salida de `sports_chat_espn_core` con `sports_chat_games` para un evento ESPN comprobado, ejecuta `providers`, `odds`, `ats` y revisa `state`. Las pruebas unitarias usan datos simulados para evitar dependencia de la API no garantizada.
