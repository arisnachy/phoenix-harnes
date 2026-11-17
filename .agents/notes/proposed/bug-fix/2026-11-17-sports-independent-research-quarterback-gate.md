# Auditoría de cinco favoritos del 16 de noviembre de 2026 y corrección de investigación abierta

## Evidencia pública y orden temporal

El boleto de investigación presentó 76ers ML, Rockets ML, Warriors ML, Ravens ML y Nuggets ML. Los resultados publicados: Philadelphia 135–123 Brooklyn; Houston 110–128 Miami; Golden State 94–115 New Orleans; Baltimore 20–23 Los Angeles Chargers; Denver 105–117 Phoenix. Hubo 1/5 aciertos. Este porcentaje describe **una única combinada**, no estima el rendimiento del algoritmo.

- [NBA, resultados oficiales del 16 de noviembre](https://www.nba.com/schedule/2026): cuatro resultados oficiales del boleto NBA, junto con toda la cartelera.
- [Pelicans, previa de lesiones del 15 de noviembre](https://www.nba.com/pelicans/news/pelicans-vs-warriors-injury-report-game-preview-11-16-2026): Stephen Curry, Jimmy Butler III, Moses Moody y Kristaps Porziņģis figuran fuera de Golden State; el motor debe examinar disponibilidad y rotaciones **antes** de concluir por récord de temporada.
- [Miami Heat, crónica del 16 de noviembre](https://www.nba.com/heat/news/coups-takeaways-heat-best-game-rockets-antetokounmpo-adebayo-mitchell-durant): Houston estaba en back-to-back sin Amen Thompson, Marcus Smart ni Steven Adams. Para el replay de las 19:30 ET se exige reconstruir qué noticias eran accesibles al momento de cada corte.
- [Ravens, reporte de inactivos antes de jugar, 16 de noviembre, 18:57 ET](https://www.baltimoreravens.com/news/ravens-inactives-chagers-shakeup-defense-practice-squad-nick-vannett-chris-moore-chandler-rivers): Lamar Jackson fuera por pulgar, Jacoby Brissett como titular sustituto; el cambio de QB debe activar retención y nueva investigación.
- [Nuggets, previa oficial del 16 de noviembre](https://www.nba.com/nuggets/news/nuggets-host-suns-monday): Denver tenía factores favorables; la derrota posterior no prueba por sí sola un fallo de captura de lesiones. Requiere calibrar predicciones y medir el riesgo residual.
- [Ravens, resultado oficial](https://www.baltimoreravens.com/game-day/2026/reg-week10/chargers-at-ravens/scoring-summary): Chargers 23–20 Ravens.

## Defecto y alcance de esta corrección

En `sports-ticket-decision.ts`, un expediente con cualquier `criticalPending` terminaba en `caution`, incluso cuando NFL no había confirmado al quarterback titular. La corrección convierte específicamente esa condición en `hold`, la cuenta como revisión alternativa necesaria y la elimina de escenarios de 3/4/5 patas; no inventa información de lesiones ni suprime la ficha.

En `sports-open-research-guidance.ts`, ESPN y los enlaces aportados por el usuario ya no se presentan como un universo cerrado. La instrucción del agente exige descubrimiento activo de fuentes públicas autorizadas, comprobación independiente, postura adversarial por favorito y evidencias publicadas antes del partido. El sistema debe evitar repetir barridos y conservar expedientes parciales.

Esto NO representa por sí solo un conector nuevo de navegación abierta, un modelo calibrado ni la verificación automática de todos los reportes oficiales de lesiones. Para obtener un boleto verdaderamente definitivo queda pendiente integrar dichas fuentes en los adaptadores nativos, cuantificar el impacto de jugadores y ejecutar backtests cronológicos con cuotas de cierre y mercado de referencia.

## Criterios de aceptación

1. Un QB NFL crítico no confirmado produce `hold` aun con mercado y expediente de otros factores completos; no entra en escenarios.
2. El texto del sistema exige que la investigación descubra sus propias fuentes, coteje fecha de publicación/observación y revise riesgos adversos.
3. El ticket puede visualizar cinco cuotas observadas con sus advertencias, pero `approvedForBetting` permanece `false`, y `hold` no equivale a una selección lista para ejecutar.
4. Los tests unitarios documentan ambos casos. Se requiere CI de GitHub y un replay contra un conjunto point-in-time antes de proclamar que el sistema de producción quedó corregido.

## Seguimiento técnico

Priorizar un adapter fuente oficial: NBA injury reports y sesiones activas; NFL starter/inactives con actualización antes de kickoff; NHL starter confirmado; impactos de rotación y calendario; re-ranking después de noticias; auditoría de probabilidades calibradas, Brier/log loss, CLV y resultados por deporte y cuota. Nunca optimizar simplemente para evitar los cuatro resultados perdedores ya conocidos.
