# PHOENIX Sports Intelligence — protocolo integral de investigación y ticket narrado

Fecha: 2026-11-09. Objetivo: comparar al menos 8–12 candidatos y entregar 5–6 selecciones solo cuando haya evidencia; cada pata exige fuentes, explicación de Kira, riesgos y porcentaje individual correctamente etiquetado. La investigación no garantiza aciertos ni rendimientos.

## I. Pasos comunes obligatorios por evento

1. **Identidad**: evento ID ESPN y oficial, participantes, liga, fecha UTC/Santo Domingo, localía, estado pregame y mercado.
2. **Forma**: últimos 5/10/20 partidos, calidad de rivales, resultados completos, rachas, casa/fuera, momento de la temporada y continuidad de plantilla.
3. **Sede**: estadio exacto, cancha, altitud, dimensiones, césped/superficie, techo abierto/cerrado, ventajas reales observadas en ese lugar con muestra fechada.
4. **H2H real**: partidos entre oponentes con fechas, rosters y localía; no extrapolar pequeñas muestras a una probabilidad.
5. **Cruces individuales**: portero contra tirador, bateador contra lanzador, QB contra defensa, delantero contra defensor, tenista contra rival; IDs y muestra comprobados.
6. **Disponibilidad**: plantilla, alineaciones oficiales, titulares, lesiones, sanciones, suplentes, minutos restringidos y cambios de última hora.
7. **Rendimiento avanzado**: indicadores específicos del deporte y de cada jugador; separar explicación observada de modelo predictivo.
8. **Calendario/fatiga**: descanso, back-to-back, viajes, husos horarios, partidos acumulados y motivación contextual comprobable.
9. **Clima**: temperaturas, viento, dirección, precipitación y humedad POR HORA del evento y COORDENADAS del estadio, solo si relevante; Open-Meteo y fuentes autorizadas, no aplicar al recinto indoor.
10. **Árbitros/oficiales**: asignación oficial del día, tendencias de faltas/tarjetas/penaltis/strikes y tasas ajustadas por liga, equipos, estilos y localía; jamás inferir que «favorece a un equipo» solo del win-loss observado.
11. **Noticias**: partes oficiales, ESPN News, RSS editoriales y prensa local; título, fecha, enlace, credibilidad y verificación cruzada. Rumor ≠ hecho; titulares indexados ≠ artículos leídos.
12. **Pronósticos externos**: Covers, VegasInsider, ScoresAndOdds, Dimers, Forebet o servicios licenciados, SOLO si se verificó pick, mercado, autor, hora, método y side. Nunca promediar picks sin backtest ni atribuir predicciones a un título.
13. **Odds**: comparar lado, período, hándicap, total, casa y updatedAt. ESPN puede ser referencia sin precio cotizable; cuotas de fuentes diferentes no crean boleto de una sola casa.
14. **Modelo por mercado**: ganador, spread/handicap, totales, props y mercado reglamentario vs OT; calibración temporal, rangos y baseline market/no-vig separados de probabilidad de acierto.
15. **Auditoría**: fuentes redundantes por INDICADOR, conflictos de identidad, frescura, nulos, imágenes y derechos, correlación entre patas y sustituciones por candidatos de mayor evidencia.
16. **Narración**: tarjeta deportiva visual y explicación individual de Kira con razones a favor/en contra, noticia fechada y URL, historial de estadio y H2H, árbitro, clima, porcentajes etiquetados y citas.

Cada hecho lleva: dato, unidad, eventId, entityId, venueId, instante del hecho, fecha de consulta, proveedor, URL, estado y caducidad. Estados: verified, partial, missing, conflict, stale. Un API conectado solo demuestra posibilidad de consulta, no exactitud ni completitud.

## II. Investigación específica y proveedores

### NBA / WNBA
- OFF/DEF/NET Rating, pace, eFG%, TS%, rebotes y pérdidas; rotaciones, quintetos, on/off, minutos; splits frente a defensas y jugadores; últimos 5–20; casa/fuera; back-to-back y viajes.
- Informes oficiales de lesiones, restricciones de minutos y confirmación de titulares; árbitros diarios NBA/WNBA, free throws por 100 posesiones ajustados, estilos y línea del spread.
- Modelo separado de ganador, spread, total y props. No convertir porcentaje moneyline en probabilidad de handicap.
- **Actual**: ESPN Site/Core, TheSportsDB, balldontlie opcional, ESPN lesiones. **Pendiente**: NBA/WNBA Stats y on/off robusto, quintetos confirmados, lesiones oficiales automatizadas y árbitros con datos ajustados.
- Fuentes: https://official.nba.com/ ; https://official.nba.com/referee-assignments/ ; https://www.nba.com/stats/ ; https://www.wnba.com/

### NHL
- Forma, goles, xG/xGA por 60, tiros high-danger, SV%, GAA y GSAx por portero, titulares CONFIRMADOS, días de descanso, lesiones/scratches, PP/PK y líneas por enfrentamiento.
- H2H contra rival y portero real (muestra), estadio y back-to-back; oficiales y penalizaciones por equipo (ajustado); distinguir ganador con OT/SO de ganador a 60 min y puck line ±1.5.
- **Actual**: NHL Web API, ESPN, TheSportsDB, API-Hockey/Big Balls opcionales. **Pendiente**: MoneyPuck xG/GSAx, confirmaciones de portero y oficial con datos de penalizaciones por juego.
- Fuentes: https://api-web.nhle.com/ ; https://www.moneypuck.com/data.htm ; https://www.nhl.com/

### MLB
- GamePk, pitcher abridor confirmado, ERA, WHIP, FIP/xFIP, K%, BB%, splits de lateralidad, pitch types y arsenal.
- Cada bateador vs pitcher con muestra, AVG/OBP/SLG/OPS/xwOBA, lineup actual, descanso; bullpen por relevista y carga de 24/48/72 h; defensa y catcher.
- Estadio exacto, park factor, dimensiones, techo, orientación respecto al viento, temperatura y humedad; umpire de home plate (zona BB/K ajustada, si hay fuente); H2H.
- Separar moneyline partido completo, 3/5 innings, run line -1.5/+1.5, over/under y props; confirmar reglas de la casa.
- **Actual**: MLB StatsAPI, ESPN, Open-Meteo. **Pendiente**: Statcast/Baseball Savant y matrices individuales completas, weather+roof, umpire histórico y más alternativas de lineup.
- Fuentes: https://statsapi.mlb.com/api/v1/schedule?sportId=1 ; https://baseballsavant.mlb.com/

### NFL
- EPA/play, success rate, red zone, sacks, turnovers, ataque/defensa; QB titular, OL frente a pass rush, WR/CB y RB/front seven, 22 titulares, snap counts, lesiones/inactivos.
- H2H, resultados en el estadio, clima para kickoff (sobre todo viento), viaje/descanso, crew de árbitros, penalizaciones por 100 snaps ajustadas.
- Modelo separado moneyline/spread/total/props; analizar efectos de turnovers y ventaja de QB.
- **Actual**: ESPN, nflverse, API-NFL opcional. **Pendiente**: nflverse PBP/EPA en especialista, gamebooks oficiales, inactivos y oficial del día.
- Fuentes: https://nflverse.nflverse.com/ ; https://www.nfl.com/

### Fútbol mundial
- Forma y fuerza de rival, local/visita, H2H, xG/xGA reales, jugadores, goles, porterías, onces/sanciones, esquemas, fatiga, césped, altitud, estadio y clima.
- Árbitro: tarjetas amarillas/rojas, faltas, penaltis por partido, efectos de competición y temporada, no inferir favoritismo con registros brutos.
- Modelo 1X2, riesgo de empate y doble oportunidad, BTTS, handicap, corners/cards solo con datos, distinción 90 minutos/prórroga.
- **Actual**: ESPN, TheSportsDB, OpenFootball, OpenLigaDB, football-data.org y API-Football opcionales. **Pendiente**: xG diario internacional, lineups verificados, referee por liga y lesiones.
- Fuentes: https://www.football-data.org/ ; https://github.com/hudl/open-data ; https://www.uefa.com/

### Tenis ATP/WTA
- Ranking contextual, últimos encuentros, superficie indoor/outdoor, H2H en esa superficie, servicio/return, break/hold %, aces, double faults, tiebreaks y oponentes similares.
- Carga horaria, lesiones/retiradas, velocidad de cancha, clima, juez de silla si el dato existe; reglas del operador en retiradas/walkovers.
- Modelo match winner, sets, games y handicaps por separado.
- **Actual**: ESPN, TheSportsDB y especialistas ATP/WTA. **Pendiente**: feeds estadísticos completos actuales, superficie y retiro confiables, archivo histórico Sackmann sujeto a licencia.
- Fuentes: https://www.atptour.com/ ; https://www.wtatennis.com/ ; https://github.com/JeffSackmann/tennis_atp

## III. Fuentes y redundancia real

- **Ya conectadas**: ESPN Site/Core, MLB StatsAPI, NHL Web API, TheSportsDB, OpenFootball, OpenLigaDB, nflverse y clima Open-Meteo, con cobertura desigual. RSS editorial vía Google News para Covers/VegasInsider: índice, NO scraper ni picks.
- **Opcionales/credenciales**: API-Football, API-Hockey, API-NFL, Big Balls, balldontlie, The Odds API v4, TheOddsAPI, TheRundown, SportsGameOdds.
- **Por integrar/validar**: GDELT DOC 2.0, MoneyPuck, Statcast avanzado, NBA/WNBA official injury y officiating automatizados, nflverse PBP, StatsBomb historical xG, pronósticos expertos directos y lawful/licensed.
- La redundancia debe ser específica del campo: ESPN fixture + TheSportsDB no son dos fuentes de GSAx, lineup o árbitro.
- Los 403/429, cuotas agotadas, permisos, robots y licencias no se sortean; se reportan y se utiliza fuente autorizada. Historial no equivale a estado prepartido.
- Para GDELT, consulta por lotes con caché/limites; no 5–6 llamadas concurrentes sin comprobar rate limits.
- Para noticias de terceros, conservar metadatos y no reproducir textos íntegros o fotografías sin autorización.

## IV. Política de frescura inicial (objetivo, no garantía)

| Indicador | Vigencia objetivo | Debe ocurrir |
|---|---|---|
| Calendario / hora | 4–15 minutos antes de cierre | Revalidar fecha y participantes |
| Precio real | 1–5 minutos o tiempo del proveedor | Comprobar updatedAt, mercado y casa |
| Titulares / lesiones | 10–30 minutos, y cada nuevo anuncio | Invalidar expediente tras cambios |
| Porteros / pitchers / XI | Hasta confirmación oficial | No promover probable a confirmado |
| Clima horario | 30–60 minutos | Reconsultar por coordenadas verificadas |
| Noticias | 2–12 horas y justo antes del partido | Filtrar obsoleto, rumores y noticia duplicada |
| Historial, xG y árbitros | Tras cada partido finalizado | No usar resultados futuros |

## V. Entrega visual en tarjeta + chat

Cada pata: logos, liga, horario dominicano, mercado y precio real (o sin precio), porcentaje propio exploratorio / calibrado / implícito de casa claramente separado; noticia titulada y enlazada con fecha, posible imagen de ESPN con crédito y revisión de licencia; H2H y historial de sede con tamaño de muestra; clima y oficiales **si comprobados**, riesgos y contraargumentos; status documentado o condicional.

Kira escribe individualmente: «Elegí X porque [hechos]. Lo favorece [datos con muestras]. Riesgos [contraindicios]. Antecedentes vs rival [H2H]. En este estadio [resultados]. Clima [pronóstico]. Árbitros [nombre y datos ajustados, si existen]. Noticias [título + fecha + enlace]. Pronóstico [porcentaje y origen]. Veredicto [estado]». No afirmar «me gusta porque sí», sesgo arbitral no verificado, noticia no leída o imagen sin crédito.

## VI. Alcance del código de esta ampliación

Implementado en las ramas de trabajo: contexto de ESPN News con URL e imagen permitida, sede/ciudad y lista de oficiales de ESPN, clima Open-Meteo por coordenadas/hora solo para outdoor, muestras H2H y recinto desde los resultados ESPN, descubrimiento editorial indexado Covers/VegasInsider, objeto de explicación por pata con riesgos/fuentes/porcentaje y disponibilidad para tarjeta/chat, y pruebas de seguridad y falsos positivos.

**Aún no demostrado:** CI en todos los entornos, render final de foto/texto en todas las interfaces de PHOENIX, lectura de picks verificables de terceros, estadísticas ajustadas de árbitros, H2H de cada jugador/portero, cobertura mundial de xG, ni porcentajes calibrados por todos los mercados. Configurar credenciales de monitor/email es otro flujo. Ninguno de esos elementos debe declararse terminado por aparecer aquí descrito.

## VII. Aceptación

Pasar unit tests y regresiones Node/Windows, CI TS, replay real por seis deportes, fallos intencionales de cada fuente, auditoría de imágenes/licencias, comprobación de muestras previas al inicio, cifras vs no-vig por mercado y validación de UI visual con 5–6 patas. Solo entonces habilitar merge y afirmar que quedó operativo.

## VIII. Investigación abierta y lectura editorial de resultados

El sistema deportivo activa las instrucciones de `src/sports-open-research-guidance.ts` únicamente ante una solicitud deportiva. ESPN, MLB, NHL, NBA, NFL, WNBA y el registro de conectores sirven como punto de partida, no como restricción a fuentes autorizadas adicionales. Kira utiliza las herramientas generales de búsqueda/lectura web **cuando realmente estén disponibles** para cotejar hechos decisivos de cada partido, sin afirmar lectura de un artículo a partir de su título indexado ni saltar restricciones del sitio. La guía no instala por sí misma un navegador o un proveedor.

El componente `sports_ticket_card` sigue conservando patas, mercado, casa, probabilidades correctamente etiquetadas y el expediente `chatNarrative`. En el cliente, cada pata muestra ahora de inmediato su argumento central, los datos a favor, las contradicciones y hasta tres enlaces de fuentes realmente clasificadas como verificadas o parciales. El checklist extenso continúa desplegable. Un componente sin datos reales no se sustituye por citas fabricadas y el ticket es un producto de investigación, no una apuesta confirmada.

Las pruebas focalizadas están en `tests/sports-open-research-guidance.test.mjs` y `packages/client/ui-conversation/tests/sports-ticket-explanation.client.spec.tsx`. Su aprobación y la reproducción visual real son condiciones para considerar la modificación operativa.

## IX. ESPN NBA: páginas en español y avatares de jugadores

Las páginas de ESPN República Dominicana son referencias humanas adicionales: lesiones,
estadísticas, calendario, jugadores y la plantilla Boston Celtics aportada como ejemplo.
Su inventario está en `src/espn-nba-public-pages.ts`, con marca
`reference-only`: la mera URL NO prueba que el contenido se haya leído.
En algunas sesiones ESPN RD requiere JavaScript o verificación antirrobots;
no se evaden esas restricciones.

La ruta primaria de datos es ESPN Site API v2 (`teams/{id}/roster`,
`injuries`, `scoreboard`), con Web API v3 para
`statistics/byathlete` y perfiles. El roster de Boston Celtics (`teamId=2`)
confirmó `athletes[].headshot.href` en `a.espncdn.com` el 11/11/2026.
`sports_chat_deep_research` expone `rosterPortraits` por equipo, ligado
a los IDs del encuentro; `sports_chat_espn_explore(view=team)` ya dibuja
tarjetas nativas con fotografías y estadísticas. Fotos ausentes quedan null,
sin inventar URLs. Las lesiones del roster no confirman el estado del parte
oficial del día ni el quinteto titular; el feed se coteja por separado.

Pruebas añadidas: `tests/espn-nba-public-pages.test.mjs`, escenarios de
`tests/sports-deep-context.test.mjs` para dos equipos y retratos rechazados
por origen no confiable, y regresión visual de retratos en
`tests/espn-intelligence.test.mjs`.
