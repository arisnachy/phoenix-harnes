# PHOENIX NHL — auditoría de cobertura de datos (16 de noviembre de 2026)

## Alcance y honestidad de las pruebas

Esta auditoría inspecciona los **adaptadores existentes en PHOENIX** y contrasta sus contratos con las rutas públicas NHL/ESPN documentadas. La verificación de payloads HTTP en vivo debe leerse desde GitHub Actions `PHOENIX NHL live endpoint proof` y `PHOENIX NHL real dossier evidence`; un HTTP 200 solo significa conectividad, **no cobertura de datos suficiente**. La ejecución por chat no aportó un snapshot JSON live reproducible de cada fuente, por lo que las tasas de cobertura actuales quedan **no medidas** hasta consultar esos artefactos. Nunca rellenar porcentajes de cobertura ficticios.

### Matriz de datos y contratos

| Bloque / granularidad | Fuente y ruta pública | Valor para decisión | Regla de integridad |
|---|---|---|---|
| Calendario por fecha | `https://api-web.nhle.com/v1/score/{YYYY-MM-DD}` | IDs NHL reales, localía y hora UTC | No usar ID ESPN como ID NHL; unión por ambos equipos + hora |
| Estadísticas por plantilla | `https://api-web.nhle.com/v1/roster/{TEAM}/{SEASON}` | Porteros candidatos, defensa y ataque | Lista del roster ≠ titulares, lesiones o líneas |
| Anotadores y creadores clave | `https://api-web.nhle.com/v1/club-stats/{TEAM}/{SEASON}/2` | Ordenar skaters por puntos y TOI real para inspeccionar primero a los líderes de ambos equipos | Solo playerId NHL **presente en el roster verificado**; NO demuestra que vaya a jugar ni que integre la línea 1 |
| Historial del club | `https://api-web.nhle.com/v1/club-schedule-season/{TEAM}/{SEASON}` | Ventanas 5/10/20, descanso, local/visita, REG/OT/SO | Solo partidos terminados antes del kickoff; no mezclar OT/SO con regulación |
| Tiros / goles de temporada | `https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId={SEASON}%20and%20gameTypeId=2&limit=100` | Tiros a favor y concedidos por juego, GF/GA | Verificar teamId, temporada, datos numéricos; **no es 5v5 xG** |
| PP / PK | `https://api.nhle.com/stats/rest/en/team/powerplay` y `.../penaltykill` con filtro temporada | Unidades especiales de ambos equipos | 4 métricas separadas, sin inventar cero si no hay registro |
| Porteros / game-log | `https://api-web.nhle.com/v1/player/{NHL_ID}/game-log/{SEASON}/2` | Apariciones recientes, saves/SA y SV% ponderado | ID NHL, ventanas de fecha antes del kickoff, contar solo saves ≤ tiros |
| Perfil jugador | `https://api-web.nhle.com/v1/player/{NHL_ID}/landing` | Totales de temporada, últimos cinco | Filtrar por fecha al recuperar historical `last5Games`; el feed actual puede contener partidos futuros respecto al replay |
| Posible titular | `https://api-web.nhle.com/v1/gamecenter/{NHL_GAME_ID}/boxscore` | Dos porteros si existe bandera explícita de inicio pregame | 404/204 antes de comenzar = `not-published`, no avería; ausencia de bandera ≠ confirmado |
| Lesiones secundarias | `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries` | Bajas publicadas para ambos equipos, con fechas | Sin grupo de un equipo ≠ sano; estado parcial hasta contrastar fuentes de club |
| Cuotas ESPN | `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=YYYYMMDD` y `summary?event={ESPN_ID}` | Moneyline con sportsbook y selección | `observedAt` de lectura actual es válido aunque no haya `updatedAt`; la casa puede cambiar precio |
| 5v5 xG / GSAx | MoneyPuck exportación CSV de juego/jugador/tiros, bajo condiciones del propietario | xGF%, xGA, goalie goals saved above expected | **No integrado automáticamente**. https://www.moneypuck.com/data.htm permite uso gratis no comercial; exige atribución y autorización para otros usos. No activar scraping ni mezclar con NHL Stats |
| Porteros probables | NHL.com club previews y proveedores editoriales como DailyFaceoff / RotoWire | Estado `expected` versus `confirmed` con fuente/hora | No es API pública oficial equivalente al roster; respetar acceso/licencia, nunca asumir confirmación |
| Líneas definitivas | Comunicaciones de clubes / medios fechados antes del encuentro | Línea 1–4 y parejas D | No inferir de roster ni del boxscore posterior |

## Hallazgos de código — causas y correcciones

1. **Pérdida de cuotas NHL:** `nhl-evidence-research.ts/quotedMarkets` exigía `updatedAt` aun si la consulta ESPN traía `observedAt` fresco. Se habilita la observación ESPNs de los últimos 15 min, preservando el criterio estricto para otras fuentes.
2. **Hockey equipo local sesgado:** el bucle de jugadores consultaba primero 3 porteros y hasta 12 skaters de casa antes de mirar al visitante; con timeout se perdían los porteros visitantes. Ahora alterna ambos equipos, primero sus porteros, y hace `landing` + `game-log` en paralelo por atleta, con pool limitado.
3. **Falta de tasas de tiros:** solo PP/PK se consultaban desde Stats REST. Ahora se añade `team/summary` para tiros/GF/GA por partido con validación por ID, sin declarar xG.
4. **W-L insuficiente:** los últimos 10 mezclaban victorias y derrotas según reglamentario/OT/SO. Se exponen contadores separados sin cambiar los marcadores.
5. **Leakage de datos futuros:** `player/landing.last5Games` se usaba como fallback sin cutoff. Ahora se filtra por `min(capture_time,kickoff)`.
6. **Confusión entre dato no publicado y fallo:** 404/204 pregame del boxscore es `not-published`; no `unavailable`, permitiendo reconsulta dirigida.
7. **Módulo de lesiones A-Q vacío:** `nhl-lab-research-handoff.ts` no incorporaba datos ESPN aun cuando `espn-injury-backup.ts` ya los descargaba para ticket. Ahora se integra sólo cuando `feedUpdatedAt` es anterior al snapshot, estado `partial`, nunca salud/lineup definitiva.
9. **Anotadores estrella omitidos por orden del roster:** el investigador elegía los primeros 8 delanteros de la respuesta NHL, no a los más productivos. Ahora consulta `club-stats` de ambos equipos, cruza IDs exclusivamente con el roster y prioriza por puntos y tiempo en hielo. Si no hay club-stats válida, conserva el orden anterior y registra la fuente ausente.
8. **Test de endpoints obsoleto:** `phoenix-nhl-adapter-live-proof.mjs` buscaba por defecto el 12-nov-2026 y el workflow lo forzaba. Ahora recorre próximos ocho días, elige un juego `FUT/PRE` y captura JSON auditable de cobertura; otro workflow consulta la fecha actual.

## Calidad y pruebas de regresión

- **Grano:** evento NHL = ID NHL de diez dígitos; snapshot de lesión = equipo ESPN + fecha publicada + fuente; historial = NHL playerId + NHL gameId, con fecha antes del kickoff.
- **No inventar datos:** ausencia de informe del club no es prueba de ausencia de bajas; `expected` no es `confirmed`; PP/PK ≠ xG/GSAx; cuota observada ≠ aceptación.
- **Control temporal:** exigir `recordedAt <= decisionAt < kickoff` para hechos de disponibilidad. Una consulta realizada el lunes no puede reescribir el estado de información del domingo.
- **Calibración:** una muestra pequeña de 3/5/10 no demuestra probabilidad de victoria. Se necesitan Brier, log-loss, CLV y backtest cronológico; mantener `approvedForBetting:false` sin modelo validado.
- **Pruebas:** `nhl-evidence-research.test.mjs` (tiros, fuentes, cuota sin `updatedAt`, prioridad de ambos porteros, filtrado de fechas), `nhl-goalie-evidence.test.mjs` (SV% ponderado), `nhl-official-starters.test.mjs` (404 = no publicado), `nhl-lab-research-handoff.test.mjs` (lesiones con corte temporal).

## Criterios de aceptación medibles para próxima auditoría

En un partido futuro con fuentes accesibles, exigir **dos rosters con porteros candidatos**, dos historiales de clubes con fechas previas, PP y PK de cada equipo o explicación de ausencia, tasas de tiros/GF/GA o explicación de ausencia, lesiones ESPN con fuente y sello temporal o estado `unavailable`, expediente de cada portero con número de apariciones y datos de saves/SA cuando existan; identidad de cuotas cotejada. Confirmaciones de porteros, scratches definitivos y xG/GSAx permanecerán como **pendientes deportivos** cuando la fuente no los publique o carezca de permiso. No bloquear el ticket cotizado porque fallen fuentes externas opcionales; mostrar la insuficiencia exactamente por pata.

**Sin una ejecución real del runtime de la laptop y un corte de prueba con JSON auditado, no se puede afirmar cobertura NHL del 100% ni que las cinco selecciones estarán listas para apostar.**

## Fase 3 — auditoría integral de rosters, disponibilidad y 5v5 (16-nov)

**La fuente NHL `/v1/club-stats/{TEAM}/{SEASON}/2` devuelve, para cada jugador del club, mucho más que puntos:** en atacantes/defensas incluye gamesPlayed, goals, assists, points, plusMinus, penaltyMinutes, powerPlayGoals, shorthandedGoals, gameWinningGoals, overtimeGoals, shots, shootingPctg, avgTimeOnIcePerGame, avgShiftsPerGame y faceoffWinPctg. Porteros: gamesPlayed, gamesStarted, wins, losses, overtimeLosses, goalsAgainstAverage, savePctg, shotsAgainst, saves, goalsAgainst, shutouts y timeOnIce. Cada campo se guarda si está presente y tiene un valor válido; los vacíos no se vuelven 0.

- **Unión:** NHL playerId del roster oficial con NHL playerId de club-stats. ESPN athleteId jamás equivale a NHL playerId. Los reportes ESPN se concilian por nombre exacto normalizado y equipo, distinguiendo coincidencias ambiguas y lesiones de jugadores ausentes del roster. Los nombres abreviados del calendario («Canucks» y «Mammoth») se comparan con aliases NHL de ESPN.
- **Disponibilidad:** estados `reported-out`, `reported-doubtful`, `reported-questionable`, `reported-day-to-day`, `reported-probable`, `reported-injured-reserve`, `not-reported`, `feed-unavailable`, `ambiguous-report`. Ningún estado del feed secundario se eleva a `officialInactiveConfirmed`. Reportes publicados después del corte prepartido se descartan. Un atleta ausente del reporte NO está confirmado sano. Un atleta ausente del roster NO se declara `out`.
- **Impacto en predicción:** marcar como revisión urgente cuando un goleador de alta producción reportado `out/questionable` tiene al menos 0.8 puntos por juego o 1,200 segundos de hielo de media; para porteros, al menos cinco partidos iniciados de temporada. Estos umbrales SOLO priorizan la investigación, NO cuantifican el cambio de probabilidad de ganar.
- **5v5 sin licencia externa:** vía `https://api-web.nhle.com/v1/gamecenter/{NHL_GAME_ID}/play-by-play`, datos del último máximo cinco partidos *finalizados* de cada club ANTES del kickoff. Acepta únicamente `situationCode=1551`, `periodDescriptor.periodType=REG` y eventos `goal`, `shot-on-goal`, `missed-shot` con dueño de evento correspondiente al atacante. Descarta `blocked-shot`: el dueño del evento puede ser el defensor. Calcula Fenwick for/against, porcentajes, tiros y goles 5v5 con N real y juegos faltantes; esto NO es xGoals ni GSAx.
- **Fuente de verdad / reproducibilidad:** la comprobación de 32 clubes y cada jugador queda en el artefacto de GitHub Actions `phoenix-nhl-full-roster-matrix` (`phoenix-nhl-full-roster-matrix.json` con todas las filas y metadatos; `.md` con cobertura por club). La ejecución diaria registra fallos de red, registros sin estadísticas y disponibilidad con fuente/fecha. Las capturas actuales no pueden aplicarse retroactivamente a boletos pasados.
- **Kira:** `sports_chat_nhl_investigate({includeFullRoster:true})` devuelve TODOS los miembros de los dos rosters, todas las métricas de temporada disponibles y estados de lesión secundarios fechados. `sports_chat_ticket_dossier_recheck` devuelve `nhlRosterAudit` y `nhlFiveOnFiveAudit` para partidos pendientes.

### Qué sigue sin estar observado y puede cambiar la selección

1. xG/xGA 5v5, calidad de tiro y GSAx por portero: requieren exportación/modelo autorizado, no se calculan sustituyendo tiros por xG. MoneyPuck publica descarga gratuita **para fines no comerciales** con atribución; un producto con otros fines debe verificar licencia.
2. Combinaciones reales de líneas 1–4, parejas defensivas y PP1/PP2: el roster y el ranking de puntos no prueban minutos ni titularidad. Recuperar en futuras mejoras fuentes de shifts y reportes del club.
3. Porteros titulares y scratches finales: NHL roster + goalie stats no identifican el titular prepartido, usar fuente fechada cuando se publique o mantener `unknown`.
4. Efecto marginal causal de cada lesión, la calidad de los rivales y la calibración de predicción: requieren backtest point-in-time y comparadores de alineación, no un umbral fijado al revisar el resultado.

**Pruebas añadidas:** `nhl-roster-integrity.test.mjs`, `nhl-five-on-five.test.mjs`, alias ESPN/NHL de lesiones, matriz 32 clubes en CI y expediente live con cobertura completa. No se declara 100% ni la selección del ganador sin medición y validación real.
