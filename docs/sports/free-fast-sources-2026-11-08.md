# PHOENIX Sports · Reparación de fuentes gratuitas y mercados (2026-11-08)

## Resultados que motivan la reparación

La auditoría local reportó 0/11 disciplinas con cuotas en OddsHarvester y 0/13 expedientes completos. Esto **no significa** que los proveedores no tengan datos: distingue fuente no configurada, competición fuera de temporada, día sin partidos, mercado inválido, bloqueo del sitio, expiración y expediente incompleto.

Se contrastaron los enumerados reales del proyecto [OddsHarvester](https://github.com/jordantete/OddsHarvester/blob/master/src/oddsharvester/utils/sport_market_constants.py), y se detectó discrepancia entre el README (que menciona moneyline) y las enumeraciones reales del CLI: **BaseballMarket y AmericanFootballMarket contienen home_away y 1x2**, mientras BasketballMarket enumera home_away y 1x2. El adaptador ahora conserva `moneyline` como alias de compatibilidad *interno*, pero invoca el CLI usando `home_away` y `--period full_including_ot`. Un mercado 1x2 de tiempo reglamentario nunca debe etiquetarse ganador incluyendo prórroga.

## Catálogo útil: gratuito ≠ cuota apostable

| Fuente | Acceso | Datos idóneos | Cómo se usa |
|---|---|---|---|
| ESPN Site/Core (NO oficial) | Sin clave, endpoints sujetos a cambio | Cartelera, IDs, boxscore, estadística básica, lesiones cuando ESPN las publica; cuotas solo ocasionales con precio/bookmaker/updatedAt | Motor y diagnóstico rápido |
| MLB StatsAPI | Público, sin clave | Calendario, resultados, rosters, pitchers probables, estadística | Motor MLB + diagnóstico |
| NHL Web API | Público, sin clave | Partidos, resultados, rosters y estadísticas; **no confirma portero titular futuro** | Motor NHL + diagnóstico |
| TheSportsDB | Clave gratuita pública `123`, límites por endpoint | Calendario secundario de varios deportes, respuesta parcial; no cuota comercial | Crosscheck + diagnóstico |
| OpenLigaDB | Sin clave | Bundesliga calendario/resultados | Crosscheck por evento |
| OpenFootball football.json | Archivos públicos de calendario históricos | Fútbol internacional, comparación de fecha/equipos; no garantiza hora UTC | Crosscheck parcial |
| nflverse | Archivos públicos | Lesiones semanales históricas NFL, PBP/analítica con fecha y cobertura | Investigación con advertencia de frescura |
| NBA Official Injury Report | Web oficial pública | Bajas informadas por equipo y fecha, **verificar hora de publicación** | Comprobación oficial de lesiones |
| Open-Meteo | Sin clave para uso no comercial | Clima por estadio y hora real; no informa cuotas | Contexto meteorológico |
| StatsBomb Open Data | Datos de muestra, licencias por dataset | xG y eventos **históricos y parciales**, no datos globales actuales | Investigación y modelado histórico |
| The Odds API v4 | Cuenta/clave gratuita con créditos limitados | Cotizaciones por libro con mercado y timestamp | Solo si el operador configura clave válida |
| OddsHarvester/OddsPortal | CLI instalado, permiso del operador, dependiente del sitio | Mercados de terceros observados, por bookmaker y periodo | Alias CLI corregido; no se eluden bloqueos |

**Exclusiones deliberadas:** las ediciones gratuitas de balldontlie generalmente no incluyen lesiones, estadística avanzada ni cuotas; Football-Data.co.uk publica CSV históricos y términos que limitan la extracción automática para productos de IA, por lo que no se añade como scraper automático.

## Uso operativo inmediato desde el chat

1. `sports_chat_sources_health`: revisa instalador, archivo, permisos y ruta real del ejecutable. «Instalado» nunca equivale a cuota publicada.
2. `sports_chat_free_sources_probe({date:"AAAA-MM-DD"})`: seis consultas JSON sin claves: NBA/NFL/Liga MX ESPN, MLB StatsAPI, NHL API y TheSportsDB. Cada resultado incluye `status`, `records`, `elapsedMs`, `checkedAt`, `endpoint` y limitación.
3. `sports_chat_odds_scan`: 11 disciplinas por páginas; `home_away` para NBA, MLB y NFL, evitando el mercado `moneyline` inválido del CLI.
4. `sports_chat_source_resilience`: contrasta un evento verificado con fuentes secundarias. La falta de coincidencia no invalida un ID primario de ESPN.
5. `sports_chat_ticket_evidence_auto`: si faltan cuotas, muestra borrador deportivo **sin precio ni retorno**; `sports_chat_ticket_evidence_priced_auto`: solo cuando existen cuotas de un mismo bookmaker y eventos inequívocos.
6. Nunca rellena hasta cinco selecciones con apuestas inventadas, ni llama ticket ganador a una propuesta sin calibración.

## Semántica de fallos recuperables

- `observed`: se encontró un objeto público con lista válida; no implica expediente completo.
- `empty`: respuesta válida sin partidos para la fecha; posible temporada baja.
- `unavailable`: HTTP/timeout/esquema incompatible; registrar causa.
- `disabled`: configuración explícita del host.
- `no-upcoming-events`: OddsHarvester reporta de manera expresa «0 failed» y «sin encuentros»; un 403/429/timeout no puede transformarse en vacío.
- `missing-binary`: ejecutable no visible por el proceso PHOENIX.
- `install-error`: el manifest o el archivo indica instalado pero el CLI no supera `--help`.

Los sondeos son read-only, con URLs allowlist y caché de 4 minutos en producción; no hay consultas automáticas ilimitadas ni claves embebidas. No se validó aquí acceso a cuotas de ninguna casa comercial ni se ejecutaron apuestas.

## Verificación

```sh
node --experimental-strip-types --test packages/core/tool-sports/tests/keyless-odds.test.mjs packages/core/tool-sports/tests/sports-research-recovery.test.mjs packages/core/tool-sports/tests/sports-fast-free-probes.test.mjs packages/core/tool-sports/tests/sports-source-health.test.mjs packages/core/tool-sports/tests/sports-odds-coverage.test.mjs
pnpm exec tsc -b tsconfig.host.json --pretty false
```

Estas pruebas se integraron también en `PHOENIX Daily Ticket Intelligence` para Ubuntu y Windows. Tras sincronizar el runtime de PHOENIX, el sondeo informa los estados **en ese equipo**: las pruebas simuladas no demuestran conectividad externa real.
