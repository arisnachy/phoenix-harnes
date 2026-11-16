# PHOENIX NHL — MoneyPuck CSV rápido (16 noviembre 2026)

## Cambio aplicado
El investigador pregame ya integra opcionalmente MoneyPuck sin scraping HTML:
* \`https://moneypuck.com/moneypuck/playerData/seasonSummary/update_date.txt\` — sello del paquete;
* \`https://moneypuck.com/moneypuck/playerData/seasonSummary/{YEAR}/regular/teams.csv\` — **5on5** xGF, xGA, xGF%, Corsi, Fenwick (NHL team abbreviation);
* \`https://moneypuck.com/moneypuck/playerData/seasonSummary/{YEAR}/regular/goalies.csv\` — por **NHL playerId**, GSAx = xGoals − goals (situación \`all\`), juegos y tiros de alto peligro si los exporta.

Se usa el **año inicial**, p. ej. temporada NHL 20262027 ⇒ MoneyPuck \`2026/regular\`. No confundir team xGoalsFor/Against con goalie xGoals/goals. Los CSV son de temporada, no pronósticos ni estadísticas históricas punto-en-el-tiempo; el sello global es condición necesaria, no prueba completa del cierre exacto por partido.

## Activación responsable
MoneyPuck publica estos archivos para **uso no comercial con atribución**. Para explotación comercial: obtener autorización de su titular. No usar navegación automatizada para eludir protecciones ni extraer páginas fuera de las descargas aprobadas. El adaptador es **opt-in**:
\`\`\`powershell
$env:PHOENIX_MONEYPUCK_NONCOMMERCIAL = '1'
# Reiniciar PHOENIX en el mismo entorno de proceso
\`\`\`
El valor se lee en Node al construir el expediente, sin introducir clave de API. Por defecto queda deshabilitado para no presumir una licencia. Este mecanismo no es todavía un ajuste visual persistente.

## Rendimiento y seguridad de evidencia
* **3 GET máximos** por descarga (sello y dos CSV, los CSV en paralelo) con timeout individual de 4 segundos; límite 350 KB/archivo; caché por temporada de 15 minutos.
* Un CSV sin dos equipos 5v5, un playerId duplicado o no casado, esquema cambiado o un número inválido **no produce ceros inventados**.
* Si el sello de publicación tiene más de 48 horas respecto de la decisión, el dato es **stale**. Si se publicó después del instante de decisión o inicio del partido, se rechaza para backtests (sin leakage).
* La tarjeta muestra MoneyPuck como fuente separada. Módulo F A-Q es \`verified\` solo cuando los dos equipos 5v5 tienen campos utilizables; GSAx se adjunta a H, sin ascenderlo a portero titular.
* No sustituye el portero confirmado, alineaciones/scratches, lesiones, viaje, mercado 60 min frente a OT/SO, ni modelo calibrado. Esos controles continúan pendientes cuando no hay evidencia.
* El \`decisionAt\` de replay nunca puede ser reemplazado por el sello de consulta de un CSV posterior; la validez retrospectiva exige snapshots archivados punto-en-el-tiempo.

## Fuentes complementarias y limitaciones
- Natural Stat Trick ofrece análisis 5v5, pero no se ha comprobado una API de uso automático libre. Usar como **contraste autorizado**, no scraping.
- Daily Faceoff ofrece confirmaciones nominales fechadas de porteros, pero esta entrega **no** añade extracción HTML automática sin autorización. El boxscore NHL oficial sigue siendo un primer intento no suficiente.
- NHL API sigue siendo fuente primaria de IDs, rosters, game logs, PP/PK y marcadores; NHL equipo/summary NO ofrece xG 5v5 equivalente.
- Evolving-Hockey ofrece métricas cuyo acceso puede requerir suscripción.
- Las cuotas ESPN observadas requieren reconciliar evento exacto, casa, mercado y período: una respuesta HTTP 200 no acredita un precio ni su aceptación.

## Pruebas
\`node --experimental-strip-types --test packages/core/tool-sports/tests/nhl-moneypuck-evidence.test.mjs\`

Además, \`PHOENIX NHL Hockey Intelligence\` ejecuta pruebas NHL existentes y compilación TypeScript cuando cambian módulo y workflow. La comprobación HTTP real requiere el runtime autorizado; la prueba de contrato por mocks no acredita por sí sola disponibilidad de la fuente en la laptop. Citar **Data: MoneyPuck.com** en los informes derivados.
