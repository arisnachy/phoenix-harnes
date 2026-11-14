# PHOENIX Sports · Fuentes prepartido y backtesting cronológico (14-11-2026)

## Diagnóstico, alcance y resultado REAL
El ticket ilustrado del **13-11-2026** tenía cinco picks NBA: Knicks, Hawks,
Rockets, Spurs y Trail Blazers. Resultados oficiales: **3/5 aciertos**.
Knicks perdió 104-106 ante Pacers; Hawks 117-125 ante Bulls (prórroga);
Rockets ganó 125-118; Spurs ganó 123-85; Portland ganó 120-107.
Esto es una **auditoría retrospectiva del ticket**, no la validación de un
nuevo modelo de pronósticos. No se dispone del ledger completo original
(precios, probabilidades, hora exacta de cada pronóstico, lesiones y
configuración tal como se observaron). No atribuir mejoras causales ni EV.

## Hallazgo puntual verificado: informes OFICIALES con marca horaria

1. [NBA 13 nov 11:45 a. m. ET](https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_11_45AM.pdf)
   - Indiana: Aaron Nesmith = **Questionable** (rodilla derecha).
   - Chicago: Norman Powell = **Questionable** (espasmos espalda baja).
2. [NBA 13 nov 6:45 p. m. ET](https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_06_45PM.pdf)
   - Indiana: Aaron Nesmith = **Available**.
   - Chicago: Norman Powell = **Questionable** (incertidumbre no resuelta en ese corte).
3. Inicio NYK@IND 7:00 p. m. ET; ATL@CHI 8:00 p. m. ET.
   Ambos PDFs tienen una hora documental anterior a sus respectivos partidos,
   pero localizarlos ahora NO acredita que PHOENIX los descargara entonces.
4. Resultados: [NBA.com calendario 13 nov](https://www.nba.com/schedule),
   [Knicks-Pacers](https://www.nba.com/game/nyk-vs-ind-0022600034),
   [Hawks-Bulls](https://www.nba.com/game/atl-vs-chi-0022600037).

**Hipótesis a probar:** seguir versiones del reporte oficial y reabrir el
expediente cuando jugadores con importancia documentada cambien de estado,
o continúen Questionable a 45, 30 y 15 min del inicio. No inferir
minutos, quintetos, probabilidad de ganar ni ventaja de cuota del solo status.
Disponibilidad `Available` tampoco garantiza participación o minutos.

## Fuentes operativas ordenadas por uso

| Prioridad | Fuente | Mecanismo | Uso | Límite |
|---|---|---|---|---|
| 1 | [NBA injury report 2026-27](https://official.nba.com/nba-injury-report-2026-27-season/) | HTML enlaza PDF cada 15 min | Disponibilidad oficial | PDF requiere extracción/verificación; no llamar Available a Questionable |
| 1 | [NBA PDF 11:45](https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-13_11_45AM.pdf) | PDF versionado, fecha/hora ET | Evidencia archivada | Verificar documento; un patrón de URL no prueba existencia |
| 2 | [ESPN NBA injuries](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries) | JSON no oficial | Redundancia de estados/lesiones | Capturar ahora; un roster no sustituye el parte oficial |
| 2 | [ESPN NBA scoreboard](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261113) | JSON | IDs, calendario, final | Estado final solo como etiqueta después de kickoff |
| 2 | [ESPN NBA summary](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401909296) | JSON | Contexto prepartido y boxscore | Campos final/post prohibidos como features prepartido |
| 2 | [ESPN NBA rosters](https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/18/roster) | JSON | Match atleta-equipo | Plantilla actual no valida titular del evento |
| 1 | [NHL score](https://api-web.nhle.com/v1/score/2026-11-13) | JSON | Partidos/IDs NHL | Confirmar porteros vía otras fuentes |
| 1 | [MLB StatsAPI](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-11-13&hydrate=probablePitcher) | JSON | Calendario/abridores probables | Probable no equivale a confirmado |
| 2 | ESPN NFL `football/nfl/scoreboard?dates=YYYYMMDD` | JSON | IDs y calendario | Inactivos/QB requieren fuentes específicas |
| 2 | ESPN fútbol `soccer/{LEAGUE}/scoreboard?dates=YYYYMMDD` | JSON | Descubrir fixtures | Sin garantía de exhaustividad mundial |

**Estado de comprobación:** acceso directo a la página oficial NBA, dos
PDF fechados y resultados en NBA.com comprobados por investigación web.
Las demás rutas se identificaron en el código de PHOENIX y documentación
del proveedor; este documento NO afirma pruebas HTTP 200 para todas hoy.
Catálogo ejecutable en `src/sports-pregame-research.ts`.

## Protocolo que debe ejecutar PHOENIX

1. **T-24 h**: descubrir toda la cartelera de deportes y mercados, resolver IDs
   y separar proveedor de evento, temporada, liga, home/away y mercado.
2. **T-6 h, T-90, T-45, T-15**: capturar partes de lesiones, titulares
   confirmados si existen, rotaciones, datos de forma y cuotas. Guardar hora
   de captura, hora de publicación, URL, hash de contenido y versión.
   Respetar límites de acceso y términos de las fuentes.
3. Las fuentes oficiales son **primarias para estados**, ESPN es redundancia.
   Si una respuesta está vacía no asumir plantilla sana.
4. Al detectar `Questionable -> Available`, `Questionable -> Out`, etc:
   recalcular el expediente de ambos equipos y contrastar alternativa,
   no asignar un bonus arbitrario de puntos o porcentaje por una etiqueta.
5. Toda recomendación debe archivar antes del kickoff `decisionAt`,
   `featuresThroughAt`, `kickoffAt`, `market`, `selection`, `odds`,
   `modelProbability` (si está calibrada), `marketNoVigProbability`,
   fuente y selección/versión de modelo.
6. Después del final: vincular el resultado con el ID ESPN/NBA, y evaluar
   de forma independiente resultado, Brier, log-loss, comparación vs mercado
   y beneficio neto sobre las cuotas efectivamente archivadas.
7. Tuning **solo en entrenamiento temporal anterior**; evaluación walk-forward
   o holdout posterior intacto. No elegir umbrales viendo el resultado
   del mismo 13-11. Segmentar por deporte, mercado, localía, descanso,
   confirmaciones y efecto de lesiones. Publicar tamaño de muestra y CI.
8. No imponer 5-6 patas cuando no existen 5-6 seleccionables con respaldo:
   presentar el faltante y los motivos; ninguna garantía de combinación segura.

## Código y pruebas

- `src/sports-pregame-research.ts`: catálogo de endpoints, constructor
  validado de PDF oficial, comparador de snapshots con corte de tiempo y
  backtest de pronósticos REALMENTE guardados antes del evento.
- `src/espn-injury-backup.ts`: watch list prepartido, sin suplantar al PDF.
- `tests/sports-pregame-research.test.mjs`: casos Nesmith/Powell, ausencia
  de look-ahead, rechazo de capturas retrospectivas en modo prospectivo,
  y validación básica de Brier/filtración temporal.
- `scripts/phoenix-sports-research-backtest.mjs`: herramienta reproducible
  para recibir un ledger JSON local. Si falta ese ledger se informa la ausencia,
  no se inventan métricas.

### Instrucciones de ejecución

```powershell
node --experimental-strip-types --test packages/core/tool-sports/tests/sports-pregame-research.test.mjs
node --experimental-strip-types scripts/phoenix-sports-research-backtest.mjs --demo
node --experimental-strip-types scripts/phoenix-sports-research-backtest.mjs "C:\ruta\captured-ledger.json"
```

Para el comando con ledger, el JSON debe ser un array de objetos con:
`eventKey, decisionAt, featuresThroughAt, kickoffAt, outcomePublishedAt,
result: won|lost|push, modelProbability?, marketProbabilityNoVig?`.
La demo representa solamente fuentes **reconstruidas** y 3/5 descriptivo;
no infiere los inputs prepartido originales de PHOENIX.
