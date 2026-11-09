# PHOENIX · Cómo investigar cuotas públicas de ganador sin API key

## Principio operativo
No aceptar «0 cuotas» sin mostrar qué se intentó. Aun así, un sitio visible **no** equivale a una cotización vigente de una casa. El motor debe entregar pronósticos documentados por separado de sus precios cotizables y de las observaciones indicativas.

## Rutas comprobadas por navegación pública · 9 noviembre 2026
| Liga | ESPN | ScoresAndOdds | Oddschecker |
| --- | --- | --- | --- |
| NBA | https://www.espn.com/nba/odds | https://www.scoresandodds.com/nba/odds | — |
| NFL | https://www.espn.com/nfl/odds | https://www.scoresandodds.com/nfl/odds | — |
| NHL | https://www.espn.com/nhl/odds | https://www.scoresandodds.com/nhl/odds | — |
| MLB | https://www.espn.com/mlb/odds | https://www.scoresandodds.com/mlb/odds | — |
| WNBA | https://www.espn.com/wnba/odds | https://www.scoresandodds.com/wnba/odds | — |
| Premier League | https://www.espn.com/sports-betting/odds | — | https://www.oddschecker.com/us/soccer/premier-league |
| LaLiga | https://www.espn.com/sports-betting/odds | — | https://www.oddschecker.com/us/soccer/la-liga-primera |
| MLS | https://www.espn.com/sports-betting/odds | — | https://www.oddschecker.com/us/soccer/mls |

La existencia de las rutas ESPN no garantiza acceso mediante HTML: el sitio devolvió un desafío JavaScript/robot en la inspección externa. La ruta ScoresAndOdds de WNBA puede listar cero partidos durante la temporada baja; la estructura de una página no prueba mercados abiertos. Otros formatos de competición son sujetos a disponibilidad. No eludir bloqueos.

## Flujo de búsqueda en la herramienta
1. Validar la fecha del encuentro en America/Santo_Domingo y UTC, equipos, local/visitante y **eventId** ESPN; rechazar partidos iniciados.
2. Consultar Scoreboard JSON por fecha del día y siguiente fecha UTC si es necesario (no consultas por rango con guiones).
3. Para cada evento sin precio, buscar en **Core odds del evento exacto** (`sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{eventId}/competitions/{competitionId}/odds`), seguir exclusivamente referencias del dominio permitido, y consultar `summary?event=`.
4. Para fútbol exigir tres precios 1X2, incluido Draw, de la **misma casa**. Para NBA, NFL, NHL, MLB, WNBA, cotejar moneyline/ganador y período (NHL puede incluir prórroga o solo tiempo reglamentario).
5. En comparadores públicos abrir la ruta **/odds** correcta, seleccionar Moneyline/1X2, buscar ambos equipos y evento, identificar la fila con mercado y hora. Si solo hay precio visible pero no casa ni `updatedAt`, mostrar «referencia web» y el enlace, **sin** incluirla en la combinada cotizada.
6. No mezclar precios de casas distintas para una combinada, ni convertir la observación HTTP de una página en fecha de publicación de la cuota. No asumir que una oferta pública de Estados Unidos sea operable desde RD.
7. Registrar por fuente: `url`, `provider`, `eventId`, `bookmaker` o null, `selection`, `market`, `period`, `decimalOdds`/American, `quoteUpdatedAt` o null, `pageObservedAt`, `status` (vigente, referencia, vacía, bloqueada).
8. Tras un intento acotado, entregar **un único ticket** explicativo con candidatas, riesgos, motivos y un marcador «cuotas verificadas N/M». Si falta precio, el ticket es un borrador condicionado, nunca ticket apostado ni garantía de victoria.

## Garantías y restricciones
ESPN Site/Core es una interfaz no oficial y sin SLA. Oddschecker y ScoresAndOdds son portales de comparación; su información puede retrasarse o ser regional. Respetar términos, robots, captcha, login y límites de acceso. Nunca crear precios ni modificar un mercado para rellenar cinco o seis patas. Monitorear fuentes, usar respaldo y mantener `unknown` si fallan todas.
