# Portales complementarios para investigación deportiva — PHOENIX

Este documento describe el **conocimiento operativo** de ScoresAndOdds, Covers,
VegasInsider y OddsPortal añadido a Kira. No instala scrapers, no afirma acceso
autorizado a APIs de terceros y **no permite colocar apuestas**.

| Portal | URL pública de referencia | Qué aporta | Limitación |
| --- | --- | --- | --- |
| ScoresAndOdds | https://www.scoresandodds.com/las-vegas-odds | Cuotas, movimientos, tendencias, boxscores | Puede no conservar histórico ni mostrar actualización por casa |
| Covers | https://www.covers.com/sport/odds | Comparación por casas, apertura, spread/moneyline/total, consenso | Puede retrasar datos; la frecuencia publicada no es el timestamp de cada precio |
| VegasInsider | https://www.vegasinsider.com/nba/odds/las-vegas/ | Líneas, movimiento, consensos y comparaciones | Consenso ≠ probabilidad calibrada |
| OddsPortal | https://www.oddsportal.com/ | Mercados internacionales y datos históricos parciales | Cobertura, acceso y uso automatizado dependen del sitio |

## Ejecución desde Kira

1. Obtén **eventId, competitionId, equipos, liga y fecha** con `sports_chat_games`.
2. Consulta `sports_chat_odds` con fecha/eventId y, si aporta valor, las rutas
   `sports_chat_espn_core` de historia, movimiento, ATS y mercados.
3. Ejecuta `sports_chat_market_source_catalog` para identificar cuál portal
   externo ayuda con la pregunta. Este catálogo es **read-only y sin red**.
4. Si PHOENIX dispone de navegación autorizada y el sitio permite el uso,
   examina la página y recoge evidencia con **URL de origen**, casa, equipos,
   liga, fecha, período, selección, mercado, precio, línea, zona horaria,
   `pageObservedAt` y `quoteUpdatedAt` si el portal lo documenta.
5. **No conviertas `pageObservedAt` en `quoteUpdatedAt`**. Sin timestamp del
   proveedor, mostrar «cuota observada, vigencia sin verificar».
6. Para diferentes portales, reconciliar partido por fecha/hora, liga, equipos,
   mercado, período y casa; el ID de ESPN no se reutiliza como ID externo.
   Mostrar coincidencias, divergencias y ausencias.
7. Los precios de comparadores, aunque sean recientes, requieren confirmar
   disponibilidad/aceptación con la casa real. Nunca atribuirles un ticket
   colocado, ganancia ni valor esperado positivo garantizado.

**Seguridad:** sin eludir CAPTCHAs, autenticación, rate limits, geobloqueos o
reglas del sitio; sin extracción masiva no autorizada. El portal en un catálogo
no equivale a adaptador en vivo. El análisis independiente de Kira y el favorito
del mercado deben visualizarse por separado.

## Comprobación

```bash
node --experimental-strip-types --test packages/core/tool-sports/tests/sports-secondary-sources.test.mjs
```

En Kira: «Muéstrame sports_chat_market_source_catalog, explica cuál fuente
puedes consultar de verdad y cuáles son solo enlaces de investigación. Revisa
un partido ESPN real; si no tienes acceso a estos portales, no inventes cuotas».

## Diagnóstico de la cartelera NBA y SportIntel (30-oct-2026)

- El adaptador `sports_chat_games` toma las líneas genuinas incluidas en ESPN
  Scoreboard y, para partidos futuros con al menos dos selecciones reales de una
  misma casa, las presenta dentro de las tarjetas, **incluso cuando ESPN omite
  la hora de actualización**. En ese caso solo son referencias de investigación.
- El favorito **de mercado** se muestra únicamente cuando una misma casa publica
  precios individuales para ambos equipos. No reemplaza la tendencia propia de
  Kira basada en resultados, localía, bajas y calidad de adversarios.
- `sports_chat_odds` puede dibujar referencias de Core/Summary en tarjetas
  `sports_odds_card` aunque no haya precios que cumplan los filtros de vigencia.
  Los precios de referencia jamás se incluyen en tickets calculados.
- OddsHarvester permite basketball `moneyline` con prórroga y `1x2` en tiempo
  reglamentario. Su adaptador consulta periodos distintos y distingue claramente
  la alternativa; **no** transforma una cuota 1x2 en moneyline.
- SportIntel MCP (`roizenlabs/sportintel-mcp`) es código MIT, pero su
  `get_live_odds` requiere `ODDS_API_KEY` para The Odds API v4. No es un feed
  gratuito adicional: incorporarlo tal cual duplicaría la fuente. Además, su
  implementación publicada infiere nombres de equipos de spreads y asigna
  `gameTime` desde la hora del sistema, por lo que no cumple por sí sola el
  estándar de integridad de datos de PHOENIX.

### Prueba recomendada en Kira

«Kira, muestra una cartelera NBA futura y las **cuotas de referencia que
realmente devuelve ESPN**, indicando casa, línea, selección y si no se publica
la actualización. Distingue favorito de mercado de favorito de tu investigación.
Consulta `sports_chat_odds` del mismo `eventId` con h2h, spreads y totals.
Si OddsHarvester falla, informa el error concreto e intenta basketball 1x2
reglamentario SIN tratarlo como moneyline con prórroga. No inventes precios».

## Archivo histórico local: prueba de procedencia, no feed ilimitado

PHOENIX ahora puede guardar **cuotas que YA fueron observadas** durante una consulta de
`sports_chat_games` o `sports_chat_odds`. Se guardan localmente bajo
`PHOENIX_SPORTS_SOURCE_HOME/research-odds/<sportKey>/<YYYY-MM-DD>/` o en
`~/.phoenix/sports-sources/research-odds` de manera predeterminada.
No se consultan endpoints adicionales al guardar una observación.

El formato distingue `observedAt` (momento UTC en que Kira vio la respuesta)
de `providerUpdatedAt` (fecha real publicada por la casa, cuando existe).
**Nunca se sustituye la segunda por la primera.** Todas las filas históricas
llevan `historical:true` y `quoteIsCurrent:false`.

Para buscar, llama la herramienta `sports_chat_local_odds_archive` con
`sportKey`, `fromDate`, `toDate` en fechas UTC y opcionalmente
`eventId`. Cada consulta recorre hasta 31 días y devuelve hasta 300 filas
con cobertura real, errores y señal de truncamiento. Un evento sin captura
anterior debe responder cero observaciones, nunca completarse con probabilidades
estimadas. Las fechas corresponden a captura, no a los días originales de
líneas que ESPN publique retroactivamente.

Un operador puede deshabilitar el almacenamiento:
`PHOENIX_SPORTS_RESEARCH_ARCHIVE_DISABLED=1`. Los datos son para
investigación privada y **no** constituyen licencia para redistribución ni
captura masiva de proveedores. Respetar los términos aplicables.

### Evaluación de fuentes gratuitas realizada el 30 de octubre de 2026

| Fuente | Cobertura gratuita | Uso en PHOENIX |
| --- | --- | --- |
| ESPN Site/Core | Públicas, no oficiales, incompletas, sin SLA | Consultar con prudencia; conservar solo líneas ya obtenidas cuando corresponda |
| OddsHarvester (código abierto) | 11 deportes, históricos por temporada y cuotas próximas, sujeto a condiciones del portal | Complementario, sin garantía, sin eludir bloqueos |
| ParlayAPI demo | Solo 5 eventos por deporte; 60 llamadas/hora/IP | **No integrado** para archivo: TOS restringen uso público y conservación más de 90 días |
| The Odds Gap | Semana de muestra fija 15–21 sep 2026 | **No integrado**: el histórico reciente requiere suscripción |
| Football-Data / Tennis-Data | Históricos extensos de fútbol y tenis | **No ingestar automáticamente**: uso con bots/IA no permitido sin autorización |
| The Odds API v4 | 500 créditos/mes; requiere clave | Opcional, sujeto a cupos y costos de históricos |
| SportIntel MCP | Código MIT, no servicio gratuito de odds | get_live_odds requiere la misma The Odds API v4 |

### Resultado honesto

Esta implementación no consigue un proveedor de **cuotas actuales ilimitadas**
de todas las casas. Eso no se puede garantizar usando los portales revisados.
Sí ofrece una base histórica local **acumulativa** de las líneas que PHOENIX
llegue a observar. No muestrea con PHOENIX apagado, no crea años anteriores
y no presenta opiniones de expertos como probabilidades calibradas.
