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
