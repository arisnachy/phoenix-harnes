# PHOENIX Sports Intelligence — fuentes, mercados e instalador de actualización

## Instalación automática con las actualizaciones

Tras actualizar PHOENIX stable (o al arrancar el supervisor de Windows), la tarea
`scripts/phoenix-sports-source-auto.mjs` comprueba si faltan componentes y
ejecuta de forma **independiente, no bloqueante e idempotente**:

- `jordantete/OddsHarvester` **0.20.0** en Python virtual + Playwright Chromium.
  Es el único de los tres que puede consultar precios futuros. Su acceso depende
  de OddsPortal, país, restricciones y condiciones de uso. No existen cuotas ilimitadas garantizadas.
- `flancast90/sportsbookreview-scraper`: código fuente clonado y archivos
  `sportsbookreview-{nba,mlb,nfl,nhl}.json` de historial 2011–2021, destinados a análisis y backtesting.
- `ArnavSaraogi/mlb-odds-scraper`: código clonado y dataset histórico MLB
  2021–2025 descargado del asset público oficial (aprox. 80 MB).
  Este proyecto expone moneyline, run line y totales **históricos**.

Los archivos viven bajo `~/.phoenix/sports-sources/`, no en la carpeta Git
que actualiza PHOENIX ni en su almacén de credenciales. El instalador **no**
ejecuta los scrapers históricos automáticamente contra páginas externas.
La instalación puede requerir Python 3, git, espacio en disco y acceso a
Playwright/GitHub; un error deja la aplicación principal funcionando.

Logs: `~/.phoenix/sports-sources/install.log`.
Estado: `~/.phoenix/sports-sources/manifest.json`.

```powershell
# Comprobar sin descargar:
node scripts/phoenix-sports-source-bootstrap.mjs --status

# Forzar reparación a petición del usuario:
node scripts/phoenix-sports-source-bootstrap.mjs --install

# Desactivar temporalmente la instalación automática:
$env:PHOENIX_SPORTS_SOURCES_AUTO_INSTALL='0'

# Desactivar SOLO scraping real manteniendo los ficheros instalados:
$env:PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED='0'
```

La herramienta `sports_chat_sources_health` vuelve a leer el manifiesto,
reconoce las fuentes realmente presentes sin imprimir tokens y mantiene
diferenciados `configured`, `missing-binary`, `missing-files`, `disabled`.
`configured` **NO** significa que una casa haya publicado cuotas recientes.

## Contexto público enriquecido: consultas reales y límites

- ESPN Site API v2: `scoreboard`, `summary?event=<id>`, `news`,
  `injuries`, `teams/<id>/roster`. Se contrastan por ID y por mención
  de los equipos, con totales de registros. Algunos endpoints son no
  oficiales, responden estructuras diferentes o no tienen datos.
- NHL: `https://api-web.nhle.com/v1/score/YYYY-MM-DD`,
  cotejo del encuentro por abreviaturas y fecha; no confirma por sí solo
  porteros titulares.
- MLB StatsAPI: `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher`
  para cotejo de cartelera. Los lanzadores `probablePitcher`, cuando se
  publican, son **probables**, no confirmados.
- The Odds API v4 (`THE_ODDS_API_KEY`) y TheOddsAPI
  (`THEODDSAPI_API_KEY`) son servicios opcionales distintos con
  cupos. No hay proveedor gratuito ilimitado garantizado.

Toda respuesta respeta una lista fija de HTTPS hosts y un límite de tamaño,
con fechas y estados pendientes. Un `feed` de lesiones accesible no equivale
a comprobar que cada jugador está sano ni a confirmar un titular.

## Mercados alternativos

Kira puede consultar `sports_chat_market_intelligence` por `sportKey`
y `sports_chat_deep_research` por ID ESPN. El catálogo cubre familias
según la disponibilidad REAL del proveedor:

| Deporte | Mercados posibles |
| --- | --- |
| Fútbol | 1X2, doble oportunidad 1X/X2, BTTS, over/under, hándicap |
| NBA/WNBA | ganador, spread, totales, mercados de jugador si publicados |
| NHL | moneyline, puck line, goles totales y mercados de portero si publicados |
| MLB | moneyline, run line, carreras totales y abridor si verificado |
| NFL | ganador, spread, totales y props de jugadores si publicados |
| Tenis | ganador, total y hándicap de juegos/sets |

**No todos los mercados están implementados como picks automáticos, ni todas
las fuentes ofrecen todas las familias**. El motor compara cotizaciones
con bookmaker, event ID, timestamp y tipo de mercado. Puede calcular
`1/cuota` y, solo en mercados exhaustivos y mutuamente excluyentes,
la cuota sin margen de la casa; ambos son **atributos del precio**,
no un modelo de probabilidad deportiva. No calcula expectativa positiva sin
probabilidades calibradas y pruebas fuera de muestra. No puede garantizar tickets ganadores.

Para confirmar 1X/X2, nunca transformar un moneyline o 1X2 en ese mercado
sin una cotización explícita de `double_chance`.
Para combinadas, cuotas y apuestas de una casa deben corresponder
a eventos y tiempos reales; opciones del mismo encuentro pueden estar correlacionadas.

## Prueba en PHOENIX

Pedir a Kira que ejecute `sports_chat_sources_health`; después
`sports_chat_market_intelligence` para `icehockey_nhl` o
`basketball_nba`, mostrando ofertas rechazadas por antigüedad o
mercados ausentes. Para un encuentro específico, ejecutar
`sports_chat_deep_research` con `eventId` ESPN y mostrar fuentes,
noticias, plantilla y datos faltantes. Finalmente probar
`sports_chat_ticket_evidence_priced_auto` con `count=5` o `6`;
revisar `sourceAudit`, `quotedLegs`, `approvedLegs` y diversidad deportiva.
Un ticket 4/5 sin cuota sigue siendo **borrador, no apuesta**.

Revisar el log del instalador si no hay CLI o si una descarga falla; nunca
compartir API keys ni resultados que incluyan datos privados.
