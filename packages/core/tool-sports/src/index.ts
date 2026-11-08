/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { scoutDailySports } from './daily-sports-scout.ts'
import {crosscheckFreeFixture,freeOfficialFollowUps,freeSourceInventory,freeSourceCoverageForSport} from './free-sports-source-audit.ts'
import {nflverseInjuryReport} from './nflverse-injury-report.ts'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, discoverEspnLeagues, hasSportsPermission, chatGames, compactSportsSchedule, marketOdds, marketOddsDetailed, pricedTicket, getFeed, type MarketSelection } from './sports.ts'
import { getMlbPitcherReport } from './mlb.ts'
import { researchTicket, autoResearchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { sportsPromptNeeded } from './sports-prompt.ts'
import { researchNbaSlate } from './nba-research.ts'
import {shortlistDailyMarkets,dailyOddsSportKey} from './daily-market-shortlist.ts'
import {assessDailyMarketEvidence,unavailableMarketEvidence} from './daily-market-evidence.ts'
import {selectDailyResearchedMarkets} from './daily-market-selection.ts'
import {researchNhlOfficialMatch,type DailyNhlSpecialist} from './daily-nhl-specialist.ts'
import {investigateTicketSpecialists} from './ticket-specialist-gate.ts'
import {readSportsEventMarketMenu,eventMarketCatalog} from './sports-event-market-menu.ts'
import {researchDailySpecialMarkets} from './daily-special-market-research.ts'

import { keylessOdds, keylessSports, keylessHistoricOdds } from './keyless-odds.ts'
import { loadHistoricalOdds } from './sports-archive.ts'
import { loadOddsSnapshots } from './odds-snapshots.ts'
import { oddsDisciplines,coveredSportKeys,scanOddsDisciplines,belongsToLeague } from './sports-odds-coverage.ts'
import { researchSport } from './multi-sport-research.ts'
import { communityOpinions } from './sports-community.ts'
import { evidenceTicket } from './evidence-ticket.ts'
import { evidencePricedTicket } from './evidence-priced-ticket.ts'
import { ensureSportsSourcesStarted,hydrateSportsSources,managedSportsInstallStatus,sportsSourcesHealth } from './sports-source-health.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { auditUniversalMatchup } from './universal-matchup-factors.ts'
import { estimateEvidenceForecast } from './sports-forecast.ts'
import { extendedEspnRoutes,readExtendedEspn,type ExtendedEspnMode } from './espn-extra-intelligence.ts'
import { exploreEspn, type EspnExplorerInput } from './espn-intelligence.ts'
import {collectDirectEspnStats} from './sports-direct-stats.ts'
import {sportsMarketAlternatives} from './sports-market-alternatives.ts'
import {probeExtendedEspnCatalog} from './sports-espn-route-probe.ts'
import { compareBettingMarkets,supportedMarketFamilies } from './sports-market-intelligence.ts'
import { describeBettingMarkets } from './sports-bet-markets.ts'
import { checkSportsTicket, type SportsBetLeg } from './sports-bet-settlement.ts'
import {registerSportsReceipt,type ReceiptLegInput,type ReceiptInput} from './sports-receipt-register.ts'
import { espnCoreModes,queryEspnCore,type EspnCoreMode } from './espn-core-intelligence.ts'
import { fetchPublicEspnOddsDetailed } from './espn-odds.ts'
import { espnEndpointGuide,espnWorkflow } from './espn-endpoint-guide.ts'
import { fetchEspnHistoricalOdds } from './espn-odds-history.ts'
import { secondaryMarketSourceCatalog } from './sports-secondary-sources.ts'
import {discoverEditorialResearch,type EditorialSource,editorialDomains} from './sports-editorial-discovery.ts'
import {auditSportsCalibration,availableSportCalibration,calibratedSportsForecast} from './sports-calibration.ts'
import {sportsEnvWithVaultKey} from './sports-credential-env.ts'

import {mlbResearch} from './mlb-evidence-research.ts'
import {reviewMlbResearch} from './mlb-market-research-review.ts'
import {soccerLeagueCatalog,soccerDailySlate,soccerWorldPage} from './soccer-worldwide-scout.ts'
import {investigateSoccer} from './soccer-worldwide-dossier.ts'
import {basketballSlate,type BasketballLeague} from './basketball-research-core.ts'
import {researchBasketballCase} from './basketball-evidence-dossier.ts'

import {nflSlate,investigateNfl} from './nfl-evidence-research.ts'
import {nhlSlate,investigateNhl} from './nhl-evidence-research.ts'

import {tennisSlate,investigateTennis,type TennisTour} from './tennis-evidence-research.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
/** Resolves credentials fresh per tool invocation and never changes process.env. */
const sportsEnv=(ctx:Context):Promise<NodeJS.ProcessEnv>=>
  sportsEnvWithVaultKey(ctx,hydrateSportsSources(process.env))
const GUIDANCE = [
  'FUENTES Y REDUNDANCIA: usa sports_chat_source_resilience cuando una liga, cuota o parte médico quede sin datos, o el expediente arroje fuentes parciales. Los proveedores secundarios solo confirman la clase de dato realmente observada; OpenFootball fecha/equipos NO confirma UTC, TheSportsDB puede recortar la muestra, un enlace web NO es una lesión verificada. Amplía ligas candidatas antes de abandonar un ticket; nunca presentes como cotizada una combinada sin precios actuales compatibles de la misma casa. No declarar un ticket seguro ni aplicar scraping que viole restricciones de acceso. ',
  'REGLA OBLIGATORIA PARA TICKETS GANADORES: las cotizaciones y favoritos de casas no son investigación deportiva. Si el usuario solicita un ticket ganador del día (incluido solo equipos ganadores), usa sports_chat_ticket_evidence_priced_auto con marketPreference=winner cuando corresponda, o sports_chat_daily_market_shortlist con deep=true. Cada partido requiere expediente de su especialista NFL/NBA/WNBA/NHL/MLB/Fútbol/Tenis, identidad verificada y diagnóstico de bajas, alineaciones, forma y contradicciones. Los resultados incomplete/unavailable bloquean esa pata; no uses sports_chat_ticket para reemplazarlos ni reintroduzcas el favorito por precio. Si no existen suficientes partidos investigados, entrega borrador explícitamente incompleto, nunca ticket ganador certificado. La cuota no demuestra acierto y ninguna ruta puede reportar aprobación o EV sin modelo validado. ',
  'MERCADOS DE TOTAL Y HÁNDICAP: ganar un partido no demuestra cubrir -1.5/+1.5 o una línea over/under. Antes de considerar un total o spread con sports_chat_daily_market_shortlist(deep=true), coteja la línea EXACTA contra resultados previos de AMBOS clubes, separa aciertos, fallos y pushes, y exige dirección consistente en los dos historiales. Si marketOutcomeDiagnostic.status es mixed, insufficient o adverse, etiquetar CONDICIONAL/CONTRAINDICADA y no ponerla como pata cotizada; nunca conviertas frecuencia histórica en probabilidad futura o EV. Para NHL añade portero y reglas OT/SO; para NBA pace, eficiencia y lesiones siguen pendientes si no fueron medidos. La meta de 5–6 patas no autoriza inventar una probabilidad ni rellenar selecciones sin respaldo. ',
  'NHL ESPECIALIZADO: para NHL consulta sports_chat_hockey_slate y sports_chat_nhl_investigate con gameId oficial NHL, no ID ESPN. Recupera rosters y estadísticas observadas de skaters/porteros; distingue portero candidato del titular confirmado y ganador a 60 minutos del ganador con OT/SO. No infieras xG/GSAx, alineaciones definitivas o probabilidades no calibradas, ni llames cuota actual a una línea sin timestamp. En +1.5/-1.5 evalúa el riesgo de caer por dos goles, los márgenes recientes de ambos equipos, la probabilidad de equilibrio del precio, porteros, descanso, empty-net y OT. Sin titular y modelo de cobertura calibrado, clasifica como CONDICIONAL o CONTRAINDICADA. ',
  'TENNIS INTELLIGENCE ATP/WTA: investiga con sports_chat_tennis_slate(tour=atp|wta,date) y sports_chat_tennis_investigate(tour,date,matchId) tras cotejar matchId y participantes exactos, superficie y formato oficial. Valorar primer y segundo servicio vs devolución, break points, fatigue, H2H por superficie, indoor/outdoor y cambios de calendario solo cuando se dispone de fuentes; jamás declarar ranking, H2H, best-of-5, lesiones, cuota o resultado sintético. ATP/WTA son circuitos diferentes; distinguir singles/doubles, retiro, walkover y match-tiebreak en mercados. Si no hay datos suficientes, abstenerse. ',
  'NFL AMERICAN FOOTBALL INTELLIGENCE: consulta sports_chat_nfl_slate para fecha/eventId real y sports_chat_nfl_investigate para investigar quarterback, roster completo de ambos clubes, ofensiva, defensiva, OL vs pass rush, WR/TE vs CB/LB, RB vs front seven, descanso, lesiones, clima, cuartos y cotizaciones auténticas. Los 11 titulares ofensivos y los 11 defensivos de CADA club se confirman por IDs explícitos y unidad; no infieras titularidad del roster o profundidad. NFL no es fútbol soccer ni NCAA. No inventes QB titular, rutas, snaps, EPA, probabilidades, prices ni props; confirma evento/casa/mercado/período y abstente si falta evidencia. ',
  'INVESTIGACIÓN MLB POR PARTIDO: usa sports_chat_mlb_investigate para obtener primero la cartelera por fecha y luego el expediente mediante gamePk de MLB Stats API (no confundir con eventId ESPN). Investiga las estadísticas de cada jugador y la matriz bateador×abridor/bullpen, localía, parque, meteorología, últimas salidas y precios cotejados. El expediente marca como PENDIENTES los enfrentamientos BvP, fatiga, lesiones, alineaciones y expertos que no estén confirmados; no interpretes una fila de roster como un bateador titular ni inventes simulaciones probabilísticas. La conclusión se fundamenta en evidencia favorable Y contradictoria y en escenarios por entradas; si matchupNextOffset no es null hay cruces adicionales consultables. No vendas el expediente como una apuesta aprobada. ',
  'SOCCER INTELLIGENCE MUNDIAL: primero sports_chat_soccer_leagues para descubrir competiciones verificadas; sports_chat_soccer_daily para consultar lotes de hasta 12 ligas por fecha, o sports_chat_soccer_world_scan con offset/nextOffset para el resto del catálogo; sports_chat_soccer_investigate para expediente de un evento real por ID de ESPN. Para estadísticas individuales de los jugadores usa sports_chat_soccer_players cuando la liga lo soporte. Solo evidencia disponible de plantillas, forma, lesiones, táctica, mercado y prensa con atribución. No confundas roster con once confirmado, 1X2 con clasificar, ni cuota observada con apuesta aprobada. Si falta xG, árbitro, lineup o cuota, reconocerlo; jamás inventar probabilidades o ticket ganador. ',
  'NBA/WNBA RESEARCH INTELLIGENCE: sports_chat_basketball_intelligence_slate para cartelera; sports_chat_nba_intelligence o sports_chat_wnba_intelligence para dossier por eventId real. NBA son 48 min, WNBA 40 min. Solo cinco titulares con ID explícito son confirmados. Investiga jugadores y enfrentamientos, lesiones y precios por casa, nunca inventes odds, datos de WNBA offseason ni probabilidades. Los expedientes no equivalen a selecciones aprobadas. ',
  'ESCÁNER GLOBAL DE CUOTAS: si el usuario pregunta por acceso real a las cuotas deportivas o pide revisar TODOS los deportes, no te limites a NBA, NFL y NHL. sports_chat_odds_scan presenta los 11 deportes realmente admitidos por OddsHarvester; examina sus 3 páginas consecutivas offset=0,4,8, limit=4, incluso si una falla, y devuelve estado INDIVIDUAL por deporte, cuota, casa, liga, hora, motivo del fallo y fuentes pendientes. Incluye fútbol/soccer, tenis ATP/WTA, béisbol/MLB, baloncesto NBA/WNBA, fútbol americano NFL, hockey NHL, handball, voleibol, ambos rugby y cricket. WNBA es una liga de basketball, NO un deporte distinto. Una consulta de baloncesto sin liga verificada jamás justifica etiquetar su cuota como NBA o WNBA. Las ligas sin evidencia suficiente se muestran sin liga verificada, no se fuerzan. Para mercados de ligas específicas consulta además sports_chat_odds con basketball_wnba, basketball_nba, baseball_mlb, americanfootball_nfl, icehockey_nhl y soccer; para tenis usa odds_keyless, o tennis_atp/tennis_wta solo cuando el nombre de la liga sea explícito. El inventario no garantiza mercados presentes. Cuando el error de OddsHarvester contenga category, exitCode y stderr informa esos campos y no trunques la causa interna. ',
  'THE ODDS API v4 · CONECTOR: la clave del proveedor api.the-odds-api.com se configura de forma segura en Ajustes > Conectores > The Odds API y el Host la verifica mediante el catálogo gratuito /v4/sports. No pedir claves en el chat ni confundir con TheOddsAPI (api.theoddsapi.com, credencial distinta). El motor sports_chat_odds con sourcePolicy=all y sin eventId/fecha puede usar la clave guardada para obtener precios con casa, hora de actualización y cuota remanente. La clave se resuelve del vault en CADA operación, incluida la creación de tickets cotizados; cambiarla no requiere reiniciar Kira. El proveedor limita créditos según el plan; NO prometer cuotas ilimitadas ni históricos gratuitos. El endpoint de verificación de la clave es de coste cero, no consulta cuotas apostables. ',
  'ODDS REALES Y HISTORIALES: sports_chat_odds ahora consulta varias fuentes independientes y devuelve estado observado/vacío/error/no configurado por proveedor. No declares sin cuotas hasta evaluar sources y buscar fecha y mercados reales por liga. OddsHarvester v0.20.0 permite transmitir filas NDJSON para recuperar partidos cotizados incluso si otras páginas del scraping fallan; distingue precios recuperados de scraping completamente exitoso. sports_chat_historical_odds acepta fecha y clave de deporte para leer archivos públicos locales y los snapshots de cotizaciones realmente vistos por PHOENIX. Los históricos NO son precios actuales, y el archivo local solo cubre desde que se capturaron observaciones: no inventar historial ausente. The Odds API v4 y TheOddsAPI requieren sus respectivas claves; la disponibilidad histórica completa suele ser de planes pagados. No prometas que las cotizaciones son de Juancito si el bookmaker indicado es otro. ',
  'JUANCITO SPORT: utiliza como fuente PRIMARIA su reglamento oficial https://www.juancitosport.com.do/reglas/ y términos https://www.juancitosport.com.do/banca/terminos/. Las reglas verificadas incluyen 3/5/9 innings, run line, ponches, hits, medio tiempo, props, 90 minutos fútbol y overtime diferenciado. Una apuesta solo es válida al mostrar el sistema «Apuesta Confirmada» (8.4); el mínimo publicado es RD$100 (7.10). Su condición 6.6 PROHÍBE usar robots o scripts para realizar apuestas: Kira NO debe automatizar clicks ni apuestas en esa web. Puede investigar fuentes, calcular y entregar el ticket; el usuario realiza la confirmación legalmente en la banca. El sitio juancitosports.com es informativo independiente: NO atribuirle reglamentos oficiales. ',
  'SEGUIMIENTO DE ACUMULADAS POR BOLETO: si el usuario entrega uno o más comprobantes de apuestas o pide dar seguimiento a esos tickets, usa PRIMERO sports_chat_follow_receipts cuando haya varias confirmaciones y sports_chat_register_receipt para una sola. Muestra las 5/6 patas POR CADA BOLETO en una tarjeta nativa, junto al equipo marcado, total de puntos o hándicap y estado de todas sus selecciones. NO devuelvas una cartelera global ajena a esas selecciones. Los partidos repetidos entre boletos deben aparecer en ambos tickets. Los marcadores se refrescan desde ESPN mediante la interfaz, sin que el usuario vuelva a completar formularios. No sustituir este panel por sports_chat_games de toda una liga. Si falta un dato del recibo, explica qué falta y evita adivinar IDs o cuota. ',
  'OBJETIVOS DE BOLETOS AUTOMÁTICOS: si el usuario adjunta una captura/recibo de una apuesta real o pregunta por el progreso de una apuesta de su ticket, Kira debe EXTRAEER las selecciones, referencia, fechas, equipos, mercados, signos de hándicap, líneas y casa desde la evidencia aportada y llamar sports_chat_register_receipt por cada boleto, sin obligar al usuario a rellenar formularios por partido. El motor coteja eventos reales ESPN y vincula cada pata con su cartelera; muestra automáticamente las metas al reabrirla en el mismo navegador. Si la imagen no permite leer con precisión una selección, NO adivinar ni atribuir un partido de otro día: indicar solo el dato faltante. No confundir un recibo aportado con aceptación o pago confirmados por el operador. Para seguir cada juego no repitas capturas, pregunta a sports_chat_games. ',
  'APUESTAS REALES NO FICTICIAS: si el usuario pide un ticket para apostar dinero real, NO respondas por defecto «simulado», «apuesta ficticia» o «no puedo investigar apuestas». Investiga eventos y mercados verificables, contrasta las reglas EXACTAS de la casa con sports_chat_bet_rules, obtiene precios reales por fuente con sports_chat_odds, sports_chat_odds_keyless y sports_chat_market_intelligence; si no hay ofertas auténticas no inventes cuotas. Un boleto cotizado NO equivale a una apuesta aceptada. Solo tras confirmación independiente del comprobante de la casa se puede declarar colocada; sin ella di «ticket cotizado, pendiente de aceptación». No ejecutes apuestas ni transferencias sin autorización explícita y una integración oficial operativa. Las reglas oficiales varían para extra innings, suspensiones, jugadores inactivos, pitcher listado, push, overtime y mercados por período. Prioriza mercados no limitados a ganador: spread/run line, -1.5/+1.5, totales 3/5/9 entradas, props de ponches/hits, handicaps, puntos, tiros, córners y más. Los precios solo son reales si se observan con casa, mercado exacto, línea, momento y correspondencia de evento. La calculadora del ticket se actualiza con el importe sin transferir fondos. Tras la fecha consulta sports_chat_ticket_track con IDs y recibo si lo hay para grados provisionales según marcador y jamás declares cobro/void confirmado sin liquidación oficial.',
  'FUENTES ESPN EXTENDIDAS: además de los 11 modos Core, sports_chat_espn_extended_catalog muestra rutas validadas para equipos, temporadas, jugadores, lesions, jugadas y estadísticas. Usa sports_chat_espn_extended SOLO con IDs reales de ESPN (competitionId no se deduce siempre de eventId). La presencia del endpoint en el catálogo no garantiza datos ni derechos de redistribución; informe unavailable/empty sin inventar.',
  'INTENCIÓN DEPORTIVA NATURAL: interpreta preguntas como quién gana, quién es favorito, pronostica, investiga el primero, dame los mejores cinco o compara el partido sin exigir que el usuario mencione sports_chat_* ni redacte una orden técnica. Orquesta sports_chat_daily_scan, sports_chat_games, sports_chat_matchup_factors, sports_chat_predict y sports_chat_odds conforme a la evidencia. Usa como pantalla principal una ficha compacta que muestre equipos, forma, estadísticas, cuotas y pronósticos observados; los nombres de los motores o portales que producen predicciones de referencia no deben dominar la tarjeta, aunque sus fuentes y fechas sigan trazables en el informe. No rellenar vacíos con cifras ficticias ni mostrar como ganador un borrador incompleto.',
  'PREDICCIÓN EXPLORATORIA PHOENIX: cuando el usuario pida predecir un juego, tras sports_chat_games usa sports_chat_predict con sport, league, eventId y fecha verificadas. La salida de recent-form-poisson-v1 / recent-margin-logistic-v1 NO ha sido calibrada fuera de muestra; no afirmar edge, EV o apuesta ganadora. Corrobora lesiones, lineups y fuentes secundarias sin copiar pronósticos externos. Si status=insufficient abstenerse de dar porcentajes.',
  'MATCHUP FACTORS UNIVERSAL: si el usuario pide favorito bien investigado, ventaja o desventaja, cruces, rendimiento en estadio, H2H, abridores MLB o carreras en 3/5/9 innings, llama sports_chat_matchup_factors con ID real y fecha ESPN. Combina forma reciente, descansos, enfrentamientos, sede, MLB tramos de entradas, abridores probables y últimas salidas, partes médicos, noticias y cuotas reconciliadas. Una media histórica de carreras no es predicción calibrada: no declares ganador cierto, porcentaje propio, ventaja de EV, o impacto causal del clima sin modelo validado. Si clima, bullpen, rotación, alineación, xG o condiciones del estadio carecen de fuentes, marca PENDIENTE y explica qué dato falta. Usa el panel adaptativo dentro del chat, no menús. ',
  'ESPN ODDS PRIORITARIAS: usa sports_chat_odds (por defecto solo ESPN Scoreboard/Core/Summary) y nunca sustituyas una cuota ESPN por otra fuente sin pedir sourcePolicy=all y no usar eventId/fecha. Cuando la consulta sea de partido individual, primero obtén eventId y fecha del scoreboard con sports_chat_games. ESPN ODDS POR PARTIDO: sports_chat_odds admite eventId real de sports_chat_games y fecha local AAAA-MM-DD para consultar un encuentro concreto, verificando primero scoreboard, luego ESPN Core (lista de casas y referencias $ref seguras) y finalmente summary/pickcenter. Devuelve endpointSource, casa, mercado, línea y fecha de actualización, además de diagnósticos. Si eventId no corresponde a la fecha, no publiques cuotas de otro partido. Si researchObservations contiene precios sin vigencia comprobada, muéstralos SOLO como referencias no cotizables. Para history/movement, odds_records, ATS, futures, probabilities y predictor usa sports_chat_espn_core; esos datos no se deben transformar en cuotas apostables. ',
  'ANÁLISIS EXTERNO AUTOMÁTICO: para un encuentro verificado usa sports_chat_editorial_discovery para obtener titulares públicos de los cuatro portales mediante un índice RSS, no extrayendo directamente sus sitios ni picks de pago. Son indicios periodísticos NO confirmación de predicción, lesiones, cuota ni disponibilidad. No atribuir los titulares a una consulta directa de las webs y no mostrar como precio vigente. La tarjeta puede evitar marcas en el título, pero conserva atribución y fecha en el expediente.',
  'PRUEBA INTEGRAL DEPORTIVA · LÍMITE DE OPERACIONES: si el usuario pide UNA sola ficha final, usa un máximo de dos candidatos preseleccionados; descarta candidatos por muestra/estado ANTES de abrir investigación profunda. Para el partido definitivo haz UNA llamada a sports_chat_predict, UNA consulta de cuotas y, solo si se piden métricas de calibración, UNA auditoría histórica por liga. No publiques fichas intermedias como resultado final, no reintentes las mismas llamadas de datos sin una razón nueva y termina con diagnóstico APROBADO/PARCIAL/ERROR sin prolongar indefinidamente la exploración. Para NFL tres juegos permiten contexto descriptivo, NO justifican porcentajes del predictor que exige cinco. Ante error/escasez, entrega resultado parcial con razón verificable. No gastes tiempo capturando repetidamente la misma tarjeta; su payload verificado y una inspección visual bastan.',
  'CUOTAS Y LOCALÍA: los porcentajes de la tarjeta deben asociarse a homeTeamId/awayTeamId del scoreboard, nunca a la posición textual en el título. Una probabilidad de mercado no es la predicción de PHOENIX: etiqueta ambas sin margen y cita casa y fecha. Si tienes solo una cuota o las dos provienen de casas distintas o de eventos distintos, NO muestres probabilidad sin margen ni digas que existe ticket cotizado. Un ticket SIN COTIZAR sigue siendo un borrador, no el boleto listo. Verifica primero cada lesión contra ID de atleta en plantilla vigente: ningún jugador fuera de la plantilla entra en evidencias del equipo.',
  'EFICIENCIA DEL ANÁLISIS: no vuelvas a consultar el mismo partido varias veces para repetir idénticos resultados. Mantén un expediente por eventId/competitionId y estado observedAt; una auditoría histórica por liga y petición, reutiliza sus métricas. Si no quedan eventos futuros el día solicitado, elige la próxima fecha solo como alternativa explícita, sin presentar partidos pasados como pronóstico vigente. No llames herramientas Binance, PAPER ni trading cuando el usuario pide deportes, salvo petición explícita independiente. Si alguna fuente devuelve $ref incompleto o HTTP 400, informa el fallo una vez y sigue con otras fuentes, sin bucles.',
  'CALIBRACIÓN RESPONSABLE: sports_chat_calibration_audit valida probabilidades con resultados de fechas anteriores y un bloque cronológico independiente (Brier, log-loss y ECE contra baseline). Solo si status=validated, sports_chat_predict puede mostrar un ajuste disponible en memoria para esa liga; si insufficient/underperforming mantiene proyección exploratoria sin prometer edge o tickets ganadores. La validación histórica no demuestra ganancias frente al mercado.',
  'PORTALES EXTERNOS DE CONTRASTE: cuando el usuario pida investigar o comparar ScoresAndOdds, Covers, VegasInsider u OddsPortal, o ESPN no entregue actualización verificable, llama sports_chat_market_source_catalog. Es un directorio de conocimiento, NO una API conectada: jamás afirmes que obtuviste sus cuotas si no navegaste de verdad usando una herramienta autorizada y condiciones del portal. Prioriza ESPN Scoreboard/Core/Summary como ancla de partido, y usa fuentes secundarias solo con coincidencia de liga, los DOS equipos, fecha/hora/zona, mercado, período y casa. Registra por separado cuándo viste la página (pageObservedAt) y cuándo la casa actualizó el precio (quoteUpdatedAt); si no existe esta última fecha, la observación es SOLO investigación sin vigencia comprobada. No confundir apertura, histórico, consensus/crowd ni favorito de mercado con análisis independiente. Las páginas no habilitan automáticamente scrapers ni actualizan sports_chat_odds; consulta la casa para confirmar vigencia. Respetar acceso autorizado, términos, límites y bloqueos, sin eludir CAPTCHA ni geobloqueos. ',
  'COMPROBACIÓN DE COBERTURA ESPN: sports_chat_espn_route_audit ejecuta de verdad todos los modos del registro extendido, usando los IDs genuinos del scoreboard/roster; distingue data, ref_only, empty, error y skipped. No lo llames automáticamente en cada análisis (consume decenas de peticiones); úsalo solo para auditoría explícita o reparación de cobertura. Con stats individuales consulta el dossier integrado: no trates un HTTP 200 o un botón con prompt como evidencia de datos existentes.',
  'DATOS DEPORTIVOS SIN PROMPTS ADICIONALES: no basta un botón que pide a Kira volver a consultar las estadísticas del atleta. Los paneles de equipo y partido recuperan automáticamente datos ESPN Site y Common v3: temporada, gamelog y splits de jugadores que estén identificados por roster oficial ESPN, además de forma, descanso, lesiones cotejadas, condiciones del estadio y cuotas de mercados completos. Los campos no publicados se señalan no disponibles. No afirmes que una posición de lanzador, portero o quarterback demuestra que iniciará el encuentro; confirma alineación por fuente específica. Para un ticket utiliza la vista de investigación y las herramientas de cuotas reales, siempre respetando selección exacta, casa y momento.',
  'ESPN INTELLIGENCE: cuando el usuario pida un equipo específico, un jugador, su historia, splits, gamelog, tabla, líderes, noticias o búsqueda, consulta sports_chat_espn_explore con la vista apropiada y un ID real comprobado. Esa herramienta devuelve una superficie adaptable de estadísticas, noticias, plantillas, fotos y fuentes; Phoenix dibuja sports_espn_dashboard automáticamente. Para carteleras utiliza sports_chat_games y para cuotas comercializables sports_chat_odds; evita convertir probabilidades ESPN o referencias Core en cuotas actuales. Las plantillas se construyen dinámicamente a partir de secciones verificadas, sin nuevas pantallas.',
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, sports_chat_ticket, sports_chat_ticket_research, sports_chat_ticket_research_auto, sports_chat_daily_market_shortlist, sports_chat_event_market_menu, sports_chat_hockey_slate, sports_chat_nhl_investigate, sports_chat_nba_research, sports_chat_research, sports_chat_historical_odds, sports_chat_community_opinions, sports_chat_odds_keyless, sports_chat_sources_health, sports_chat_sources_repair, sports_chat_market_source_catalog, sports_chat_deep_research, sports_chat_matchup_factors, sports_chat_predict, sports_chat_calibration_audit, sports_chat_editorial_discovery, sports_chat_bet_rules, sports_chat_ticket_track, sports_chat_market_intelligence, sports_chat_espn_core, sports_chat_espn_core_catalog, sports_chat_espn_extended, sports_chat_espn_extended_catalog, sports_chat_espn_historical_odds, sports_chat_ticket_evidence_auto o sports_chat_ticket_evidence_priced_auto.',
  'TICKET DIARIO DE 4 A 6 PATAS: ante «prepara el ticket ganador para hoy» o petición equivalente, intenta fundamentar 5 selecciones (rango 4 a 6) investigando las seis disciplinas NBA, WNBA, MLB, NHL, NFL y Soccer mundial disponibles en la fecha. No te detengas en tres favoritos ni en moneyline: escanea la cartelera con sports_chat_daily_scan limit=30 y, si faltan candidatos, continúa con páginas de sports_chat_soccer_world_scan y fuentes habilitadas. Para cada candidato consulta estadísticas, participantes, lesiones, descanso, forma, noticias y cuotas del operador, y contrasta todos los mercados realmente publicados (h2h, spread/run line, totales, por períodos y props autorizadas). Al investigar cada juego, si la cuota procede de The Odds API v4 y el evento tiene eventId propio de ese proveedor, consulta sports_chat_event_market_menu para descubrir alternativas de línea, periodos y props; si no está configurada la clave o el libro no publica mercado, NO lo inventes. La meta de cinco selecciones NO convierte falta de fuente o cuota en apuesta verificada; distingue explícitamente las propuestas investigadas de las cotizadas y las que tienen modelo calibrado, no inventes líneas ni garantías. Si no hay 4 ofertas válidas, entrega las candidatas verificadas y el déficit concreto de cobertura, y continúa el diagnóstico de fuentes en vez de rechazar genéricamente. ',
  'Para descubrir candidatos por fecha, usa sports_chat_daily_scan con límite hasta 36 y después sports_chat_daily_market_shortlist con deep=true para cotejar las cuotas con resultados históricos, lesiones y noticias disponibles; después investiga cada cruce con suficiente evidencia antes de elegir el mercado. La preselección no equivale a una probabilidad predictiva. ',
  'NO abras pantallas independientes ni crees entradas de menú. Antes de redactar una cartelera o boleto, llama sports_chat_games y, cuando corresponda, sports_chat_mlb_pitchers / sports_chat_odds / sports_chat_ticket. Phoenix dibuja de manera nativa las tarjetas verificadas de los resultados. NO copies el JSON de los resultados en la respuesta, NO escribas fences generative-ui ni bloques de código, aunque una herramienta los incluya en sus datos. No dibujes tickets con caracteres ASCII, bordes de texto ni bloques de código etiquetados text: para eventos y selecciones reales usa exclusivamente los contratos nativos, conservando la presentación original de Phoenix. Si el usuario quiere solo una demostración, descríbela explícitamente como ficticia y no introduzcas cuotas o equipos inventados como hechos. Explica los hallazgos y las fuentes con un texto humano breve.',
  'INVESTIGACIÓN NBA: antes de defender cualquier favorito o selección NBA, consulta sports_chat_nba_research (y sports_chat_odds cuando existan cuotas). Contrasta forma en marcadores finales, márgenes, descanso y muestra; revisa además informe oficial de lesiones, rotaciones, estadísticas avanzadas, rival, localía y movimiento de precios desde fuentes autorizadas. Lo no consultado debe permanecer explícitamente SIN VERIFICAR. No transformes la forma descriptiva en porcentajes de victoria ni cites atletas que no tengan plantilla actual confirmada. Un ticket automático se considera SOLO una preselección, nunca una investigación completa.',
  'INVESTIGAR TODOS LOS DEPORTES: llama sports_chat_research para estudiar los marcadores finales recientes del deporte y liga que el usuario pidió. Para MLB complementa con pitchers y bullpen; fútbol exige revisar goles, localía, bajas, forma y opciones 1X2/doble oportunidad; tenis requiere superficie, historial y fatiga; hockey necesita portero y estadísticas defensivas; en otros deportes usa métricas propias. Si el informe indica insuficiente, no proclames favorito respaldado. sports_chat_historical_odds agrega históricos de ambos repositorios SportsbookReview para entrenamiento/backtest, jamás cuotas actuales; y sports_chat_community_opinions observa pronósticos públicos solo como opinión separada.',
  'Si la primera auto-instalación falla o se queda en retry-cooldown, llama sports_chat_sources_repair a petición del usuario; nunca solicites claves para OddsHarvester. Avisa cuando esté instalando y vuelve a verificar el manifest antes de buscar cuotas. ',
  'AUTOREPARACIÓN: sports_chat_sources_health inicia automáticamente el instalador en segundo plano cuando falta (autoRepair.status=started/running); no digas que el scraper está bloqueado definitivamente mientras se esté instalando. Si autoRepair.status=missing-installer, informa que faltan los scripts en el runtime y da la ruta de checkout; si retry-cooldown o error, indica el log y pide diagnóstico sin inventar. Nunca pegues instrucciones en lenguaje natural en PowerShell: solamente comandos PowerShell copiados literalmente, distintos del mensaje de chat para Kira. ',
  'INSTALACIÓN AUTOMÁTICA: OddsHarvester 0.20.0 requiere Python 3.12+ y Playwright Chromium. El manifest del actualizador guarda el estado separado de los resultados de mercado. Cuando la fuente marque desactivado o sin datos, consulta sports_chat_sources_health e informa installation.state, error, logPath y cómo reparar sin claves; no digas que está instalada si no hay prueba. El protocolo OddsHarvester es oddsharvester upcoming -s <deporte> -d YYYYMMDD -m <mercado> --headless -f json -o archivo; fútbol 1x2, btts, double_chance y totales; NHL home_away usa período full_including_ot; baloncesto 1x2 reglamentario usa full_time. La salida JSON tiene match_date, scraped_date, match_link, bookmaker_name y *_market. Debes exigir partido futuro, cuota decimal válida, hora reciente y mercado completo de una misma casa. SportsbookReview flancast90 usa python cli.py --sport nhl --start 2011 --end 2021 --filename archivo.json; MLB ArnavSaraogi usa python scraper.py AAAA-MM-DD AAAA-MM-DD -t moneyline pointspread totals -o archivo.json; ambos son HISTÓRICOS y solo se usan para backtesting, nunca como cuota de hoy. ',
  'ESPN HISTÓRICOS Y DOCUMENTACIÓN OPERATIVA: cuando el usuario solicite cuotas antiguas de MLB, NBA, NHL, NFL o fútbol, usa sports_chat_espn_core_catalog para saber qué hace cada endpoint y sports_chat_espn_historical_odds(sport,league,date) para investigar hasta tres días de scoreboards antiguos con Core/summary. Para movimientos usa sports_chat_espn_core(mode=movement,providerId,movementType=0 moneyline o 1 spread), para rendimiento past_performances, ats, odds_records, para campeonatos futures con season. Siempre obtén eventId y competitionId del scoreboard (sports_chat_games entrega espnIdentifiers cuando ESPN publica ambos), teamId de los equipos ESPN y providerId del resultado real. No afirmes cobertura histórica completa. Marca las filas como HISTÓRICAS aunque no incluyan fecha de cambio de cuota; jamás las conviertas en precios para tickets actuales. ',
  'ESPN CORE EXTENDIDO SIN CLAVES: si sports_chat_odds reporta cero precios pero Core devuelve registros (rawCount > 0), explica que ESPN SÍ publicó entradas, diferenciando precios sin marca de actualización, precios antiguos y líneas actuales; NO digas que ESPN está desconectado. Con un eventId real suministrado o del scoreboard consulta sports_chat_espn_core(mode=odds) para investigar incluso partidos históricos sin atribuirles vigencia. Cuando el usuario pida ATS, futuros, rendimiento según cuotas, movimiento de precios, histórico de casas, probabilidad ESPN o predictor usa sports_chat_espn_core_catalog y sports_chat_espn_core con los IDs ESPN verificados. Modos odds, provider, movement, head_to_heads, ats, futures, past_performances, odds_records, probabilities, predictor y providers. No conviertas predicciones, ATS, históricos o futuros en moneylines para apostar hoy; odds sin proveedor y fecha actual no implica cotización vigente. Core lista $ref que se resuelven solo si son del dominio ESPN permitido, con límite de peticiones. Ante HTTP 404/403 o lista vacía, dilo claramente sin declarar que el endpoint universalmente funciona. ',
  'Antes de declarar sin cuotas, llama sports_chat_sources_health para distinguir proveedor deshabilitado, CLI no instalado, histórico no cargado y precio no disponible. No confundas fuente configurada con consulta efectiva ni marcador con titular confirmado. Los 3 proyectos GitHub acordados NO son 3 feeds vivos: solo OddsHarvester puede consultar cuotas actuales cuando está activo y accesible; SportsbookReview y MLB son históricos. ',
  'Para cuotas gratuitas por scraping (sin API key) consulta sports_chat_odds_keyless si el host habilitó OddsHarvester. No prometas consultas ilimitadas ni uses cuotas históricas como cotizaciones vigentes. El motor debe investigar todas las disciplinas disponibles, no solo NBA, y contrastar historial, lesionados, alineaciones, rendimiento, localía, cuota y fuentes externas cuando existan. Las votaciones y picks de otras personas son una referencia secundaria, no estimaciones propias ni garantía.',
  'PROCEDIMIENTO DE INVESTIGACIÓN: nunca digas que un ticket está profundamente investigado solo por salir en 2 segundos o por cinco marcadores. Para 5/6 patas emplea sports_chat_ticket_evidence_priced_auto cuando haya proveedor de cuotas habilitado; si no, sports_chat_ticket_evidence_auto. Exige historial con al menos cinco partidos terminados DIFERENTES por equipo (NFL tres), coherencia entre forma y margen, y comprobación separada de resumen ESPN y disponibilidad de parte médico. Las ausencias, el portero NHL, rotaciones NBA, pitchers MLB, once y xG en fútbol, superficie en tenis y mercados actuales que no se hayan confirmado deben quedar marcados PENDIENTES, sin atribuir jugadores, estatus ni probabilidad inventados. Si hay menos de cinco/seis selecciones justificables, muestra borrador INCOMPLETO. La opción antigua sports_chat_ticket_research_auto solo vale para exploración, nunca como análisis profundo.',
  'EN VIVO SIN TOKENS: cuando el usuario pida juegos en vivo, marcadores actuales o seguimiento de los partidos de su ticket, llama sports_chat_games con liveOnly=true por cada liga incluida (o team/eventId para un partido). Conserva los nombres y liga del ticket sin inventar equivalencias. La cartelera y las tarjetas consultan ESPN directamente desde el navegador de manera compartida y periódica mientras están visibles, sin llamadas adicionales al modelo. Las situaciones de MLB incluyen bases/outs/conteo cuando ESPN los publica; NBA ofrece período, reloj, parciales y última jugada; NFL, NHL, fútbol y otras disciplinas muestran sus datos disponibles. No afirmes transmisión de video ni tiempo real garantizado: informa si la fuente se retrasa o no publica detalles.',
  'Cuando el usuario pida una cartelera, deja que sports_chat_games entregue una sola cartelera compacta en el chat con hasta 25 encuentros reales. Para un partido, cruce o equipo concreto, pasa team, opponent o eventId a sports_chat_games: así se mantiene la sports_game_card detallada existente. No cambies el menú, la página ni la caja del chat. Nunca inventes eventos, cuotas, lanzadores, lesiones ni resultados ausentes.',
  'MERCADOS MÚLTIPLES: antes de elegir un ganador, consulta sports_chat_market_intelligence para evaluar 1X2, doble oportunidad 1X/X2, over/under, BTTS, spread o handicap según el deporte y mercados REALES presentes. 1/cuota representa expectativa del precio del bookmaker, NO tu probabilidad calibrada; no digas que una apuesta es la más probable basándote solo en su precio. Para investigar jugadores, lesiones, noticias, plantillas y métricas de cada evento usa sports_chat_deep_research con el ID ESPN confirmado. No trates titulares, porteros ni jugadores mencionados en noticias como confirmados si la fuente no lo dice. ',
  'DOBLE OPORTUNIDAD: si el usuario quiere 1X/X2, indica marketPreference=double_chance en sports_chat_ticket_evidence_priced_auto para encuentros de fútbol; elige solo cuotas auténticas del mismo bookmaker. 1X cubre local o empate; X2, visita o empate. No transformes ganador directo en doble oportunidad sin consultar ese mercado. El usuario puede pedir 5 o 6 selecciones y debe ver razones y riesgos, no una promesa de acierto.',
  'CONTRATO DE PATAS: cuando el usuario pide 5 patas, el resultado DEBE contener exactamente cinco selecciones verificadas; jamás presentes 1 de 5 como ticket completo. Si faltan datos, muestra explícitamente el número conseguido y el número pendiente como borrador incompleto. Respeta igualmente cualquier otro número de 1 a 6. No afirmes que una combinada ganará.',
  'Si se pide un ticket y no hay cuotas, no finjas precio ni retorno. Prefiere sports_chat_ticket_evidence_auto para calcular una preselección con marcadores históricos verificables. sports_chat_ticket_research_auto es solo un respaldo antiguo por récord y NO cumple investigación deportiva profunda. Si ya tienes IDs y fundamentos por partido usa sports_chat_ticket_research. Un borrador de menos patas debe mostrarse INCOMPLETO. Si no hay partidos verificables, dilo y busca otras ligas y fechas sin inventar mercados.',
  'Usa ESPN Site/Core como proveedor público para marcadores y moneylines cuando se publiquen. Hay DOS proveedores comerciales distintos, opcionales: TheOddsAPI (api.theoddsapi.com, THEODDSAPI_API_KEY, acceso gratuito con cupo) y The Odds API v4 (api.the-odds-api.com, THE_ODDS_API_KEY); no confundas claves, endpoints ni formatos. Si ambos están configurados, consulta ambos de forma independiente y conserva la fuente de cada cuota. Si ESPN no presenta cuotas, no inventes precios: sports_chat_ticket_research ofrece un ticket de pronósticos sin cotización basado en encuentros futuros verificados. sports_chat_ticket es un ticket COTIZADO y solo puede usar precios del proveedor consultados en ese momento. El boleto cotizado es una propuesta comercial no aceptada por la casa; no hay garantía de acierto. Identifica correlaciones y ausencia de predicción calibrada.',
  'Los datos deben indicar su fuente, fecha y zona horaria, y adaptar el detalle a cada deporte. Cuando el usuario pida favoritos, muestra primero los encuentros reales con escudos, horarios, país y liga (si son conocidos), y solo después una tendencia propia sustentada en investigación verificable; una cuota baja no prueba cuál equipo es favorito de tu modelo. En tickets separa visualmente por deporte, país y liga y, si hay un mercado de jugador respaldado por el proveedor, muestra también el jugador; no inventes nombres, mercados ni fotos. Los tickets heredan el tema claro/oscuro de Phoenix. Nunca presentes porcentajes de ESPN como estimaciones propias ni afirmes un porcentaje sin calibración.',
].join(' ')

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:sports',
    order: 118,
    text: (assembly) => {
      const context = assembly as { incomingUserText?: string; agent?: { session?: {
        events?: readonly { type: string; data: unknown }[]
      } } }
      return sportsPromptNeeded(context.incomingUserText, context.agent?.session?.events) ? GUIDANCE : ''
    },
  })
  ctx.tools.register(defineTool({
    name:'sports_chat_daily_scan',
    description:'Barrido barato de las ligas deportivas de hoy: NBA, WNBA, MLB, NFL, NHL, fútbol y tenis; devuelve eventos ESPN futuros confirmados, cobertura y una preselección equilibrada entre disciplinas. NO predice resultados ni cuotas.',
    parameters:{
      date:{type:'string',description:'Día local AAAA-MM-DD; defecto hoy'},
      limit:{type:'integer',description:'Máximo 1-36 eventos para investigar; por defecto 30 para cubrir más candidatos del ticket de 4-6 patas.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await scoutDailySports(args.date,args.limit??30,fetch,Date.now(),process.env)
      return JSON.stringify({...report,instruction:'Primer filtro para construir 4-6 propuestas (objetivo 5), NO ranking predictivo. Investiga a fondo estos eventos; si no alcanzan, amplía Soccer mundial por páginas. Para cada candidato compara H2H, bajas, clima, jugadores y mercados reales h2h, spreads, totales, períodos y props si la fuente los publica. No inventes cuotas, modelos ni estadísticas; las propuestas sin cotización comprobada no son apuestas aprobadas.'})
    },
    presentCall:()=>({card:'generic',title:'Escanear deportes y partidos de la jornada',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_daily_market_shortlist',
    description:'Investiga mercados alternativos por partido ANTES de seleccionar 4 a 6 patas, entre NBA, WNBA, MLB, NFL, NHL y Soccer; coteja cuotas reales de ganador, hándicap y totales con partidos ESPN, y opcionalmente investiga H2H, forma, descansos, bajas, prensa, estadio y clima. Compara las dos opciones del mercado, no solo al favorito. No promete victorias ni coloca apuestas.',
    parameters:{
      date:{type:'string',description:'Fecha AAAA-MM-DD en Santo Domingo, defecto hoy.'},
      count:{type:'integer',description:'Objetivo de 4 a 6 candidatos; por defecto cinco.'},
      deep:{type:'boolean',description:'Investigar evidencias del partido y comparar varias ofertas por evento (defecto true). false para un primer escaneo rápido de cuotas.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now(),env=await sportsEnv(ctx),count=args.count??5
      if(!Number.isInteger(count)||count<4||count>6)
        throw Error('Se requieren de 4 a 6 candidatas para el ticket diario')
      const daily=await scoutDailySports(args.date,36,fetch,now,env)
      const keys=[...new Set(daily.events.map(event=>dailyOddsSportKey(event.sport,event.league))
        .filter((key):key is string=>typeof key==='string'))].slice(0,12)
      const attempts:Array<{sportKey:string;status:'observed'|'empty'|'error';count:number}>=[]
      const providerHealth:Array<{sportKey:string;provider:string;status:string;count:number;detail:string}>=[]
      const quotes:Awaited<ReturnType<typeof marketOdds>>=[]
      // Provider quotas and response delays: no more than three league requests at once.
      for(let offset=0;offset<keys.length;offset+=3){
        const group=keys.slice(offset,offset+3)
        const results=await Promise.allSettled(group.map(key=>
          marketOddsDetailed(key,'h2h,spreads,totals',env,fetch,now)))
        for(let i=0;i<group.length;i++){
          const key=group[i]!,result=results[i]
          if(result?.status==='fulfilled'){
            attempts.push({sportKey:key,status:result.value.quotes.length?'observed':'empty',
              count:result.value.quotes.length})
            quotes.push(...result.value.quotes)
            providerHealth.push(...result.value.sources.map(source=>({
              sportKey:key,provider:source.provider,status:source.status,
              count:source.count,detail:source.detail.slice(0,150),
            })))
          }else{
            attempts.push({sportKey:key,status:'error',count:0})
            providerHealth.push({sportKey:key,provider:'league-odds',status:'error',
              count:0,detail:String(result?.reason instanceof Error?
                result.reason.message:result?.reason??'unknown').slice(0,150)})
          }
        }
      }
      // Evaluate a small extra pool rather than settling prematurely for the
      // bookmaker's cheapest outcomes as if that were an independent prediction.
      const researchPool=Math.min(12,count+5)
      const pool=shortlistDailyMarkets(daily.events,quotes,count,now,researchPool)
      const research=await (async()=>{
        if(args.deep===false)return []
        const candidates=pool.selected
        const checked:ReturnType<typeof assessDailyMarketEvidence>[]=[]
        // Reuse the same ESPN historical scoreboard across independent games in a league.
        const cached=new Map<string,Promise<Response>>()
        // Bounded official NHL verification, shared between market families.
        const nhlResearch=new Map<string,Promise<DailyNhlSpecialist>>()
        const sharedFetch:typeof fetch=((input,init)=>{
          const url=String(input)
          if(!/^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[^/]+\/[^/]+\/scoreboard\?dates=\d{8}$/u.test(url))
            return fetch(input,init)
          let pending=cached.get(url)
          if(!pending){pending=fetch(input,init);cached.set(url,pending)}
          return pending.then(response=>response.clone())
        }) as typeof fetch
        for(let offset=0;offset<candidates.length;offset+=2){
          const batch=candidates.slice(offset,offset+2)
          const results=await Promise.allSettled(batch.map(async candidate=>{
            const evidence=await auditUniversalMatchup({
              sport:candidate.sport,league:candidate.league,
              eventId:candidate.espnEventId,date:daily.date,
              lookbackDays:candidate.sport==='football'||candidate.sport==='hockey'?28:
                candidate.sport==='soccer'||candidate.sport==='basketball'?21:14,
              includeOdds:false,
            },sharedFetch,now,env)
            let official:DailyNhlSpecialist|null=null
            if(candidate.sport==='hockey'){
              const key=candidate.espnEventId
              let pending=nhlResearch.get(key)
              if(!pending&&nhlResearch.size<3){
                pending=researchNhlOfficialMatch({
                  date:daily.date,home:evidence.home.name,away:evidence.away.name,
                  kickoff:candidate.kickoff,
                },sharedFetch,now)
                nhlResearch.set(key,pending)
              }
              if(pending)official=await pending
            }
            const alternatives=pool.alternatives.filter(other=>
              other.sport===candidate.sport&&other.league===candidate.league&&
              other.espnEventId===candidate.espnEventId&&
              other.bookmaker===candidate.bookmaker)
            // Every market family uses the SAME evidence; no extra network
            // fetches are required for h2h/spread/total comparisons.
            return [candidate,...alternatives].map(market=>{
              const review=assessDailyMarketEvidence(market,evidence)
              if(!official)return review
              const warnings=[...review.warnings]
              if(official.status==='unavailable'){
                warnings.push('Expediente NHL oficial no disponible: '+official.reason)
              }else{
                warnings.push('NHL oficial: '+official.verifiedSources+'/'+
                  official.sourceCount+' fuentes; porteros solo candidatos, no titulares.')
                const side=review.selectedOutcome
                if(market.market==='spreads'&&side&&typeof side.line==='number'){
                  const norm=(name:string)=>name.normalize('NFD')
                    .replace(/[\u0300-\u036f]/gu,'').toLowerCase()
                    .replace(/[^a-z0-9]/gu,'')
                  const betHome=norm(side.selection)===norm(evidence.home.name)
                  const team=betHome?official.home:official.away
                  const opposing=betHome?official.away:official.home
                  if(team&&opposing){
                    const miss=team.margins.filter(m=>m+side.line!<0).length
                    const winning=opposing.margins.filter(m=>m>side.line!).length
                    warnings.push('NHL oficial: la selección no cubriría '+miss+
                      '/'+team.games+' juegos recientes de su equipo; rival superaría el margen en '+
                      winning+'/'+opposing.games+' juegos. Muestras no ajustadas por rival.')
                  }
                }
              }
              return {...review,nhlOfficial:official,warnings}
            })
          }))
          results.forEach((item,i)=>{
            if(item.status==='fulfilled')checked.push(...item.value)
            else if(batch[i])checked.push(unavailableMarketEvidence(batch[i]!,
              String(item.reason instanceof Error?item.reason.message:item.reason)))
          })
        }
        return checked
      })()
      // Research chooses among real winner, total and spread offers *after*
      // auditing each game. Never add a second leg from the same game.
      const evaluated=selectDailyResearchedMarkets(research,count)
      const best=evaluated.selected
      // Mandatory specialist dossiers: do NOT convert general ESPN form or an odds
      // quotation into an approved daily ticket without each sport's investigation.
      const specialistChecks=args.deep===false?[]:await investigateTicketSpecialists(
        best.map(review=>({
          sport:review.candidate.sport,league:review.candidate.league,
          eventId:review.candidate.espnEventId,date:daily.date,
          home:daily.events.find(x=>x.eventId===review.candidate.espnEventId&&
            x.sport===review.candidate.sport&&x.league===review.candidate.league)?.home.name??'',
          away:daily.events.find(x=>x.eventId===review.candidate.espnEventId&&
            x.sport===review.candidate.sport&&x.league===review.candidate.league)?.away.name??'',
          kickoff:review.candidate.kickoff,
        })),fetch,now,env,quotes)
      const specialistFor=(review:(typeof best)[number])=>
        specialistChecks.find(check=>check.sport===review.candidate.sport&&
          check.league===review.candidate.league&&
          check.eventId===review.candidate.espnEventId)
      const dossierReady=(review:(typeof best)[number])=>
        specialistFor(review)?.status==='researched'
      // Feed the daily research with actual event-level props, periods and
      // alternates from the SAME verified book, rather than stopping at h2h.
      // They remain research-only until a specialist model validates each market.
      const specialMarkets=args.deep===false?null:
        await researchDailySpecialMarkets(best.map(x=>x.candidate),env,fetch,now,
          Math.min(6,count))
      const trustedOptions=best.filter(item=>item.status==='descriptive-support'&&
        item.priceAudit.classification!=='negative-value'&&dossierReady(item))
      const provisional=best.filter(item=>!trustedOptions.includes(item))
      // Convert only the exact observed offer, not a predicted line, into a
      // native priced ticket. Never substitute a different house or odds.
      const quoted=best.flatMap(review=>{
        const candidate=review.candidate
        // Uncertain/contraindicated/unavailable legs remain research-only.
        // Never revert silently to the book's favorite if research fails.
        if(review.status!=='descriptive-support'||!review.selectedOutcome||
          review.priceAudit.classification==='negative-value'||!dossierReady(review))return []
        const selected=review.selectedOutcome
        const raw=quotes.find(quote=>quote.eventId===candidate.bookmakerEventId&&
          quote.bookmaker===candidate.bookmaker&&quote.market===candidate.market&&
          quote.selection===selected.selection&&(quote.point??null)===selected.line&&
          quote.price===selected.decimalOdds&&quote.source===candidate.source)
        if(!raw)return []
        return [{review,raw,market:{eventId:raw.eventId,bookmaker:raw.bookmaker,
          market:raw.market,selection:raw.selection,point:raw.point??null}}]
      })
      let ticket:ReturnType<typeof pricedTicket>['card']|null=null
      if(args.deep!==false&&quoted.length>=count){
        try{
          const built=pricedTicket(quoted.map(x=>x.market),quoted.map(x=>x.raw))
          const legs=Array.isArray(built.card.props.legs)?built.card.props.legs:[]
          ticket={...built.card,props:{...built.card.props,
            title:'PHOENIX · Candidatas investigadas ('+quoted.length+' patas)',
            subtitle:'Preselección descriptiva · ventaja no demostrada · sin apuesta realizada',
            requestedLegs:count,
            specialistChecks,
            legs:legs.map((leg,index)=>({
              ...(leg!==null&&typeof leg==='object'?leg:{}),
              rationale:quoted[index]?.review.status==='descriptive-support'?
                'Apoyo descriptivo ('+quoted[index]!.review.sampleGames.home+'/'+
                quoted[index]!.review.sampleGames.away+' partidos). '+
                quoted[index]!.review.marketDirection+
                '. Línea: '+(quoted[index]!.review.marketOutcomeDiagnostic?
                  quoted[index]!.review.marketOutcomeDiagnostic!.status+
                  ' (equipo '+quoted[index]!.review.marketOutcomeDiagnostic!.team.wins+
                  '/'+(quoted[index]!.review.marketOutcomeDiagnostic!.team.wins+
                    quoted[index]!.review.marketOutcomeDiagnostic!.team.losses)+
                  ', rival '+quoted[index]!.review.marketOutcomeDiagnostic!.opponent.wins+
                  '/'+(quoted[index]!.review.marketOutcomeDiagnostic!.opponent.wins+
                    quoted[index]!.review.marketOutcomeDiagnostic!.opponent.losses)+')':
                  'no evaluable como hándicap/total')+
                '. Expediente obligatorio: '+(specialistFor(quoted[index]!.review)?.specialist??'no disponible')+
                '. Pendientes: '+(specialistFor(quoted[index]!.review)?.pendingSteps.slice(0,3).join('; ')??'sin evidencia')+
                '. Acierto mínimo exigido '+quoted[index]!.review.priceAudit.breakEvenPercent+
                '%. Frecuencias históricas no son probabilidades calibradas; bajas y titulares pendientes.':
                'Candidata CONDICIONAL: no existe una señal independiente suficiente. '+
                'Verificar lesiones, titulares y reglas antes de considerar.',
            })),
            note:String(built.card.props.note??'')+
              ' Se investigó cada pata con su especialista. Estas son CANDIDATAS, NO selecciones con ventaja calibrada ni apuestas aprobadas. '+
              'Patas con apoyo descriptivo: '+trustedOptions.length+'; condicionales: '+
              provisional.length+'. Se requieren probabilidades calibradas y datos de alineación '+
              'para afirmar ventaja real. No se realizó ninguna apuesta.',
          }}
        }catch{ /* Invalid ticket is not rendered as a real quoted ticket. */ }
      }
      return JSON.stringify({
        goal:count,range:[4,6],complete:args.deep===false?pool.selected.length>=count:
          trustedOptions.length>=count,
        discoveryComplete:pool.selected.length>=count,
        researchComplete:trustedOptions.length>=count,
        specialistChecks,specialistResearched:specialistChecks.filter(x=>x.status==='researched').length,
        specialistIncomplete:specialistChecks.filter(x=>x.status!=='researched').length,
        approvedForBetting:0,
        quotedCandidates:pool.selected.length,researchPool,
        marketCandidates:pool.eligibleMarkets,matchedGames:pool.matchesInSlate,
        bookmaker:pool.bookmaker,reviewed:research.length,
        eventChoices:evaluated.eventChoices,
        marketsReviewed:evaluated.marketsReviewed,
        alternativeMarketsCompared:evaluated.alternativesCompared,
        researchedPicks:trustedOptions.length,conditionalPicks:provisional.length,
        valueValidatedPicks:best.filter(r=>r.priceAudit.classification==='potential-value').length,
        marketLineCrossChecks:research.filter(r=>r.marketOutcomeDiagnostic!==undefined).length,
        marketLineContradictions:research.filter(r=>r.marketOutcomeDiagnostic?.status==='adverse').length,
        marketLineUncertain:research.filter(r=>r.marketOutcomeDiagnostic?.status==='mixed'||
          r.marketOutcomeDiagnostic?.status==='insufficient').length,
        priceAuditState:'umbrales-cotizados-sin-modelo-calibrado-por-mercado',
        selected:args.deep===false?pool.selected.slice(0,count):best,
        ...(ticket?{uiBlock:ticket}:{status:'borrador-sin-cuatro-precios-validados'}),
        rejectedQuotes:pool.rejectedQuotes,
        date:daily.date,checkedAt:new Date(now).toISOString(),
        eventsScanned:daily.totalEligible,fixturesConsidered:daily.events.length,
        competitionsChecked:daily.coverage,sourcesChecked:attempts,
        providerHealth,specialMarkets,placed:false,
        warning:'El expediente específico de NFL/NBA/NHL/MLB/Fútbol/Tenis es obligatorio: un fallo impide cotizar esa pata como investigada. Los especialistas no certifican apuestas ganadoras ni EV. Los hándicaps NHL +1.5/-1.5 sin porteros confirmados ni modelo calibrado de cobertura se bloquean como patas cotizadas. Selección orientativa y cuotas reales observadas: ni proyecciones descriptivas ni probabilidades sin margen son modelos calibrados ni garantías de ganar. La línea y el precio deben confirmarse en la casa, igual que las bajas y titulares oficiales. El campo specialMarkets investiga automáticamente props, periodos y líneas alternativas de la MISMA casa cuando el proveedor las publica; son opciones de investigación y NO patas aprobadas sin modelo específico. Nunca inventar ofertas.',
        instruction:'priceAudit.breakEvenPercent es el porcentaje exigido por la cuota y NO un pronóstico. El valor esperado queda sin verificar cuando no hay modelo calibrado para esa línea. Nunca conviertas un resultado CONTRAINDICADO o INCIERTO en pata del ticket; muestra riesgo y alternativas sin inventar precios. La tarjeta nativa solo muestra precios cotejados de una misma casa. Distingue CANDIDATAS CON APOYO DESCRIPTIVO de CONDICIONALES (no equivalen a picks validados). Si la evidencia favorece el lado opuesto, usa el precio real de selectedOutcome. Verifica informes oficiales de lesiones, titulares/porteros, props, períodos y reglas antes de apostar. No hay apuesta realizada.',
      })
    },
    presentCall:()=>({card:'generic',title:'Investigar el ticket diario y los mercados reales',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_event_market_menu',
    description:'Explora opciones reales de apuestas adicionales por partido en The Odds API v4 autorizado: líneas alternativas, primeras cinco entradas, períodos, props NBA/WNBA/MLB/NFL/NHL y algunos mercados Soccer según disponibilidad. Requiere el eventId DE LA CASA/API (nunca el ESPN eventId). No convierte estadística en apuesta ni coloca apuestas.',
    parameters:{
      sportKey:{type:'string',required:true,description:'Identificador REAL del proveedor, por ejemplo basketball_nba, baseball_mlb, icehockey_nhl, soccer_epl.'},
      eventId:{type:'string',required:true,description:'ID de evento del proveedor The Odds API v4, no el eventId ESPN.'},
      maxMarkets:{type:'integer',description:'Máximo 1-12 mercados por exploración, por defecto ocho; las consultas consumen créditos según proveedor.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      const env=await sportsEnv(ctx)
      const report=await readSportsEventMarketMenu(
        args.sportKey,args.eventId,env,fetch,Date.now(),args.maxMarkets??8)
      return JSON.stringify({...report,possibleCatalog:eventMarketCatalog(args.sportKey),
        placed:false,
        instruction:'Cada resultado es una cuota publicada, NO una predicción. Para la selección final hay que investigar partido, jugador, período, línea, reglas, lesiones e incertidumbre. No extrapolar un modelo de partido completo a primeras 5 entradas, cuartos, goles en 60 minutos o props. Evita mezclar participantes o bancas.'})
    },
    presentCall:()=>({card:'generic',title:'Explorar períodos, alternativos y props reales',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_sources_health',
    description:'Audita los proveedores deportivos. Si faltan, inicia su instalación administrada opcional sin bloquear el chat; retorna estado y logs, sin exponer credenciales ni prometer cuotas.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(){
      // Recover missing source installs even when the prepared Windows runtime
      // did not ship the updater script. Launch remains nonblocking.
      const autoRepair=await ensureSportsSourcesStarted(process.env)
      const env=await sportsEnv(ctx)
      const installation=managedSportsInstallStatus(env)
      const sources=await sportsSourcesHealth(env)
      return JSON.stringify({sources,installation,autoRepair,checkedAt:new Date().toISOString(),
        repair:'Si la instalación falla: ejecutar node scripts/phoenix-sports-source-bootstrap.mjs --status y revisar installation.logPath. Para reparar, node scripts/phoenix-sports-source-bootstrap.mjs --install desde la carpeta de PHOENIX. OddsHarvester requiere Python >=3.12 y Playwright Chromium. No copiar claves al chat.',
        warning:'Instalado no equivale a cuota real. OddsHarvester usa Playwright sobre OddsPortal; comprueba bookmaker, mercado, período y timestamp. SportsbookReview y MLB solo contienen históricos; para extraer datos nuevos se ejecutan sus propios scripts en tareas explícitas, no funcionan como fuentes vivas.'})
    },
    presentCall:()=>({card:'generic',title:'Verificar y autorreparar fuentes deportivas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_sources_repair',
    description:'Reparar de forma autónoma y sin bloquear el chat los tres proveedores deportivos opcionales: OddsHarvester/Chromium y dos repositorios históricos. Devuelve el estado del lanzador y archivo de errores. No promete cuotas.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(){
      const autoRepair=await ensureSportsSourcesStarted(process.env,true)
      const installation=managedSportsInstallStatus(process.env)
      return JSON.stringify({autoRepair,installation,checkedAt:new Date().toISOString(),
        instruction:'Se ha solicitado la reparación en segundo plano; no se han verificado cuotas ni operaciones. Consulta sports_chat_sources_health para ver progreso, logs y los proveedores listos. Si falta el instalador en el runtime o checkout, informa el bloqueo concreto.'})
    },
    presentCall:()=>({card:'generic',title:'Reparar fuentes deportivas automáticamente',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_editorial_discovery',
    description:'Descubre TITULARES públicos recientes indexados de Covers, VegasInsider, ScoresAndOdds y OddsPortal mediante RSS sindicalizado. No extrae sus páginas, picks de pago, cuotas ni cifras no verificadas.',
    parameters:{
      query:{type:'string',required:true,description:'Equipos o cruce real, mínimo tres caracteres.'},
      source:{type:'string',description:'cubre covers | vegasinsider | scoresandodds | oddsportal; omitir para todos.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(args.source&&!Object.hasOwn(editorialDomains,args.source))
        throw Error('Fuente editorial no admitida')
      return JSON.stringify(await discoverEditorialResearch(args.query,
        args.source?[args.source as EditorialSource]:undefined,fetch))
    },
    presentCall:()=>({card:'generic',title:'Descubrir análisis deportivos externos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_calibration_audit',
    description:'Audita por deporte y liga la calibración REAL cronológica con datos ESPN finalizados: entrenamiento sin fuga, bloque holdout posterior, Brier/log-loss/ECE y baseline. No implica ganancias. 28 a 180 fechas de calendario, manteniendo separación temporal.',
    parameters:{
      sport:{type:'string',required:true,description:'Deporte ESPN: basketball, soccer, baseball, football, hockey.'},
      league:{type:'string',required:true,description:'Liga ESPN registrada: nba, nhl, nfl, eng.1, etc.'},
      days:{type:'integer',description:'Ventana 28..180 días, por defecto 120. Solo repetir si se amplía la ventana o cambian datos.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      if(!Object.hasOwn(sportsCatalog,args.sport)||
        !sportsCatalog[args.sport]?.includes(args.league))
        throw Error('Liga no registrada en catálogo')
      if((await sportsEnv(ctx)).PHOENIX_SPORTS_ESPN_DISABLED==='1')
        return JSON.stringify({status:'unavailable',reason:'ESPN deshabilitado'})
      const result=await auditSportsCalibration(args.sport,args.league,args.days??120,
        <T>(url:string)=>getFeed<T>(url),Date.now())
      return JSON.stringify({...result,instruction:result.calibrated?
        'Ajuste disponible durante seis horas solo en este proceso; resultado validado cronológicamente, NO rentabilidad probada.':
        'No publicar probabilidades calibradas; muestra o comparación fuera de muestra insuficiente.'})
    },
    presentCall:()=>({card:'generic',title:'Auditar pronósticos históricos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_market_source_catalog',
    description:'Catálogo SIN RED de ScoresAndOdds, Covers, VegasInsider y OddsPortal para comparar líneas, movimientos y contexto con ESPN. Retorna URL, capacidades, límites y flujo de comprobación; no asegura conexión ni permisos de extracción.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(){
      return JSON.stringify(secondaryMarketSourceCatalog())
    },
    presentCall:()=>({card:'generic',title:'Investigar portales deportivos complementarios',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_explore',
    description:'ESPN universal: perfiles de equipos/jugadores, estadísticas por temporada, registros partido a partido, splits, clasificaciones, noticias, líderes, encuentros y búsqueda. Devuelve un panel dinámico seguro con logos, fotos y fuentes, dentro del chat. IDs deben provenir de ESPN.',
    parameters:{
      sport:{type:'string',required:true,description:'Disciplina ESPN, como basketball, soccer, hockey, baseball o football.'},
      league:{type:'string',required:true,description:'Slug ESPN real: nba, nhl, eng.1, mlb, nfl, etc.'},
      view:{type:'string',required:true,description:'team | player | event | standings | news | leaders | search'},
      teamId:{type:'string',description:'ID numérico confirmado de equipo para view=team.'},
      athleteId:{type:'string',description:'ID numérico confirmado de deportista para view=player.'},
      eventId:{type:'string',description:'ID numérico confirmado de partido para view=event.'},
      season:{type:'integer',description:'Año de temporada, cuando se solicita uno.'},
      query:{type:'string',description:'Texto a buscar en ESPN, solo para view=search.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await exploreEspn({
        sport:args.sport,league:args.league,view:args.view as EspnExplorerInput['view'],
        ...(args.teamId?{teamId:args.teamId}:{}),
        ...(args.athleteId?{athleteId:args.athleteId}:{}),
        ...(args.eventId?{eventId:args.eventId}:{}),
        ...(args.season?{season:args.season}:{}),
        ...(args.query?{query:args.query}:{}),
      },fetch,await sportsEnv(ctx))
      return JSON.stringify({
        summary:report.title+' · '+report.subtitle,
        sources:report.sources,
        limitations:report.limitations,
        uiBlock:report.uiBlock,
        instruction:'El panel ESPN ya se muestra en el chat. No repitas su JSON ni inventes secciones que la fuente no confirmó. Si falta una estadística, explícalo; partido, plantillas y cuotas se verifican por separado.',
      })
    },
    presentCall:()=>({card:'generic',title:'Explorar estadísticas, jugadores, equipos y noticias ESPN',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_deep_research',
    description:'Investiga un partido ESPN confirmado: noticias relacionadas, partes médicos, plantillas, estadísticas verificadas de jugadores y confirmación independiente MLB/NHL. Nunca inventa titulares ni probabilidades.',
    parameters:{
      sport:{type:'string',required:true,description:'Deporte ESPN, p. ej. hockey, basketball, soccer, football o baseball.'},
      league:{type:'string',required:true,description:'Liga ESPN comprobada, p. ej. nhl, nba, eng.1 o mlb.'},
      eventId:{type:'string',required:true,description:'ID exacto del evento obtenido de la cartelera ESPN.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await investigateEventDeep(args.sport,args.league,args.eventId,fetch,Date.now(),await sportsEnv(ctx))
      return JSON.stringify({...result,instruction:'Identifica qué noticias hablan realmente de los equipos. Los recuentos de lesiones y las plantillas NO confirman alineaciones. Si la fuente no aporta estadísticas individuales no atribuyas rendimiento ni pronósticos. Contrasta por separado mercados de cuotas reales.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar noticias, estadísticas y bajas de un evento',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_matchup_factors',
    description:'Investigación universal de ventaja deportiva por evento ESPN confirmado: forma de ambos equipos, H2H, descansos, localía/estadio, contexto de noticias/lesiones y cuotas reconciliadas. En MLB desglosa referencias de carreras en 3, 5, 9 innings y consulta abridores probables y sus últimas salidas. Ninguna cifra es probabilidad calibrada; clima no verificado permanece pendiente.',
    parameters:{
      sport:{type:'string',required:true,description:'Disciplina ESPN: baseball, basketball, soccer, football, hockey, tennis, etc.'},
      league:{type:'string',required:true,description:'Slug real de liga del catálogo ESPN.'},
      eventId:{type:'string',required:true,description:'ID real ESPN obtenido de sports_chat_games.'},
      date:{type:'string',required:true,description:'Día de cartelera del evento, AAAA-MM-DD.'},
      lookbackDays:{type:'integer',description:'Ventana histórica de 3 a 28 días, por defecto 14.'},
      includeOdds:{type:'boolean',description:'Consulta mercados actuales por proveedor si existe; por defecto true.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await auditUniversalMatchup({
        sport:args.sport,league:args.league,eventId:args.eventId,date:args.date,
        ...(args.lookbackDays===undefined?{}:{lookbackDays:args.lookbackDays}),
        ...(args.includeOdds===undefined?{}:{includeOdds:args.includeOdds}),
      },fetch,Date.now(),await sportsEnv(ctx))
      return JSON.stringify({...result,
        instruction:'PHOENIX dibuja automáticamente el panel sports_espn_dashboard. Distingue evidencia histórica, condición de titulares, disponibilidad actual, precios de casas y datos faltantes. Los tramos 3/5/9 innings son medias exploratorias si existe muestra; solo compáralos con cuotas que tengan EXACTAMENTE el mismo período, reglas y fuente. No atribuyas ventajas numéricas ni probabilidades de victoria calibradas a estos promedios. Si existen señales contradictorias, explícalas y deja la conclusión como incierta.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar factores y ventajas reales del encuentro',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_bet_rules',
    description:'Consulta catálogo extenso de mercados por disciplina y reglas relevantes de liquidación de casas verificables: run line -1.5/2.5, altas/bajas por 3/5/9 innings, props de jugadores, 1X2, hándicap, over/under, tickets/parlays, push, void y overtime. No atribuye reglas de otra casa a Juancito.',
    parameters:{
      sport:{type:'string',description:'Filtrar disciplina: baseball, basketball, soccer, americanfootball, hockey, tennis, mma, cricket, golf.'},
      family:{type:'string',description:'Familia de mercado opcional: totals, moneyline, run_line, player_props, etc.'},
      bookmaker:{type:'string',description:'Casa consultada, solo para advertir que debe leerse su propio reglamento actual.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    execute:async args=>JSON.stringify({...describeBettingMarkets(args.sport,args.family),
      requestedBookmaker:args.bookmaker??null,
      instruction:'Estos son tipos de mercados, NO cuotas disponibles ni condiciones universales. Para Juancito y cualquier banca RD comprobar reglamento vigente de ese operador antes de liquidar. Distintas modalidades de 3/5/9 entradas, run line alternativo y props pueden cambiar según las reglas de participación, duración y tiempos extras.'}),
    presentCall:()=>({card:'generic',title:'Consultar mercados y reglas reales por deporte',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_register_receipt',
    description:'Lee el comprobante aportado por el usuario y vincula automáticamente cada selección al partido verificado de ESPN para mostrar su objetivo y progreso en la cartelera. Puede mezclar NHL, NBA y MLS en el mismo boleto. Nunca apuesta ni confirma pago. NO se requiere formulario de apuestas en cada juego.',
    parameters:{
      ticketReference:{type:'string',required:true,description:'Número de confirmación visible en el comprobante del usuario, no inventarlo.'},
      date:{type:'string',required:true,description:'Fecha local Santo Domingo AAAA-MM-DD de los eventos; cada pata puede tener fecha particular.'},
      bookmaker:{type:'string',required:true,description:'Operador tal como aparece en el comprobante, p. ej. Juancito Sport.'},
      stake:{type:'number',description:'Monto en DOP indicado por el usuario (si se lee).'},
      reportedReturn:{type:'number',description:'Retorno potencial expresado en DOP en el recibo (si se lee).'},
      legs:{type:'array',required:true,description:'Patas EXACTAS del recibo, sin inventar equipos ni líneas. Entre 1 y 12, pueden ser ligas diferentes.',
        items:{type:'object',additionalProperties:false,properties:{
          sport:{type:'string',required:true,description:'Deporte ESPN: basketball, hockey, soccer, football o baseball.'},
          league:{type:'string',required:true,description:'Slug oficial ESPN: nba, nhl, usa.1, etc.'},
          date:{type:'string',description:'Fecha local de esta pata AAAA-MM-DD, si difiere de la del boleto.'},
          eventId:{type:'string',description:'ID ESPN REAL si se conoce, no la ID de otra casa ni MLB Stats gamePk.'},
          team:{type:'string',required:true,description:'Equipo de la selección, para total se puede usar un participante del partido.'},
          opponent:{type:'string',description:'Rival del evento, obligatorio para total de puntos/goles.'},
          market:{type:'string',required:true,description:'moneyline | spread | total | three-way'},
          side:{type:'string',description:'over/under para total; draw para empate 1X2. Para ganador y spread se determina equipo home/away con ESPN.'},
          line:{type:'number',description:'Línea exacta con signo para spread, o umbral para total. +1.5 no es -1.5.'},
          americanOdds:{type:'integer',description:'Cuota americana aportada en recibo, solo cuando es legible.'},
        }}},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await registerSportsReceipt({
        ticketReference:args.ticketReference,date:args.date,bookmaker:args.bookmaker,
        ...(args.stake===undefined?{}:{stake:args.stake}),
        ...(args.reportedReturn===undefined?{}:{reportedReturn:args.reportedReturn}),
        legs:args.legs as ReceiptLegInput[],
      },fetch,await sportsEnv(ctx))
      return JSON.stringify(result.uiBlock)
    },
    presentCall:()=>({card:'generic',title:'Vincular objetivos del boleto automáticamente',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_follow_receipts',
    description:'Genera un ÚNICO panel universal con las tarjetas de cada boleto real y todas sus patas. Captura automáticamente las selecciones de recibos del usuario, valida partidos ESPN individualmente, y en el cliente actualiza el marcador, objetivo de la pata y total acumulado sin formularios. No registra apuestas en la banca.',
    parameters:{
      receipts:{type:'array',required:true,description:'Uno a cinco comprobantes del usuario, cada uno con todas sus patas y operador. No inventar datos.',
        items:{type:'object',additionalProperties:false,properties:{
          ticketReference:{type:'string',required:true,description:'Confirmación exacta visible en el comprobante.'},
          date:{type:'string',required:true,description:'Fecha de las selecciones AAAA-MM-DD Santo Domingo.'},
          bookmaker:{type:'string',required:true,description:'Casa indicada en comprobante.'},
          stake:{type:'number',description:'Importe en DOP si aparece.'},
          reportedReturn:{type:'number',description:'Retorno potencial en DOP, si aparece.'},
          legs:{type:'array',required:true,description:'Patas con selección y mercado exactos, hasta doce.',
            items:{type:'object',additionalProperties:false,properties:{
              sport:{type:'string',required:true,description:'Identificador ESPN de deporte: hockey, soccer, basketball etc.'},
              league:{type:'string',required:true,description:'Liga ESPN, ej. nhl, nba, usa.1.'},
              date:{type:'string',description:'Fecha de la pata si difiere de la del boleto.'},
              eventId:{type:'string',description:'ID ESPN solo si está verificado.'},
              team:{type:'string',required:true,description:'Nombre exacto del equipo seleccionado o uno del partido si mercado total.'},
              opponent:{type:'string',description:'Rival exacto, requerido en apuestas de total.'},
              market:{type:'string',required:true,description:'moneyline | spread | total | three-way'},
              side:{type:'string',description:'over/under del total, draw si empate; home/away se obtiene de ESPN.'},
              line:{type:'number',description:'Línea exacta con signo para hándicap o total.'},
              americanOdds:{type:'integer',description:'Cuota estadounidense del recibo si se lee.'},
            }}},
        }}},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const receipts=args.receipts as ReceiptInput[]
      if(!Array.isArray(receipts)||receipts.length<1||receipts.length>5)
        throw Error('Se requiere entre 1 y 5 comprobantes completos.')
      if(new Set(receipts.map(x=>x.ticketReference)).size!==receipts.length)
        throw Error('No se admite repetir número de confirmación.')
      const env=await sportsEnv(ctx)
      const verified=await Promise.all(receipts.map(x=>registerSportsReceipt(x,fetch,env)))
      return JSON.stringify({component:'sports_ticket_bundle_card',version:1,props:{
        title:'PHOENIX · Seguimiento automático de boletos',
        source:'Recibos del usuario + ESPN Site API · '+new Date().toISOString(),
        tickets:verified.map(x=>x.uiBlock.props),
      }})
    },
    presentCall:()=>({card:'generic',title:'Seguir todas las patas de mis boletos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_track',
    description:'Seguimiento de un ticket con eventos ESPN reales y mercados explícitos, devuelve estado provisional por pata, push, potencial retorno y riesgo de anulación. No acredita aceptación ni pago de la banca; cotejar siempre con su recibo.',
    parameters:{
      sport:{type:'string',required:true,description:'Deporte ESPN de los eventos, p. ej. baseball.'},
      league:{type:'string',required:true,description:'Liga ESPN, p. ej. mlb.'},
      date:{type:'string',required:true,description:'Fecha del evento AAAA-MM-DD.'},
      stake:{type:'number',required:true,description:'Monto efectivamente indicado por el usuario; no transfiere fondos.'},
      ticketReference:{type:'string',description:'Folio registrado por la banca según el usuario (no verificado mediante API de operador).'},
      legs:{type:'array',required:true,description:'Selecciones de la misma casa. IDs ESPN de cada encuentro, cuotas exactas, mercado, línea y equipo/jugador.',
        items:{type:'object',additionalProperties:false,properties:{
          eventId:{type:'string',required:true},
          bookmaker:{type:'string',required:true},
          market:{type:'string',required:true,description:'moneyline | h2h | 1x2 | run_line | spread | total | team_total | first_3_total | first_5_total | first_3_spread | first_5_spread | player_prop'},
          selection:{type:'string',required:true,description:'home | away | draw | over | under | yes | no'},
          price:{type:'number',required:true},
          line:{type:'number',description:'Línea firmada (ej. -1.5), valor de total o prop; necesaria en totales y spreads.'},
          team:{type:'string',description:'home | away para total del equipo'},
          playerId:{type:'string',description:'ID oficial de jugador para props'},
        }}},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await checkSportsTicket({
        sport:args.sport,league:args.league,date:args.date,stake:args.stake,
        legs:args.legs as SportsBetLeg[],
        ...(args.ticketReference?{ticketReference:args.ticketReference.slice(0,80)}:{}),
      },fetch,await sportsEnv(ctx))
      const named:Record<string,string>={
        won:'Ganada provisional',lost:'Perdida provisional',push:'Push (sin acción) provisional',
        pending:'Pendiente',unverifiable:'Sin datos suficientes',
      }
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'Seguimiento de ticket · '+result.sportsbook,
        subtitle:'Estado: '+result.status+' · ESPN '+args.league.toUpperCase(),
        source:'ESPN Site API · resultado observado, NO aceptación de la casa',
        checkedAt:result.checkedAt,
        sections:[
          {heading:'Estado de las selecciones',kind:'list',items:result.legs.map((leg,i)=>({
            label:(i+1)+'. '+leg.market+' · '+leg.selection,
            value:named[leg.result]??leg.result,
            detail:leg.score?leg.score+' · '+leg.reason:leg.reason,
          }))},
          {heading:'Balance provisional',kind:'metrics',items:[
            {label:'Importe indicado',value:'RD$ '+result.stake.toFixed(2)},
            {label:'Cuota después de pushes provisionales',value:result.combinedOdds.toFixed(3)},
            {label:'Retorno preliminar',value:result.provisionalReturn===null?'Pendiente':
              'RD$ '+result.provisionalReturn.toFixed(2)},
            {label:'Ganancia/pérdida preliminar',value:result.profit===null?'Pendiente':
              'RD$ '+result.profit.toFixed(2)},
          ]},
        ],
        note:'No confirma colocación ni pago; cada resultado requiere reglas de la banca. '+
          'Si el evento no está verificado, no se liquida.',
      }}
      return JSON.stringify({...result,uiBlock,
        instruction:'Presenta los resultados como PRELIMINARES; un folio escrito por el usuario no prueba aceptación. Pregunta por el comprobante/registro de la casa para dictamen oficial y compara el mismo mercado, línea, período, cancelaciones y reglas. No inventes datos de jugadores ni una ganancia cobrada.'})
    },
    presentCall:()=>({card:'generic',title:'Seguir ticket: ganada, perdida, push o pendiente',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_market_intelligence',
    description:'Compara mercados reales vigentes por bookmaker: ganador, doble oportunidad, totales, ambos marcan y handicap cuando la fuente los publicó. Solo calcula probabilidad IMPLÍCITA del precio, nunca probabilidad de acierto propia.',
    parameters:{
      sportKey:{type:'string',required:true,description:'Clave de mercado: soccer_epl, icehockey_nhl, basketball_nba, baseball_mlb, etc.'},
      date:{type:'string',description:'Fecha YYYY-MM-DD en Santo Domingo para scraping local, por defecto hoy.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx)
      const autoRepair=env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED==='1'?
        null:await ensureSportsSourcesStarted(process.env)
      const sources=await sportsSourcesHealth(env)
      const odds=await Promise.allSettled([
        marketOdds(args.sportKey,'h2h,totals,spreads',env,fetch),
        ...(env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED==='1'?[
          (async()=>{
            const routes:Record<string,{sport:string;markets:string[]}> = {
              soccer:{sport:'football',markets:['1x2','double_chance','over_under']},
              basketball:{sport:'basketball',markets:['moneyline','over_under']},
              baseball:{sport:'baseball',markets:['moneyline','over_under']},
              americanfootball:{sport:'american-football',markets:['moneyline','over_under']},
              icehockey:{sport:'ice-hockey',markets:['home_away','double_chance','over_under']},
              tennis:{sport:'tennis',markets:['match_winner','total_games_over_under']},
            }
            const route=routes[args.sportKey.split('_')[0]??'']
            if(!route)return []
            const quotes=await Promise.allSettled(route.markets.map(m=>
              keylessOdds(route.sport,m,args.date,env)))
            return quotes.flatMap(x=>x.status==='fulfilled'?x.value
              .filter(q=>belongsToLeague(args.sportKey,q))
              .map(q=>({...q,timeIso:q.time,sportKey:args.sportKey})):[])
          })(),
        ]:[]),
      ])
      const combined=odds.flatMap(x=>x.status==='fulfilled'?x.value:[])
      const comparison=compareBettingMarkets(combined)
      return JSON.stringify({sportKey:args.sportKey,availableMarkets:supportedMarketFamilies,
        ...comparison,sourceReadiness:sources,autoRepair,
        sourcesAttempted:odds.length,quotesObserved:combined.length,
        instruction:'Los precios implícitos NO son probabilidades predictivas. Mercados superpuestos no deben normalizarse ni combinarse como independientes. Si no existen cuotas, noticia o lesión verificables, indica explícitamente que falta evidencia. No fabriques un ticket de mayor probabilidad.'})
    },
    presentCall:()=>({card:'generic',title:'Comparar mercados y cuotas verificadas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_catalog',
    description:'Lista disciplinas y ligas documentadas. No crea menú ni abre otra pantalla.',
    parameters:{},
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    execute:()=>Promise.resolve(JSON.stringify({ sports:sportsCatalog,notice:'La disponibilidad de ligas y recursos varía por proveedor.' })),
    presentCall:()=>({ card:'generic',title:'Consultar deportes',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_discover',
    description:'Descubre competiciones adicionales directamente en el catálogo público ESPN, sin API key ni acceso a URLs arbitrarias.',
    parameters:{ sport:{ type:'string',required:true,description:'Disciplina ESPN como soccer, baseball, basketball, cricket, golf o hockey.' } },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const leagues=await discoverEspnLeagues(args.sport)
      return JSON.stringify({ sport:args.sport,source:'ESPN Core/Web API (consulta pública)',leagues,
        note:'Los slugs se obtuvieron del catálogo ESPN; no todas las ligas tienen un scoreboard activo. Solicita deportes individuales con sports_chat_games.' })
    },
    presentCall:()=>({ card:'generic',title:'Descubrir ligas en ESPN',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_games',
    description:'Cartelera compacta, tarjetas por partido y marcadores en vivo con actualizaciones automáticas sin tokens. Usa liveOnly=true para eventos que están jugando.',
    parameters:{
      sport:{ type:'string',required:true,description:'Deporte: soccer, baseball, basketball, etc.' },
      league:{ type:'string',required:true,description:'Liga: mlb, nba, mex.1, eng.1, etc.' },
      date:{ type:'string',description:'Fecha AAAA-MM-DD, opcional: hoy en Santo Domingo.' },
      team:{ type:'string',description:'Nombre del equipo buscado; opcional para consulta individual.' },
      opponent:{ type:'string',description:'Segundo equipo si se busca un cruce concreto.' },
      eventId:{ type:'string',description:'ID de evento exacto obtenido de ESPN o MLB; opcional.' },
      liveOnly:{ type:'boolean',description:'Mostrar solamente partidos en juego ahora. La tarjeta seguirá actualizándose desde ESPN.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await chatGames(args.sport,args.league,args.date,process.env,fetch,args.liveOnly===true)
      const normalize=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim()
      const matches=(name:unknown,wanted:string)=>typeof name==='string'&&normalize(name).includes(normalize(wanted))
      const selected=result.items.filter(game=>{
        const props=game.props
        if(args.liveOnly===true&&props.phase!=='in')return false
        if(args.eventId&&props.eventId!==args.eventId)return false
        const home=props.home as {label?:string},away=props.away as {label?:string}
        if(args.team&&!matches(home?.label,args.team)&&!matches(away?.label,args.team))return false
        if(args.opponent&&!matches(home?.label,args.opponent)&&!matches(away?.label,args.opponent))return false
        return true
      })
      const listMode=!args.team&&!args.opponent&&!args.eventId
      const slate=listMode?compactSportsSchedule(selected,result.date,result.source):null
      const uiBlocks=slate?[slate]:selected.slice(0,6)
      const selectedIds=new Set(selected.map(card=>card.props.eventId).filter((id):id is string=>typeof id==='string'))
      const espnIdentifiers=result.espnIdentifiers.filter(ids=>selectedIds.has(ids.eventId))
      return JSON.stringify({summary:selected.length?result.summary:(args.liveOnly?'No hay partidos en vivo confirmados para esta liga y fecha.':'Ningún encuentro coincide con esos filtros.'),
        date:result.date,source:result.source,count:selected.length,espnIdentifiers,uiBlocks,
        cardCount:uiBlocks.length,
        remaining:Math.max(0,selected.length-(slate?25:6)),
        instruction:(uiBlocks.length===0?'No se obtuvo una tarjeta deportiva para esta consulta; informa que no hay evento/tarjeta verificados, no afirmes que la publicaste. ':'Se entregaron '+uiBlocks.length+' tarjetas estructuradas al cliente; la entrega NO confirma que la pantalla las haya renderizado. ')+
          'Phoenix renderiza uiBlocks automáticamente en el chat y consulta marcadores ESPN sin consumir tokens. espnIdentifiers contiene eventId, competitionId y team IDs REALES de la cartelera; usa esos ID para sports_chat_espn_core(mode=odds/provider/movement/probabilities/predictor/ats/odds_records), sin asumir competitionId=eventId si falta. Para MLB Stats API no atribuyas sus gamePk a ESPN. En juegos en vivo no repitas el marcador textual de la instantánea; la UI lo actualiza. Para partidos de un ticket, consulta las ligas/equipos de las patas pertinentes. No imprimas JSON ni repliques las tarjetas en prosa.' })
    },
    presentCall:()=>({ card:'generic',title:'Buscar partidos y sus datos',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_predict',
    description:'Produce estimación PRELIMINAR propia de PHOENIX para un evento ESPN verificado y futuro, basada en resultados previos de ambos equipos. Se abstiene si la muestra es insuficiente; NO es un predictor calibrado ni prueba EV positivo. Contrasta noticias, cuotas y opiniones aparte.',
    parameters:{
      sport:{type:'string',required:true,description:'Disciplina ESPN: soccer, basketball, baseball, football, hockey.'},
      league:{type:'string',required:true,description:'Liga ESPN validada: nfl, nba, mlb, nhl, eng.1, etc.'},
      eventId:{type:'string',required:true,description:'Identificador real obtenido de sports_chat_games.'},
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD del encuentro en Santo Domingo.'},
      lookbackDays:{type:'integer',description:'3..28 días de resultados previos, por defecto 28.'},
      includeExternalResearch:{type:'boolean',description:'Descubrir titulares públicos relacionados al juego en cuatro medios indexados; activado por defecto.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now()
      const report=await auditUniversalMatchup({
        sport:args.sport,league:args.league,eventId:args.eventId,date:args.date,
        lookbackDays:args.lookbackDays??28,includeOdds:true,
      },fetch,now,await sportsEnv(ctx))
      const forecast=estimateEvidenceForecast({
        sport:args.sport,phase:report.phase,eventDate:report.date,
        home:{name:report.home.name,lastGames:report.home.lastGames},
        away:{name:report.away.name,lastGames:report.away.lastGames},
      },now)
      const audit=availableSportCalibration(args.sport,args.league,report.date,now)
      const calibrated=audit?calibratedSportsForecast(forecast,audit):null
      const externalResearch=args.includeExternalResearch===false?null:
        await discoverEditorialResearch(report.away.name+' '+report.home.name,
          undefined,fetch,now)
      const playerData=report.phase==='pre'?await collectDirectEspnStats(
        args.sport,args.league,[
          {id:report.home.id,name:report.home.name},
          {id:report.away.id,name:report.away.name},
        ],fetch,now,12):null
      const teamMetrics=playerData?.teams.flatMap(t=>t.stats.slice(0,6).map(stat=>({
        label:t.name+' · '+stat.name,value:stat.value,
        detail:'Estadística real de equipo · ESPN Site',
      })))??[]
      const athleteMetrics=playerData?.teams.flatMap(t=>t.athletes.map(a=>({
        label:t.name+' · '+a.name,
        value:a.stats.slice(0,3).map(s=>s.name+' '+s.value).join(' · ')||
          'Estadísticas individuales no publicadas',
        detail:a.position+' · '+(a.verifiedSources.join(', ')||'Sin feed accesible'),
        ...(a.headshot?{image:a.headshot}:{}),
      })))??[]
      const displayedHome=calibrated?.probabilityHome??forecast.probabilityHome
      const displayedAway=calibrated?.probabilityAway??forecast.probabilityAway
      const displayedDraw=calibrated?.probabilityDraw??forecast.probabilityDraw
      const alternatives=sportsMarketAlternatives(args.sport,report.marketComparisons,
        forecast.projectedHome,forecast.projectedAway)
      const marketOptions=alternatives.alternatives.slice(0,6).map(m=>({
        label:(m.family==='run-line'?'Run line':
          m.family==='total'?'Total':m.family==='spread'?'Hándicap':'Ganador')+
          ' · '+m.bookmaker,
        value:m.quotes.map(q=>q.selection+' '+q.decimalPrice.toFixed(2)+
          (q.point===null?'':' ('+q.point+')')).join(' | ').slice(0,180),
        detail:'Cuotas observadas · hace '+m.freshnessMinutes.toFixed(0)+
          ' min. NO ventaja calibrada.',
      }))
      const forecastItems=forecast.status==='exploratory'?[
        {label:report.home.name,value:displayedHome===null?'—':
          (displayedHome*100).toFixed(1)+'%',
          detail:forecast.projectedHome===null?'':
            'Marcador orientativo '+forecast.projectedHome+(calibrated?' · validación histórica':' · no calibrado')},
        {label:report.away.name,value:displayedAway===null?'—':
          (displayedAway*100).toFixed(1)+'%',
          detail:forecast.projectedAway===null?'':
            'Marcador orientativo '+forecast.projectedAway+(calibrated?' · validación histórica':' · no calibrado')},
        ...(displayedDraw===null?[]:[
          {label:'Empate',value:(displayedDraw*100).toFixed(1)+'%',
            detail:calibrated?'Ajuste con validación histórica':'Proyección orientativa · no calibrada'}]),
      ]:[{label:'Proyección',value:'Sin evidencia suficiente',
        detail:forecast.warnings[0]??'No se verificó una estimación'}]
      const appended=[
        ...(marketOptions.length?[{heading:'Opciones reales de mercado',
          kind:'list' as const,items:marketOptions}]:[]),
        ...(teamMetrics.length?[{heading:'Estadísticas de equipo · ESPN',
          kind:'metrics' as const,items:teamMetrics.slice(0,12)}]:[]),
        ...(athleteMetrics.length?[{heading:'Estadísticas individuales · ESPN',
          kind:'list' as const,items:athleteMetrics.slice(0,24)}]:[]),
      ]
      // Keep model percentages and the already verified matchup, markets
      // and medical/context sections; replace lesser-ranked sections if needed.
      const original=report.uiBlock.props.sections
      const ordered=[...original.filter(s=>/Forma reciente|Cuotas completas|Probabilidades implícitas|Plantillas, bajas|Localía/i.test(s.heading)),
        ...appended,...original.filter(s=>!/Forma reciente|Cuotas completas|Probabilidades implícitas|Plantillas, bajas|Localía/i.test(s.heading))]
      const uiBlock={...report.uiBlock,props:{...report.uiBlock.props,sections:[
        {heading:'Estimación orientativa',kind:'metrics' as const,items:forecastItems},
        ...ordered,
      ].slice(0,8),note:(calibrated?'Ajuste validado históricamente; no demuestra rentabilidad. ':
        'Estimación exploratoria sin calibración aprobada. ')+report.uiBlock.props.note}}
      return JSON.stringify({
        eventId:report.eventId,date:report.date,league:report.league,
        matchup:report.away.name+' vs '+report.home.name,
        verifiedSides:{home:{id:report.home.id,name:report.home.name},
          away:{id:report.away.id,name:report.away.name}},
        forecast,calibrated,calibrationAudit:audit,externalResearch,
        directPlayerEvidence:playerData,
        marketAlternatives:alternatives,
        source:report.source,checkedAt:report.checkedAt,
        facts:{homeForm:report.home.form,awayForm:report.away.form,
          descriptiveAdvantages:report.descriptiveAdvantages,
          headToHead:report.headToHead.slice(0,3),
          injuries:report.rosterNewsInjuries?.injuries.slice(0,8)??[],
          latestNews:report.rosterNewsInjuries?.headlines.slice(0,6)??[],
          marketComparisons:report.marketComparisons.slice(0,4)},
        coverage:report.coverage,missingEvidence:report.limitations.slice(0,14),
        instruction:'AL ARMAR TICKET: evalúa todas las marketAlternatives realmente observadas (ganador, RL -1.5/+1.5, spreads, totales); no reduzcas automáticamente a Moneyline. Propuestas de jugador requieren líneas específicas confirmadas por proveedor, no basta ESPN player stats. sports_chat_ticket valida de nuevo los precios/mercados/puntos y casa antes de entregar ticket cotizado. Nunca inventes EV ni declares una pata ganadora sin validación de ese mercado. La estimación es exploratoria salvo que calibrated contenga una validación temporal aprobada. En ningún caso implica ventaja rentable ni promesa de victoria. No publicar EV, ventaja apostable ni ticket ganador sin precios vigentes y evaluación independiente. Para segunda opinión consulta sports_chat_market_source_catalog, sports_chat_community_opinions y expertos de Covers/ESPN SOLO mediante navegación permitida. Usa sports_chat_odds para precios vigentes y reporta sus timestamps. La UI nativa del dossier se proporciona por separado.',
        uiBlock,
      })
    },
    presentCall:()=>({card:'generic',title:'Investigar y estimar partido con PHOENIX',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_nba_research',
    description:'Investiga la forma NBA con marcadores FINALIZADOS de las últimas fechas: últimos resultados, márgenes de puntos, descanso, calidad de muestra y evidencia ausente. No infiere lesiones, cuotas ni probabilidades.',
    parameters:{
      date:{ type:'string',description:'Fecha del partido en Santo Domingo, AAAA-MM-DD; defecto hoy.' },
      eventId:{ type:'string',description:'ID real ESPN NBA; si se omite investiga hasta seis encuentros futuros.' },
      lookbackDays:{ type:'integer',description:'Histórico diario, 1-21 días; por defecto 14. Una consulta por fecha compartida entre los encuentros.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await researchNbaSlate(args.date,args.eventId,fetch,Date.now(),process.env,args.lookbackDays??14)
      return JSON.stringify({ ...report,
        matches:report.matches.map(m=>({
          ...m,
          home:{ ...m.home,recentResults:m.home.recentResults.slice(0,5) },
          away:{ ...m.away,recentResults:m.away.recentResults.slice(0,5) },
        })),
        instruction:'Datos calculados desde partidos concluidos, NO una predicción de acierto. Evalúa lesiones confirmadas, titulares, eficiencia, cuotas actuales y valor esperado antes de elegir; las ausencias de evidencia permanecen explícitas. No atribuyas nombres de jugadores sin comprobar su plantilla.',
      })
    },
    presentCall:()=>({ card:'generic',title:'Investigar forma y descanso NBA',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_mlb_pitchers',
    description:'Analiza rotación y bullpen de MLB por equipo, ERA, WHIP, entradas y ponches con datos de temporada verificados.',
    parameters:{
      teamId:{ type:'integer',required:true,description:'ID del equipo, extraído de datos reales MLB.' },
      season:{ type:'integer',required:true,description:'Año de la temporada MLB.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await getMlbPitcherReport(args.teamId,args.season)
      return JSON.stringify({ source:report.source,roster:report.pitchers,missingStats:report.unavailableStats,
        uiBlock:report.uiBlock,instruction:'Phoenix muestra uiBlock automáticamente en el chat. No repitas su JSON; explica la comparación y distingue estadísticas ausentes.' })
    },
    presentCall:()=>({ card:'generic',title:'Analizar abridores y bullpen MLB',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_route_audit',
    description:'Prueba realmente todas las rutas ESPN EXTENDIDAS registradas (50+ modos) usando IDs oficiales ya confirmados. Devuelve para CADA ruta data/ref_only/empty/error/skipped y nunca simula disponibilidad. Consulta costosa: solo en auditorías explícitas, no por partido rutinario.',
    parameters:{
      sport:{type:'string',required:true,description:'Disciplina ESPN verificable.'},
      league:{type:'string',required:true,description:'Liga ESPN del evento.'},
      eventId:{type:'string',description:'ID real ESPN, recomendado.'},
      competitionId:{type:'string',description:'ID de competición real; no asumir igual a eventId.'},
      teamId:{type:'string',description:'ID real de un equipo de ese partido.'},
      athleteId:{type:'string',description:'ID real de un atleta incluido en la plantilla.'},
      season:{type:'integer',description:'Temporada ESPN 1900-2100.'},
      seasonType:{type:'integer',description:'Regular 2 por defecto.'},
      week:{type:'integer',description:'Semana verificable para ligas semanales.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      if((await sportsEnv(ctx)).PHOENIX_SPORTS_ESPN_DISABLED==='1')
        return JSON.stringify({status:'unavailable',reason:'ESPN deshabilitado'})
      return JSON.stringify(await probeExtendedEspnCatalog({
        sport:args.sport,league:args.league,eventId:args.eventId,
        competitionId:args.competitionId,teamId:args.teamId,athleteId:args.athleteId,
        season:args.season,seasonType:args.seasonType,week:args.week,
      },<T>(url:string)=>getFeed<T>(url)))
    },
    presentCall:()=>({card:'generic',title:'Auditar rutas y estadísticas ESPN disponibles',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_extended_catalog',
    description:'Catálogo completo de rutas ESPN extendidas con parámetros seguros para equipos, jugadores, lesiones, juegos, stats, movimientos y noticias. El catálogo NO significa que todos los endpoints respondan.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    execute:()=>Promise.resolve(JSON.stringify({routes:extendedEspnRoutes,
      warning:'Estas rutas no oficiales necesitan prueba individual por deporte y liga. Para mercados, ATS, predictors, probabilities y movement ya existe sports_chat_espn_core. No prometer cobertura uniforme.'})),
    presentCall:()=>({card:'generic',title:'Explorar rutas deportivas ESPN',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_extended',
    description:'Acceso read-only a rutas ESPN permitidas para temporada, equipo, atleta, partidos, lesiones, noticias, jugadas y estadísticas. Usa IDs reales de sports_chat_games; controla formato, errores y salida limitada.',
    parameters:{
      mode:{type:'string',required:true,description:'Consulta sports_chat_espn_extended_catalog para los modos admitidos.'},
      sport:{type:'string',required:true,description:'Disciplina ESPN, p. ej. football, basketball, soccer.'},
      league:{type:'string',required:true,description:'Liga ESPN, p. ej. nfl, nba, eng.1.'},
      eventId:{type:'string',description:'ID real del evento desde la cartelera.'},
      competitionId:{type:'string',description:'ID real de la competición, obligatorio en rutas de juego.'},
      teamId:{type:'string',description:'ID ESPN real del equipo.'},
      athleteId:{type:'string',description:'ID ESPN real del atleta.'},
      season:{type:'integer',description:'Temporada YYYY requerida en rutas season.'},
      seasonType:{type:'integer',description:'Tipo 0..4, regular por defecto 2.'},
      week:{type:'integer',description:'Semana de la temporada.'},
      limit:{type:'integer',description:'Límite entre 1 y 200 para rutas con paginación.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(!Object.hasOwn(extendedEspnRoutes,args.mode))throw Error('Modo ESPN inválido; revisar catálogo extendido')
      if((await sportsEnv(ctx)).PHOENIX_SPORTS_ESPN_DISABLED==='1')
        return JSON.stringify({status:'unavailable',error:'ESPN deshabilitado por el host'})
      return JSON.stringify(await readExtendedEspn({
        mode:args.mode as ExtendedEspnMode,sport:args.sport,league:args.league,
        eventId:args.eventId,competitionId:args.competitionId,
        teamId:args.teamId,athleteId:args.athleteId,
        season:args.season,seasonType:args.seasonType,week:args.week,limit:args.limit,
      },<T>(url:string)=>getFeed<T>(url)))
    },
    presentCall:()=>({card:'generic',title:'Consultar estadísticas ESPN extendidas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_core_catalog',
    description:'Lista las 11 familias de endpoints Core ESPN para cuotas, historial, ATS, futuros, movimientos de mercado, pronósticos y proveedores. No se realiza red ni se gasta cuota.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(){
      return JSON.stringify({source:'ESPN Site/Core API /v2 pública (no oficial)',modes:espnCoreModes,
        endpoints:espnEndpointGuide,workflow:espnWorkflow,guide:'Primero usa sports_chat_games para identificar eventId/competitionId y sports_chat_catalog para league; para ATS e históricos usa teamId y season o providerId genuinos. Consulta un modo por vez mediante sports_chat_espn_core. Providers informa los IDs de las casas en ESPN; su presencia no prueba que haya cuotas publicadas.',
        warning:'Rutas documentadas pero disponibilidad y autorización no garantizadas. No hacer consultas ilimitadas ni tratar resultados de ATS/predictor/históricos como cuotas vigentes.'})
    },
    presentCall:()=>({card:'generic',title:'Catálogo de datos ESPN Core',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_core',
    description:'Lee de ESPN Core público SIN API key: odds por partido/proveedor, movimiento, enfrentamientos, ATS, futures, past-performances, odds-records, probabilities, predictor y providers. Resuelve pocas referencias y devuelve el JSON relevante limitado, con estado real de acceso.',
    parameters:{
      mode:{type:'string',required:true,description:'odds | provider | movement | head_to_heads | ats | futures | past_performances | odds_records | probabilities | predictor | providers'},
      sport:{type:'string',required:true,description:'Slug de deporte ESPN: football, basketball, baseball, hockey, soccer...'},
      league:{type:'string',required:true,description:'Liga ESPN: nfl, nba, mlb, nhl, usa.1, eng.1...'},
      eventId:{type:'string',description:'ID real de partido ESPN para odds, provider, movement, head_to_heads, probabilities, predictor'},
      competitionId:{type:'string',description:'ID competition real, por defecto eventId (ESPN a menudo usa ambos iguales)'},
      teamId:{type:'string',description:'ID ESPN de equipo para ats, odds_records y past_performances'},
      providerId:{type:'string',description:'ID ESPN de proveedor (obtener con mode=providers), obligatorio para provider/movement/head_to_heads/past_performances'},
      season:{type:'integer',description:'Temporada 1900..2100, requerida para ats, odds_records y futures'},
      seasonType:{type:'integer',description:'0..4; ATS por defecto 2 (regular), odds_records por defecto 0'},
      movementType:{type:'integer',description:'Solo mode=movement: 0 moneyline, 1 spread según endpoints comunitarios. Por defecto 0'},
      limit:{type:'integer',description:'1..100, por defecto 25. Hasta 12 muestras y 6 referencias resueltas'},
      page:{type:'integer',description:'Página ESPN 1..1000, por defecto 1'},
      resolveRefs:{type:'boolean',description:'Resolver hasta 6 referencias Core del mismo deporte y liga, por defecto true'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(!Object.hasOwn(espnCoreModes,args.mode))throw Error('Modo ESPN Core no reconocido: consulta sports_chat_espn_core_catalog')
      if((await sportsEnv(ctx)).PHOENIX_SPORTS_ESPN_DISABLED==='1')return JSON.stringify({
        state:'unavailable',provider:'ESPN Core',error:'ESPN deshabilitado expresamente por configuración del host'})
      const input={
        mode:args.mode as EspnCoreMode,sport:args.sport,league:args.league,
        eventId:args.eventId,competitionId:args.competitionId,
        teamId:args.teamId,providerId:args.providerId,season:args.season,
        seasonType:args.seasonType,movementType:args.movementType,
        limit:args.limit,page:args.page,
      }
      const report=await queryEspnCore(input,<T>(url:string)=>getFeed<T>(url),{
        resolveRefs:args.resolveRefs!==false,
      })
      return JSON.stringify({...report,
        instruction:'Muestra solo datos realmente devueltos por ESPN con sus fechas, source y endpoint. Para acceder a la página siguiente incrementa page; no digas que todos los datos históricos están cargados. Solo las líneas de casa identificada, mercado, partido futuro y precio actualizado pueden cotizar tickets; ATS, predictor, probabilidades, futures e históricos son inteligencia complementaria. Si unavailable, indica el error exacto.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar mercados y estadísticas ESPN Core',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_espn_historical_odds',
    description:'Recupera precios HISTÓRICOS ESPN de una fecha: scoreboard diario, Core odds por encuentro y summary/pickcenter, siguiendo pocas $ref seguras. Útil para retrospectiva/backtest, NUNCA para tickets actuales.',
    parameters:{
      sport:{type:'string',required:true,description:'Deporte ESPN: baseball, basketball, football, hockey, soccer, etc.'},
      league:{type:'string',required:true,description:'Liga ESPN: mlb, nba, nfl, nhl, eng.1, etc.'},
      date:{type:'string',required:true,description:'Día anterior AAAA-MM-DD'},
      days:{type:'integer',description:'Número de días consecutivos, 1..3, por defecto 1'},
      eventsPerDay:{type:'integer',description:'Encuentros estudiados por día, 1..8 (por defecto 6)'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if((await sportsEnv(ctx)).PHOENIX_SPORTS_ESPN_DISABLED==='1')
        return JSON.stringify({historical:true,state:'unavailable',error:'ESPN deshabilitado por operador'})
      const report=await fetchEspnHistoricalOdds({
        sport:args.sport,league:args.league,date:args.date,
        days:args.days,eventsPerDay:args.eventsPerDay,
      },<T>(url:string)=>getFeed<T>(url))
      return JSON.stringify({...report,totalRows:report.rows.length,rows:report.rows.slice(0,48),
        instruction:report.rows.length
          ?'Cada fila es HISTÓRICA y no está disponible para tickets actuales. Distingue partido, fuente, mercado, provider y quoteTimestampKnown; si falta lineDate, NO afirmes apertura o cierre.'
          :'Sin precios conservados para esta muestra. Revisar errores y otras fechas: no equivale a ausencia global de históricos ESPN.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar cuotas históricas ESPN',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_odds',
    description:'Consulta por defecto cuotas ESPN Scoreboard, Core y Summary/Pickcenter sin clave. Usa eventId ESPN y date para un partido exacto. sourcePolicy=all compara voluntariamente otros proveedores; sus IDs no se mezclan.',
    parameters:{
      sportKey:{ type:'string',required:true,description:'Clave del proveedor: baseball_mlb, basketball_nba, soccer_epl, etc.' },
      markets:{ type:'string',description:'h2h, totals o spreads. Por defecto h2h.' },
      eventId:{type:'string',description:'ID ESPN real de un encuentro futuro; restringe la búsqueda a ese evento.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD del partido, obtenida del scoreboard.'},
      sourcePolicy:{type:'string',description:'espn (por defecto) o all (comparación multifuente solo sin eventId ni fecha).'},
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx)
      const observedAt=Date.now()
      if(args.sourcePolicy&&!['espn','all'].includes(args.sourcePolicy))throw Error('sourcePolicy debe ser espn o all')
      // ESPN is the primary market source. Other odds vendors are opt-in only,
      // and their unrelated event IDs must never be matched to ESPN event IDs.
      const useEspn=Boolean(args.eventId||args.date||args.sourcePolicy!=='all')
      const report:Awaited<ReturnType<typeof marketOddsDetailed>> & {observations?:Array<{
        eventId:string;bookmaker:string;market:string;selection:string;point:number|null;
        price:number;home:string;away:string;time:string;timeIso:string;updatedAt:string;
        endpointSource?:string;reason:string;source:string;sportKey:string
      }>}=useEspn?
        await (async()=>{
          if(env.PHOENIX_SPORTS_ESPN_DISABLED==='1')return{
            quotes:[],sources:[{provider:'ESPN Site/Core',status:'unconfigured' as const,
              count:0,detail:'ESPN deshabilitado por el operador'}],
          }
          const result=await fetchPublicEspnOddsDetailed(args.sportKey,args.markets??'h2h',
            <T>(url:string)=>getFeed<T>(url),
            {now:observedAt,cache:true,...(args.eventId?{eventId:args.eventId}:{}),
              ...(args.date?{date:args.date}:{}),days:args.date?1:args.eventId?7:3})
          return{
            quotes:result.quotes.map(q=>({...q,sportKey:args.sportKey,
              source:'ESPN '+q.endpointSource+' (sin clave)'})),
            observations:result.observations.map(q=>({...q,sportKey:args.sportKey,
              source:'ESPN '+q.endpointSource+' (referencia no cotizable)'})),
            sources:[{provider:'ESPN Site/Core',status:result.quotes.length?
              'observed' as const:'empty' as const,count:result.quotes.length,
              rawCount:result.diagnostics.rawOddsEntries,
              startedOddsEntries:result.diagnostics.startedOddsEntries,
              undatedOutcomes:result.diagnostics.undatedOutcomes,
              expiredOutcomes:result.diagnostics.expiredOutcomes,
              detail:result.diagnostics.datesQueried.join(', ')+
                ' · evento encontrado: '+String(result.diagnostics.eventMatched)+
                ' · scoreboard '+result.diagnostics.embedded+
                ' · Core '+result.diagnostics.core+
                ' · summary '+result.diagnostics.summary+
                ' · refs '+result.diagnostics.resolvedRefs+
                ' · cuotas sin fecha '+result.diagnostics.undatedOutcomes+
                ' · antiguas '+result.diagnostics.expiredOutcomes+
                ' · fallos '+result.diagnostics.failures+
                ' · '+result.diagnostics.notes.join(' | ').slice(0,350)}],
          }
        })():
        await marketOddsDetailed(args.sportKey,args.markets,env)
      const quotes=report.quotes.filter(q=>{
        const updated=Date.parse(q.updatedAt),kickoff=Date.parse(q.timeIso??q.time)
        return Number.isFinite(updated)&&updated<=observedAt&&observedAt-updated<=3_600_000
          &&Number.isFinite(kickoff)&&kickoff>observedAt
      })
      const excludedStaleOrStarted=report.quotes.length-quotes.length
      const espnRaw=report.sources.find(x=>x.provider==='ESPN Site/Core')?.rawCount??0
      const events=new Map<string,typeof quotes>()
      for(const quote of quotes.slice(0,96)){
        const rows=events.get(quote.eventId)??[]
        if(rows.length<12)rows.push(quote)
        events.set(quote.eventId,rows)
      }
      const uiBlocks=[...events.entries()].slice(0,5).flatMap(([,rows])=>{
        const first=rows[0]
        if(!first)return []
        return [{
          component:'sports_odds_card',version:1,props:{
            title:first.away+' vs '+first.home,
            subtitle:'Mercados reportados por casa; no son probabilidades estimadas',
            source:first.source||'Proveedor consultado',
            rows:rows.map(q=>({ event:q.away+' vs '+q.home,market:q.market,
              selection:q.selection,bookmaker:q.bookmaker,price:q.price.toFixed(2),
              ...(q.point===null||q.point===undefined?{}:{ point:String(q.point) }) })),
            note:'Cuotas observadas al consultar la herramienta. Pueden cambiar antes de cualquier decisión. No se realizó ninguna apuesta.',
          },
        }]
      })
      return JSON.stringify({ uiBlocks,source:quotes[0]?.source||'Sin ofertas recuperadas',sources:report.sources,
        observedAt:new Date(observedAt).toISOString(),requestedSourcePolicy:useEspn?'espn':'all',
        requestedEventId:args.eventId??null,
        requestedDate:args.date??null,excludedStaleOrStarted,outcomes:quotes.slice(0,120),
        researchObservations:(report.observations??[]).slice(0,60),
        total:quotes.length,remaining:Math.max(0,quotes.length-120),
        note:quotes.length?'Ofertas auténticas observadas; elegir la casa y el horario antes de cotizar. No son cuotas automáticamente atribuibles a Juancito.':(report.observations?.length??0)>0?'ESPN devolvió precios en researchObservations con fecha ausente, antigua o proveedor no identificado: son SOLO referencias, nunca cuotas vigentes ni elegibles para ticket.':espnRaw>0?'ESPN Core/Site entregó '+espnRaw+' registros de cuotas, pero ninguno superó las comprobaciones de precio, fecha y vigencia para apostar ahora. Consulta sources.rawCount, undatedOutcomes y expiredOutcomes. No describas ESPN como desconectado ni conviertas líneas históricas en vigentes.':'Sin precios confirmados para esta liga/mercado y fechas consultadas. Revisa las fuentes y amplía la búsqueda; nunca inventes cotizaciones.' })
    },
    presentCall:()=>({ card:'generic',title:'Comparar cuotas',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_research',
    description:'Analiza TODOS los deportes del catálogo ESPN por liga: marcadores terminados, victorias/derrotas/empates, medias anotadas/recibidas, descanso y falta de evidencias. No transforma forma en probabilidad.',
    parameters:{
      sport:{type:'string',required:true,description:'soccer, basketball, baseball, football, hockey, etc.'},
      league:{type:'string',required:true,description:'ID real ESPN del catálogo: nba, mlb, eng.1, usa.1, nfl, nhl, etc.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD; por defecto hoy.'},
      lookbackDays:{type:'integer',description:'Días históricos por liga, 1 a 28; por defecto 14.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await researchSport(args.sport,args.league,args.date,fetch,Date.now(),process.env,args.lookbackDays??14)
      return JSON.stringify({...report,instruction:'Usa solo partidos terminados verificados y destaca faltantes por disciplina; estadísticas descriptivas, NO pronósticos calibrados. Contrasta cuotas reales, plantillas, lesiones, pitching, superficie o porteros según el deporte.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar enfrentamientos por deporte',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_historical_odds',
    description:'Históricos por fecha: archivos gratuitos SBR/MLB y observaciones auténticas que PHOENIX capturó de proveedores desde su instalación. Nunca cuotas actuales.',
    parameters:{
      sport:{type:'string',description:'nba, mlb, nfl, nhl para los archivos públicos; otros deportes requieren observaciones locales.'},
      sportKey:{type:'string',description:'Clave de mercado para snapshots: basketball_nba, baseball_mlb, americanfootball_nfl, soccer_epl, etc.'},
      date:{type:'string',description:'Fecha histórica AAAA-MM-DD. Para snapshots es la fecha UTC de OBSERVACIÓN, no fecha del encuentro.'},
      limit:{type:'integer',description:'Límite de filas (máximo 500), por defecto 100'},
      leagueSlug:{type:'string',description:'Liga OddsHarvester histórica (ej. england-premier-league), opcional.'},
      season:{type:'string',description:'Temporada de OddsHarvester, por ejemplo 2024-2025 o 2025.'},
      market:{type:'string',description:'Mercado histórico, ej. 1x2, moneyline u over_under.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx)
      const limit=Math.min(500,Math.max(1,args.limit??100))
      if(args.date&&!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(args.date))throw Error('Fecha histórica inválida')
      let archived:Awaited<ReturnType<typeof loadHistoricalOdds>>|null=null
      let archiveError:string|null=null
      if(args.sport&&['nba','mlb','nfl','nhl'].includes(args.sport)){
        try{archived=await loadHistoricalOdds(args.sport,env)}
        catch(error){archiveError=error instanceof Error?error.message:'Archivo histórico no accesible'}
      }
      const historical=archived?.historical.filter(row=>!args.date||row.date===args.date).slice(-limit)??[]
      const sportKey=args.sportKey||({nba:'basketball_nba',mlb:'baseball_mlb',
        nfl:'americanfootball_nfl',nhl:'icehockey_nhl'} as Record<string,string>)[args.sport??'']
      const local= sportKey&&args.date?await loadOddsSnapshots(sportKey,args.date,env,limit):
        {snapshots:[],rows:0,coverage:'Para observaciones locales especificar date (día UTC de consulta) y sportKey.',errors:[]}
      const autoRepair=archiveError||archived?.sources.some(x=>!x.available)?await ensureSportsSourcesStarted(process.env):null
      const kind=({soccer:'football',basketball:'basketball',baseball:'baseball',
        americanfootball:'american-football',icehockey:'ice-hockey',tennis:'tennis'} as Record<string,string>)[sportKey?.split('_')[0]??'']
      let scraped:null|Awaited<ReturnType<typeof keylessHistoricOdds>>=null
      let scrapingError:string|null=null
      if(args.leagueSlug&&args.season&&args.market&&kind){
        try{scraped=await keylessHistoricOdds(kind,args.leagueSlug,args.season,args.market,env)}
        catch(error){scrapingError=error instanceof Error?error.message.slice(0,180):'Histórico del scraper no accesible'}
      }
      return JSON.stringify({sport:args.sport??null,sportKey:sportKey??null,date:args.date??null,
        sources:archived?.sources??[],archiveError,autoRepair,liveQuotes:false,
        count:historical.length+local.rows+(scraped?.rows.length??0),archiveCount:historical.length,
        scraperHistoricalCount:scraped?.rows.length??0,scraperHistoricalRows:scraped?.rows??[],scrapingError,
        observedSnapshotCount:local.rows,observationCoverage:local.coverage,
        samples:historical,snapshots:local.snapshots,readErrors:local.errors,
        instruction:'HISTÓRICO (NO COTIZACIÓN VIGENTE). El modo historic de OddsHarvester v0.20 está sujeto a disponibilidad del sitio, liga y temporada. SBR y MLB cubren los años disponibles en archivos instalados; observaciones PHOENIX solo desde que se guardaron. Nunca usar cuotas antiguas como precio apostable hoy. Si no hay archivo reportar error/estado de instalación y fecha sin cobertura.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar históricos de casas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_community_opinions',
    description:'Consulta opiniones y votaciones públicas de pronosticadores desde OddsPortal mediante OddsHarvester; nunca son probabilidades calculadas ni recomendación independiente.',
    parameters:{sport:{type:'string',required:true,description:'Deporte OddsHarvester: football, tennis, basketball, baseball, etc.'}},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const opinions=await communityOpinions(args.sport)
      return JSON.stringify({source:'OddsPortal Community',opinions:opinions.slice(0,15),
        disclaimer:'Votos de usuarios con sesgo de selección; NO probabilidades de ganar. Contrastar con investigación propia.'})
    },
    presentCall:()=>({card:'generic',title:'Contrastar pronósticos públicos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_odds_scan',
    description:'Comprueba sistemáticamente los 11 deportes de OddsHarvester sin omitir tenis, soccer, baseball, basketball NBA/WNBA, rugby, volleyball, cricket y handball. Rondas de cuatro deportes, paginación por offset 0, 4 y 8. No inventa precios ni asigna ligas sin evidencia.',
    parameters:{
      sport:{type:'string',description:'Disciplina opcional (football, basketball, baseball, american-football, ice-hockey, tennis, handball, volleyball, rugby-league, rugby-union, cricket). Vacío recorre las 11.'},
      offset:{type:'integer',description:'Índice inicial: 0, 4 u 8 al revisar todos.'},
      limit:{type:'integer',description:'Máximo cuatro deportes por ronda; por defecto 4.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD de los partidos, por defecto hoy en República Dominicana.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(args){
      const env=await sportsEnv(ctx)
      const enabled=env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED==='1'
      const report=await scanOddsDisciplines(
        {...(args.sport?{sport:args.sport}:{}),
          ...(args.offset!==undefined?{offset:args.offset}:{}),
          ...(args.limit!==undefined?{limit:args.limit}:{})},
        (sport,market)=>keylessOdds(sport,market,args.date,env),
        enabled,
      )
      return JSON.stringify({
        source:'OddsHarvester/OddsPortal',observedAt:new Date().toISOString(),
        installation:managedSportsInstallStatus(process.env),
        availableDisciplines:oddsDisciplines,report,
        instruction:report.complete?
          'Terminó la ronda solicitada. Solo las filas observadas con casa, selección, precio y fecha son cuotas reales del proveedor; liga no verificada no es NBA/WNBA. Si también se necesita ESPN o API comercial consulta sports_chat_odds por liga. Nunca prometas precios en todos los deportes.':
          'FALTAN disciplinas: llamar otra vez sports_chat_odds_scan con offset='+report.nextOffset+' y limit=4; continuar hasta complete=true. No afirmar que el escaneo universal terminó mientras falten páginas.',
      })
    },
    presentCall:()=>({card:'generic',title:'Escanear cobertura de cuotas en todos los deportes',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_odds_keyless',
    description:'Cuotas multideporte sin API key desde OddsHarvester local autorizado: 11 deportes, mercados de prepartido, precios por casa con fuente y antigüedad. No promete acceso ilimitado.',
    parameters:{
      sport:{type:'string',required:true,description:'football, basketball, baseball, american-football, tennis, ice-hockey, rugby-league, rugby-union, handball, volleyball o cricket.'},
      market:{type:'string',required:true,description:'Mercado compatible con deporte: 1x2, double_chance, btts, moneyline, home_away, match_winner, over_under, total_games_over_under, total_sets_over_under o total_points_over_under.'},
      date:{type:'string',description:'Día AAAA-MM-DD en Santo Domingo; predeterminado hoy.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx)
      if(env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED!=='1'
        &&process.env.PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED!=='0'){
        const autoRepair=await ensureSportsSourcesStarted(process.env)
        return JSON.stringify({source:'OddsHarvester',status:'not-ready',
          autoRepair,installation:managedSportsInstallStatus(process.env),
          observedPrices:0,bookmaker:null,
          instruction:'OddsHarvester todavía no está listo. PHOENIX solicitó la instalación/recuperación sin bloquear el chat; NO significa que se hayan obtenido cuotas. Ejecutar sports_chat_sources_health para ver progreso y errores, y consultar el mercado después de que el componente marque installed. Si falta el script o WinGet falló, mostrar la ruta del log y solo comandos PowerShell en la consola.'})
      }
      let quotes:Awaited<ReturnType<typeof keylessOdds>>=[]
      let scrapeError:string|null=null
      try{quotes=await keylessOdds(args.sport,args.market,args.date,env)}
      catch(error){scrapeError=error instanceof Error?error.message.slice(0,1200):'Error del scraper'}
      // The targeted scraping tool must not strand Kira after a blocked page.
      // Query other independently authorized sources, without re-running OddsHarvester.
      const knownSportKeys=coveredSportKeys
      const otherSources:Awaited<ReturnType<typeof marketOddsDetailed>>[]=[]
      if(scrapeError||!quotes.length){
        const alternativeEnv={...env,PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'}
        const candidate=knownSportKeys[args.sport]??[]
        for(const key of candidate.slice(0,5)){
          try{otherSources.push(await marketOddsDetailed(key,
            args.market==='over_under'?'totals':'h2h',alternativeEnv))}
          catch{/* keep the original scraper failure and explicit provider statuses */}
        }
      }
      const grouped=new Map<string,typeof quotes>()
      for(const quote of quotes.slice(0,96)){
        const rows=grouped.get(quote.eventId)??[]
        if(rows.length<12)rows.push(quote)
        grouped.set(quote.eventId,rows)
      }
      const uiBlocks=[...grouped.values()].slice(0,5).flatMap(rows=>{
        const first=rows[0]
        if(!first)return []
        return [{component:'sports_odds_card',version:1,props:{
          title:first.away+' vs '+first.home,
          subtitle:'Mercado '+first.market+' · precios observados, no una predicción',
          source:first.source+' · '+first.updatedAt,
          rows:rows.map(q=>({event:q.away+' vs '+q.home,market:q.market,
            selection:q.selection,bookmaker:q.bookmaker,price:q.price.toFixed(2),
            ...(q.point===null?{}:{point:String(q.point)})})),
          note:'Scraping autorizado, sujeto a disponibilidad y condiciones del sitio. No se ejecutó apuesta.',
        }}]
      })
      return JSON.stringify({source:'OddsHarvester/OddsPortal (sin API key)',supported:keylessSports,
        status:quotes.length?'observed':scrapeError?'scraper-error':'no-observed-offers',
        scrapeError,alternativeSources:otherSources.map(r=>r.sources),
        alternativeQuotes:otherSources.flatMap(r=>r.quotes).filter(q=>{
          const updated=Date.parse(q.updatedAt),kickoff=Date.parse(q.timeIso??q.time),now=Date.now()
          return Number.isFinite(updated)&&updated<=now&&now-updated<=3_600_000&&
            Number.isFinite(kickoff)&&kickoff>now
        }).slice(0,90),
        instructionOnFailure:'Si hay alternativeQuotes, preséntalas por bookmaker (NO las atribuyas a OddsHarvester ni a Juancito). Si ninguna fuente entrega precios, informa errores exactos, ausencia de claves y el estado instalación; no marques installed como live verified.',
        sport:args.sport,market:args.market,observedAt:new Date().toISOString(),total:quotes.length,
        uiBlocks,outcomes:quotes.slice(0,80),remaining:Math.max(0,quotes.length-80),
        instruction:'PHOENIX renderiza tarjetas nativas. No confundir IDs del scraper con IDs ESPN sin reconciliar nombres/fecha/liga. La cuota refleja un precio observado, no una probabilidad propia ni garantía.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar cuotas multideporte sin API key',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_evidence_priced_auto',
    description:'Investiga de 4 a 6 eventos (objetivo diario 5) con historial y datos prepartido, cotiza solo mercados disponibles de una misma casa y separa propuestas de apuestas confirmadas. No inventa cuotas, lesiones ni probabilidades.',
    parameters:{
      count:{type:'integer',required:true,description:'Patas deseadas: objetivo diario 5, rango preferente 4-6 (admite 1 a 6).'},
      date:{type:'string',description:'Fecha AAAA-MM-DD; por defecto hoy.'},
      sport:{type:'string',description:'Limita a soccer, baseball, basketball, football, hockey o tennis; omite para varios deportes.'},
      stake:{type:'number',description:'Monto de simulación; 0 por defecto. No compra apuestas.'},
      marketPreference:{type:'string',description:'winner: ganador directo; double_chance: 1X/X2 para encuentros de fútbol con cuota verificable.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const preference=args.marketPreference??'winner'
      if(preference!=='winner'&&preference!=='double_chance')throw Error('Mercado de ticket inválido')
      const result=await evidencePricedTicket(args.count,args.date,args.sport,args.stake??0,
        Date.now(),await sportsEnv(ctx),fetch,undefined,preference)
      return JSON.stringify({uiBlock:result.card,requestedLegs:args.count,
        complete:result.complete,priced:result.priced,placed:false,
        verifiedEvents:result.verifiedEvents,quotedLegs:result.quotedLegs,
        missingQuotes:result.missingQuotes,approvedLegs:result.approvedLegs,
        multisportSatisfied:result.multisportSatisfied,sourceAudit:result.sourceAudit,
        explanation:result.explanation,
        instruction:'PHOENIX dibuja una PRESELECCIÓN, no apuestas aprobadas. La auditoría sourceAudit indica cuáles fuentes tenían precios realmente observados y cuántos coincidieron. Si approvedLegs=0, aclara 0 apuestas cotizadas aprobadas aunque existan 4 eventos ESPN. No confundir estado del feed médico con bajas individuales comprobadas.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar ticket cotizado de 5 o 6 patas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_evidence_auto',
    description:'Ticket multideporte de 1 a 6 patas, obtenido de marcadores finales verificables de varias ligas (no solo récords). Selecciones independientes por partido; sin probabilidades calibradas ni precios inventados. Incompleto si no hay suficientes.',
    parameters:{
      count:{type:'integer',required:true,description:'Número exacto solicitado: 5 o 6, entre 1 y 6.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD, por defecto hoy.'},
      sport:{type:'string',description:'Limitar a soccer, basketball, baseball, football, hockey o tennis; omitir para multideporte.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await evidenceTicket(args.count,args.date,args.sport,fetch,Date.now(),await sportsEnv(ctx))
      return JSON.stringify({uiBlock:result.card,requestedLegs:args.count,verifiedEvents:result.verifiedEvents,
        complete:result.complete,candidatesEvaluated:result.candidatesEvaluated,
        researchLeagues:result.researchLeagues,insufficientEvidence:result.insufficientEvidence,
        researchStandard:result.researchStandard,scannedSports:result.scannedSports,
        selectedSports:result.selectedSports,multisportSatisfied:result.multisportSatisfied,
        pregameSummariesVerified:result.pregameSummariesVerified,
        injuryFeedsVerified:result.injuryFeedsVerified,deepContextChecked:result.deepContextChecked,
        newsMatched:result.newsMatched,playerStatsChecked:result.playerStatsChecked,priced:false,placed:false,modelProbabilities:false,
        instruction:result.complete?
          'Ticket con exactamente las patas pedidas y resultados históricos verificados, pero aún no cotizado ni calibrado; requiere lesiones, modelos específicos, noticias y precio del operador antes de defenderlo como apuestas de mayor probabilidad.':
          'Borrador incompleto. No sustituyas patas ni inventes cuotas. Indica cuántas selecciones se pudieron fundamentar.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar ticket multideporte por evidencia',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_research_auto',
    description:'PRESELECCIÓN HEURÍSTICA: para NBA exige además resultados completos, margen y descanso, pero NO es probabilidad calibrada ni análisis de lesiones o cuotas; para otros deportes usa récords descriptivos. Respeta el número de patas y marca faltantes.',
    parameters:{
      count:{ type:'integer',required:true,description:'Número de patas que pidió el usuario: de 1 a 6; por ejemplo 5 si pidió un ticket de 5 patas.' },
      date:{ type:'string',description:'Fecha de los partidos AAAA-MM-DD; por defecto hoy en Santo Domingo.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await autoResearchTicket(args.count,args.date)
      return JSON.stringify({ uiBlock:result.card,verifiedEvents:result.verifiedEvents,
        requestedLegs:args.count,complete:result.complete,priced:false,placed:false,
        instruction:result.complete?'Eventos verificados, preselección HEURÍSTICA. NBA requiere marcadores y descanso verificados; aún faltan lesiones, métricas avanzadas y cuotas. No afirmar probabilidad calibrada ni investigación completa.':
          'BORRADOR INCOMPLETO: explica cuántas patas faltan; no digas que cumpliste el número solicitado. Amplía investigación para completar el ticket.' })
    },
    presentCall:()=>({ card:'generic',title:'Investigar ticket con número de patas',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_research',
    description:'GENERA UN TICKET VISUAL REALMENTE RENDERIZABLE de pronósticos para encuentros futuros verificados en ESPN, incluso SIN cuotas ni API key. Úsalo cuando un usuario pida un ticket y sports_chat_odds venga vacío. No lo confundas con un boleto cotizado.',
    parameters:{
      date:{ type:'string',description:'Fecha de los eventos AAAA-MM-DD; por defecto hoy en Santo Domingo.' },
      requestedLegs:{ type:'integer',required:true,description:'Cantidad exacta de patas solicitada por el usuario: 5 cuando pide 5; de 1 a 6.' },
      legs:{ type:'array',required:true,description:'De 1 a 6 selecciones, con IDs de los partidos obtenidos de sports_chat_games y motivos basados en investigación. No inventar IDs.',
        items:{ type:'object',additionalProperties:false,properties:{
          sport:{ type:'string',required:true,description:'Deporte de la cartelera, normalmente soccer.' },
          league:{ type:'string',required:true,description:'Liga ESPN válida, por ejemplo mex.1 o usa.1.' },
          eventId:{ type:'string',required:true,description:'ID real de un partido confirmado en sports_chat_games.' },
          pick:{ type:'string',required:true,description:'home o away; draw solo si es soccer.' },
          rationale:{ type:'string',description:'Fundamento breve de la selección; hipótesis de Kira, no una certeza.' },
        } },
      },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await researchTicket(args.legs as ResearchTicketLeg[],args.date,fetch,Date.now(),process.env,args.requestedLegs)
      return JSON.stringify({ uiBlock:result.card,priced:false,placed:false,verifiedEvents:result.verifiedEvents,requestedLegs:args.requestedLegs,complete:result.complete,
        instruction:'Phoenix renderiza el ticket nativo sin código ni JSON. Explica el fundamento de tus picks y busca casas y cuotas verificables si se solicita un boleto cotizado. No calcules retorno sin cuotas.' })
    },
    presentCall:()=>({ card:'generic',title:'Crear ticket de pronósticos',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket',
    description:'COTIZADOR MANUAL de selecciones ya dadas por el usuario, NO generador de pronósticos: verifica 1-10 precios auténticos y una sola casa, pero NO investiga equipos, bajas, quarterbacks ni modelos. Para pedir ticket ganador usa sports_chat_ticket_evidence_priced_auto o sports_chat_daily_market_shortlist(deep=true), nunca esta vía de cotización.',
    parameters:{
      sportKey:{ type:'string',description:'Clave deportiva de The Odds API. Para varios deportes utiliza sportKeys.' },
      sportKeys:{ type:'array',description:'Claves deportivas para boleto multideporte, máximo seis: NBA, WNBA, MLB, NHL, NFL y Soccer.',items:{ type:'string' } },
      markets:{ type:'string',description:'Lista de mercados h2h,spreads,totals según cuotas reales; por defecto se consultan los tres para cada liga.' },
      selections:{ type:'array',required:true,description:'Entre una y diez selecciones verificables.',
        items:{ type:'object',additionalProperties:false,properties:{
          eventId:{ type:'string',required:true },bookmaker:{ type:'string',required:true },
          market:{ type:'string',required:true },selection:{ type:'string',required:true },
          point:{ type:'number' },
        } } },
      stake:{ type:'number',description:'Importe que el usuario desea consultar en RD$, solo para calcular retorno; no transfiere dinero.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const requestedKeys = args.sportKeys?.length ? args.sportKeys : args.sportKey ? [args.sportKey] : []
      const keys = [...new Set(requestedKeys)]
      if (keys.length < 1 || keys.length > 6) throw new Error('Indica entre 1 y 6 claves deportivas para el ticket.')
      const consultedAt=Date.now()
      const env=await sportsEnv(ctx)
      const quotes = (await Promise.all(keys.map(key => marketOdds(key,args.markets??'h2h,spreads,totals',env)))).flat()
      const current=quotes.filter(q=>{
        const at=Date.parse(q.updatedAt),kickoff=Date.parse(q.timeIso??q.time)
        return Number.isFinite(at)&&at<=consultedAt&&consultedAt-at<=3_600_000&&
          Number.isFinite(kickoff)&&kickoff>consultedAt&&q.price>1&&
          Boolean(q.bookmaker.trim())&&Boolean(q.source?.trim())
      })
      if(!current.length)throw Error('No hay mercados y cuotas actuales confirmables: se requiere fuente, hora de actualización, partido futuro y casa identificada.')
      const { card,warning }=pricedTicket(args.selections as MarketSelection[],current,args.stake)
      const quoteCard={...card,props:{...card.props,
        title:'PHOENIX · Cotización manual sin investigación deportiva',
        subtitle:'Precio real observado · predicción y especialistas NO evaluados',
        note:'SOLO COTIZACIÓN. No se ejecutaron expedientes de NFL/NBA/NHL/MLB/Fútbol/Tenis; ninguna pata está aprobada como pronóstico. '+String(card.props.note??''),
      }}
      return JSON.stringify({ uiBlock:quoteCard,warning,quoteVerified:true,
        researchVerified:false,approvedForBetting:false,
        placed:false,placementStatus:'not-confirmed',
        observedQuotes:current.length,excludedMissingOrStale:quotes.length-current.length,
        observedAt:new Date(consultedAt).toISOString(),
        instruction:'Esta salida es SOLAMENTE una cotización manual sin investigación especializada, NO un ticket ganador listo. No reproduzcas JSON. Para investigar, utiliza la ruta diaria con expedientes obligatorios; nunca prometas ganancias ni aceptación por la casa.' })
    },
    presentCall:()=>({ card:'generic',title:'Crear ticket visual de análisis',kind:'read' as const }),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_mlb_investigate',
    description:'Investigación MLB paso a paso: sin gamePk entrega cartelera oficial verificable; con gamePk recupera roster por jugador, estadísticas de bateo/lanzamiento, abridores, bullpen, matrices bateador×pitchers, forma local/visita, estadio, clima, escenarios y mercados cotejados si existen. No inventa probabilidades ni tickets.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha local AAAA-MM-DD del partido MLB.'},
      gamePk:{type:'integer',description:'GamePk numérico auténtico de MLB Stats API; omitir para ver la cartelera.'},
      includeOdds:{type:'boolean',description:'Si hay gamePk, cotejar cuotas verificadas de la misma jornada. Por defecto true.'},
      matchupOffset:{type:'integer',description:'Página de cruces bateador×pitcher; índice 0 por defecto.'},
      matchupLimit:{type:'integer',description:'Máximo de cruces a devolver por llamada, entre 1 y 80; defecto 40.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now()
      const env=await sportsEnv(ctx)
      let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
      let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
      if(args.gamePk&&args.includeOdds!==false){
        try{
          const report=await marketOddsDetailed('baseball_mlb','h2h,totals,spreads',env,fetch,now)
          quotes=report.quotes
          oddsSources=report.sources
        }catch{/* Dossier remains available when commercial providers fail. */}
      }
      const report=await mlbResearch(args.date,args.gamePk,fetch,now,env,quotes)
      if(report.mode==='schedule'){
        const uiBlock={component:'sports_espn_dashboard',version:1,props:{
          view:'event',title:'PHOENIX · Cartelera MLB · '+args.date,
          subtitle:report.fixtures.length+' partidos verificados · seleccionar gamePk para investigar',
          source:'MLB Stats API · calendario oficial',checkedAt:new Date(now).toISOString(),
          sections:[{heading:'Partidos de la jornada',kind:'list',items:
            report.fixtures.slice(0,30).map(g=>({
              label:g.away.name+' vs '+g.home.name,
              value:g.status+' · '+g.date,
              detail:'MLB gamePk '+g.gamePk+' · '+g.venue.name,
            }))}],
          note:'Cartelera oficial; sin favoritos ni apuestas preseleccionadas. Se requiere investigar un gamePk específico.',
        }}
        return JSON.stringify({...report,uiBlock,
          instruction:'Escoge uno o varios gamePk auténticos de esta cartelera y llama sports_chat_mlb_investigate con el gamePk correspondiente. Nunca atribuyas un ID MLB a ESPN ni un partido comenzado a pregame.'})
      }
      const offset=Math.max(0,Math.min(1000,Math.floor(args.matchupOffset??0)))
      const limit=Math.max(1,Math.min(80,Math.floor(args.matchupLimit??40)))
      const visible=report.matchups.slice(offset,offset+limit)
      const sourceAudit={verified:report.sources.filter(s=>s.status==='verified').length,
        empty:report.sources.filter(s=>s.status==='empty').length,
        errors:report.sources.filter(s=>s.status==='error').slice(0,20)}
      const marketReview=reviewMlbResearch(report)
      return JSON.stringify({...report,marketReview,sources:undefined,matchups:visible,
        matchupTotal:report.matchups.length,matchupOffset:offset,
        matchupNextOffset:offset+visible.length<report.matchups.length?offset+visible.length:null,
        sourceAudit,oddsSources,uiBlock:report.uiBlock,
        instruction:'PHOENIX dibuja la investigación MLB. Presenta el expediente como hechos parciales, no pronóstico calibrado. Analiza las contradicciones y la información pendiente. No afirmar BvP confirmado, roster titular, fatiga, lesiones o efecto del viento sin fuentes explícitas. Comparar precios solo si coinciden ambos equipos/fecha/casa/línea.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar cartelera y expedientes de béisbol MLB',kind:'read' as const}),
  }))


  ctx.tools.register(defineTool({
    name:'sports_chat_soccer_leagues',
    description:'Descubre competiciones mundiales de fútbol reconocidas por el catálogo público ESPN. La presencia no garantiza estadísticas, xG, cuotas ni partidos en cada fecha. Paginación de hasta 500 ligas.',
    parameters:{
      offset:{type:'integer',description:'Posición inicial en el catálogo, desde 0.'},
      limit:{type:'integer',description:'Cantidad de ligas que se muestra, entre 1 y 60.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await soccerLeagueCatalog(fetch,Date.now(),await sportsEnv(ctx))
      const offset=Math.max(0,Math.min(499,Math.floor(args.offset??0)))
      const limit=Math.max(1,Math.min(60,Math.floor(args.limit??25)))
      return JSON.stringify({source:report.source,checkedAt:report.observedAt,
        totalCatalogEntries:report.leagues.length,leagues:report.leagues.slice(offset,offset+limit),
        offset,nextOffset:offset+limit<report.leagues.length?offset+limit:null,
        worldwideComplete:false,note:report.note,
        instruction:'Liga detectada no garantiza cobertura. Escanea múltiples páginas y verifica la cartelera antes de investigar.'})
    },
    presentCall:()=>({card:'generic',title:'Descubrir competiciones de fútbol',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_soccer_world_scan',
    description:'Escanea por páginas de hasta 24 ligas del catálogo mundial ESPN para una fecha. Entrega partidos verificados y nextOffset; no afirma cobertura de todo el planeta ni inventa ligas.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD de cartelera.'},
      offset:{type:'integer',description:'Posición del catálogo desde 0; usar nextOffset de la página anterior.'},
      limit:{type:'integer',description:'Número de ligas por página, entre 1 y 24; defecto 24.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now()
      const p=await soccerWorldPage(args.date,args.offset??0,args.limit??24,
        fetch,now,await sportsEnv(ctx))
      return JSON.stringify({...p,sourceStatus:{
        observed:p.sources.filter(x=>x.status==='observed').length,
        missing:p.sources.filter(x=>x.status==='empty').length,
        failed:p.sources.filter(x=>x.status==='error').map(x=>({url:x.url,error:x.error})).slice(0,12)},
        sources:undefined,
        instruction:'Solo una página del catálogo. Continúa con nextOffset hasta null si se requiere búsqueda global; cualquier proveedor fuera de ESPN no fue consultado. Abre después uno de los eventos en sports_chat_soccer_investigate.'})
    },
    presentCall:()=>({card:'generic',title:'Escanear fútbol mundial por lotes',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_soccer_daily',
    description:'Cartelera de soccer verificada por fecha para 1-12 ligas ESPNs concretas, con IDs, estados, sede y zonas horarias. No escanea miles de ligas sin filtro.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD en el calendario de la liga.'},
      leagues:{type:'array',required:true,description:'1-12 códigos verificados de sports_chat_soccer_leagues, como eng.1, esp.1 o usa.1.',
        items:{type:'string'}},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const r=await soccerDailySlate(args.date,args.leagues,fetch,Date.now(),await sportsEnv(ctx))
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'PHOENIX · Cartelera de fútbol mundial · '+args.date,
        subtitle:r.leagues.length+' ligas consultadas · '+r.games.length+' eventos verificables',
        source:'ESPN público',checkedAt:new Date().toISOString(),
        sections:[{heading:'Partidos por liga y hora',kind:'list',items:r.games.slice(0,30).map(g=>({
          label:g.away.name+' vs '+g.home.name,value:g.league+' · '+g.scheduledAt,
          detail:'ESPN eventId '+g.eventId+' · '+g.status+' · '+g.venue}))}],
        note:'Solo competiciones consultadas; no es cobertura global exhaustiva. Los eventos deben verificarse antes de emitir picks.'}}
      return JSON.stringify({...r,uiBlock,instruction:'La lista no es un pronóstico. Selecciona un eventId concreto y llama sports_chat_soccer_investigate con su misma league y date.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar cartelera mundial de fútbol',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_soccer_players',
    description:'Investiga jugadores por ID de roster de un partido real de fútbol: estadísticas de temporada, gamelog, splits y datos faltantes. Disponible cuando ESPN Common v3 ofrece datos en esa liga. No confirma titulares ni genera probabilidades.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD de un encuentro futuro.'},
      league:{type:'string',required:true,description:'Liga ESPN identificada por sports_chat_soccer_daily.'},
      eventId:{type:'string',required:true,description:'ID ESPN real del evento investigado.'},
      maxPlayers:{type:'integer',description:'Jugadores máximos por club para esta investigación, entre 1 y 20; por defecto 11.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx)
      if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado')
      const slate=await soccerDailySlate(args.date,[args.league],fetch,Date.now(),env)
      const event=slate.games.find(g=>g.eventId===args.eventId)
      if(!event)throw Error('El encuentro no consta en la cartelera verificada')
      if(Date.parse(event.scheduledAt)<=Date.now()||
        event.state==='in'||event.state==='post')
        throw Error('Esta investigación se ha definido para un partido prepartido')
      if(!sportsCatalog.soccer?.includes(args.league))
        return JSON.stringify({eventId:event.eventId,league:args.league,
          status:'unsupported-for-player-detail',athletes:[],
          missingEvidence:['Esta liga se descubrió en ESPN Core, pero el adaptador de estadísticas individuales Common v3 no confirma cobertura. No inventar datos.']})
      const maxPlayers=Math.max(1,Math.min(20,Math.floor(args.maxPlayers??11)))
      const report=await collectDirectEspnStats('soccer',args.league,
        [{id:event.home.id,name:event.home.name},{id:event.away.id,name:event.away.name}],
        fetch,Date.now(),maxPlayers)
      return JSON.stringify({eventId:event.eventId,league:args.league,
        teams:report.teams.map(t=>({id:t.id,name:t.name,totalRoster:t.athleteCount,
          researched:t.selectedCount,athletes:t.athletes.map(p=>({
            id:p.id,name:p.name,position:p.position,stats:p.stats,
            lastGames:p.lastGames,splits:p.splits,status:p.status,
            verifiedSources:p.verifiedSources})),coverage:t.coverage})),
        requests:report.requests,errors:report.errors,source:report.source,
        checkedAt:report.checkedAt,limitations:report.limitations,
        instruction:'Los atletas están enlazados al roster real, pero no se garantiza titularidad. No usar stats vacías como cero; identifica muestras y fecha. Compara con delanteros, laterales, centrales y guardameta del rival en su expediente.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar estadísticas individuales de fútbol',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_soccer_investigate',
    description:'Expediente profundo de fútbol por evento real: equipos, forma local/visita, roster y once confirmado, duelos ofensivos-defensivos, lesiones, noticias, estadio, árbitro, clima, escenarios y cotejo de cuotas verificadas. Sin probabilidades inventadas.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha de la cartelera AAAA-MM-DD.'},
      league:{type:'string',required:true,description:'Código de liga ESPN confirmado, p. ej. usa.1, esp.1.'},
      eventId:{type:'string',required:true,description:'ID verificado del partido, obtenido de sports_chat_soccer_daily.'},
      includeOdds:{type:'boolean',description:'Intentar consultar cuotas actuales de la liga, cuando hay proveedor. Predeterminado sí.'},
      duelOffset:{type:'integer',description:'Índice de paginación de duelos individuales, inicial 0.'},
      duelLimit:{type:'integer',description:'Cantidad de duelos por respuesta, de 1 a 30.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now(),env=await sportsEnv(ctx)
      const oddsKeys:Record<string,string>={
        'eng.1':'soccer_epl','esp.1':'soccer_spain_la_liga',
        'mex.1':'soccer_mexico_ligamx','usa.1':'soccer_usa_mls',
        'uefa.champions':'soccer_uefa_champs_league',
      }
      const key=oddsKeys[args.league]
      let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
      let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
      if(key&&args.includeOdds!==false){
        try{
          const report=await marketOddsDetailed(key,'h2h,totals,spreads',env,fetch,now)
          quotes=report.quotes;oddsSources=report.sources
        }catch{/* No cross-provider prices may be invented. */}
      }
      const dossier=await investigateSoccer(args.date,args.league,args.eventId,fetch,now,env,quotes)
      const offset=Math.max(0,Math.min(1000,Math.floor(args.duelOffset??0)))
      const limit=Math.max(1,Math.min(30,Math.floor(args.duelLimit??20)))
      const shown=dossier.duels.slice(offset,offset+limit)
      return JSON.stringify({...dossier,sourceReport:undefined,duels:shown,
        duelTotal:dossier.duels.length,
        duelNextOffset:offset+shown.length<dossier.duels.length?offset+shown.length:null,
        oddsSources,sourceStatus:{
          observed:dossier.sourceReport.filter(x=>x.status==='observed').length,
          failures:dossier.sourceReport.filter(x=>x.status==='error')},
        instruction:'Kira debe expresar hipótesis y contradicciones con fuentes. El roster no confirma XI, titular indexado no confirma pick, y 1X2 de 90 minutos no incluye necesariamente prórroga. No presentar probabilidad, EV o recomendación aprobada sin validación.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar partido de fútbol y mercados',kind:'read' as const}),
  }))


  ctx.tools.register(defineTool({
    name:'sports_chat_basketball_intelligence_slate',
    description:'Cartelera verificable NBA o WNBA por fecha, con IDs, sedes, estatus y ausencia de juegos en offseason; sin favoritos preseleccionados.',
    parameters:{
      league:{type:'string',required:true,description:'nba o wnba.'},
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD del calendario.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(args.league!=='nba'&&args.league!=='wnba')throw Error('Liga NBA/WNBA inválida')
      const report=await basketballSlate(args.league,args.date,fetch,Date.now(),await sportsEnv(ctx))
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'PHOENIX · '+args.league.toUpperCase()+' · '+args.date,
        subtitle:report.games.length+' partidos identificados',source:'ESPN público',
        checkedAt:new Date().toISOString(),
        sections:[{heading:'Encuentros verificados',kind:'list',items:report.games.slice(0,25).map(g=>({
          label:g.away.name+' vs '+g.home.name,value:g.start+' · '+g.status,
          detail:'eventId '+g.eventId+' · '+g.venue}))}],
        note:report.offseason?'ESPN no publicó juegos para la fecha; no se crean enfrentamientos.':
          'La cartelera no constituye una recomendación de apuesta. Usa el eventId para abrir el expediente.'}}
      return JSON.stringify({...report,uiBlock,instruction:'Para profundizar llama sports_chat_nba_intelligence o sports_chat_wnba_intelligence con eventId exacto.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar cartelera de NBA y WNBA',kind:'read' as const}),
  }))
  const registerBasketballIntelligence=(league:BasketballLeague)=>{
    ctx.tools.register(defineTool({
      name:league==='nba'?'sports_chat_nba_intelligence':'sports_chat_wnba_intelligence',
      description:'Expediente NBA/WNBA basado en partido real: forma, roster, cinco titulares, estadísticas individuales, matchups defensivos, lesiones, noticias, escenarios Q1-Q4, mercados de casas y contradicciones.',
      parameters:{
        date:{type:'string',required:true,description:'Fecha AAAA-MM-DD de juego futuro.'},
        eventId:{type:'string',required:true,description:'ID ESPN del encuentro en la liga seleccionada.'},
        maxPlayers:{type:'integer',description:'Atletas investigados por club, de 1 a 20; defecto 15.'},
        matchupOffset:{type:'integer',description:'Página de duelos, desde índice 0.'},
        includeOdds:{type:'boolean',description:'Consultar cuotas reales actuales de la liga, por defecto sí.'},
      },
      output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
      isConcurrencySafe:()=>true,
      async execute(args){
        const now=Date.now(),env=await sportsEnv(ctx)
        let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
        let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
        if(args.includeOdds!==false){
          try{
            const odds=await marketOddsDetailed(
              league==='nba'?'basketball_nba':'basketball_wnba','h2h,spreads,totals',env,fetch,now)
            quotes=odds.quotes;oddsSources=odds.sources
          }catch{/* Un proveedor sin respuesta NO autoriza inventar cuotas. */}
        }
        const dossier=await researchBasketballCase(league,args.date,args.eventId,fetch,now,env,
          quotes,args.maxPlayers??15)
        const offset=Math.max(0,Math.min(300,Math.floor(args.matchupOffset??0)))
        return JSON.stringify({...dossier,sources:undefined,
          matchups:dossier.matchups.slice(offset,offset+15),
          matchupTotal:dossier.matchups.length,
          matchupNextOffset:offset+15<dossier.matchups.length?offset+15:null,
          sourceStatus:{ok:dossier.sources.filter(x=>x.status==='verified').length,
            failed:dossier.sources.filter(x=>x.status==='error')},
          oddsSources,
          instruction:'Kira revisa argumentos a favor y en contra y datos faltantes por mercado. No asumir lineup por roster ni lesión confirmada por silencio. La duración NBA 48 y WNBA 40 cambia ritmo; no inventar EV ni pronóstico de ganador.'})
      },
      presentCall:()=>({card:'generic',title:'Investigar '+league.toUpperCase()+' en profundidad',kind:'read' as const}),
    }))
  }
  registerBasketballIntelligence('nba')
  registerBasketballIntelligence('wnba')

  ctx.tools.register(defineTool({
    name:'sports_chat_nfl_slate',
    description:'Consulta NFL calendario oficial por fecha con identificadores, hora, estado y equipos reales, sin inventar juegos.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD de la cartelera NFL.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now()
      const r=await nflSlate(args.date,fetch,now,await sportsEnv(ctx))
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'PHOENIX · NFL '+args.date,
        subtitle:r.games.length+' encuentros verificables',source:'ESPN público',
        checkedAt:new Date(now).toISOString(),
        sections:[{heading:'Cartelera NFL',kind:'list',
          items:r.games.slice(0,24).map(g=>({
            label:g.away.name+' vs '+g.home.name,value:g.scheduledAt+' · '+g.state,
            detail:'eventId ESPN '+g.eventId+' · '+g.venue}))}],
        note:'La cartelera no confirma quarterbacks titulares, activos/inactivos ni cuotas. Abrir expediente por eventId exacto.'}}
      return JSON.stringify({...r,uiBlock,
        instruction:'No inferir predicción; para investigación abre sports_chat_nfl_investigate con date y eventId exactos.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar cartelera NFL',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_nfl_investigate',
    description:'Expediente NFL por evento real pregame: roster completo, QB/WR/RB/TE/OL/defensa, 11 titulares por unidad si confirmados, stats individuales, descanso, clima, lesiones y cuotas auténticas con contradicciones.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD de NFL, partido futuro.'},
      eventId:{type:'string',required:true,description:'ID ESPN de la cartelera de NFL.'},
      maxPlayers:{type:'integer',description:'Hasta 20 atletas por club con estadísticas individuales profundas, defecto 20. El roster completo se consulta aparte.'},
      matchupOffset:{type:'integer',description:'Inicio de la página de enfrentamientos, desde cero.'},
      includeOdds:{type:'boolean',description:'Consultar líneas reales de NFL si la casa las proporciona, defecto sí.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now(),env=await sportsEnv(ctx)
      let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
      let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
      if(args.includeOdds!==false){
        try{
          const odds=await marketOddsDetailed('americanfootball_nfl','h2h,spreads,totals',
            env,fetch,now)
          quotes=odds.quotes;oddsSources=odds.sources
        }catch{/* Never invent a bookmaker quote on provider failure. */}
      }
      const dossier=await investigateNfl(args.date,args.eventId,fetch,now,env,quotes,
        args.maxPlayers??20)
      const offset=Math.max(0,Math.min(250,Math.floor(args.matchupOffset??0)))
      return JSON.stringify({...dossier,sources:undefined,
        matchups:dossier.matchups.slice(offset,offset+20),
        matchupCount:dossier.matchups.length,
        matchupNextOffset:offset+20<dossier.matchups.length?offset+20:null,
        sourcesReport:{observed:dossier.sources.filter(x=>x.status==='observed').length,
          failed:dossier.sources.filter(x=>x.status==='error').slice(0,12)},
        oddsSources,
        instruction:'Comparar QB/OL, WR vs secondary y RB vs front seven. Identidad completa por roster NO confirma 11 ofensivos + 11 defensivos. Comprobar inactivos, health, viento y período OT. Ningún precio sin bookmaker/evento real, ni ticket aprobado automáticamente.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar NFL · QB, defensas y props',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name:'sports_chat_tennis_slate',
    description:'Cartelera ATP o WTA con matchId, eventId, dos jugadores por ID, torneo, hora y estado; omite partidos sin identificador o horario individual verificable.',
    parameters:{
      tour:{type:'string',required:true,description:'Circuito ATP o WTA, minúsculas atp/ wta.'},
      date:{type:'string',required:true,description:'Fecha YYYY-MM-DD de la cartelera.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(args.tour!=='atp'&&args.tour!=='wta')throw Error('Circuito ATP/WTA inválido')
      const now=Date.now()
      const r=await tennisSlate(args.tour,args.date,fetch,now,await sportsEnv(ctx))
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'PHOENIX · '+args.tour.toUpperCase()+' · '+args.date,
        subtitle:r.matches.length+' partidos por ID ESPN',source:'ESPN Tennis',
        checkedAt:new Date(now).toISOString(),
        sections:[{heading:'Encuentros y rondas',kind:'list',items:r.matches.slice(0,30).map(m=>({
          label:m.players[0].name+' vs '+m.players[1].name,
          value:m.start+' · '+m.state,
          detail:m.tournament+' · '+m.round+' · matchId '+m.matchId}))}],
        note:'El horario del partido, no el inicio de un torneo, es la fuente de pregame. Rankings, servicio y cuotas requieren consulta independiente.'}}
      return JSON.stringify({...r,uiBlock,
        instruction:'Para investigar un encuentro escoge matchId exacto y ejecuta sports_chat_tennis_investigate(tour,date,matchId). No generar apuestas sin precio real.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar cartelera ATP/WTA',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_tennis_investigate',
    description:'Expediente de tenis ATP/WTA por matchId con perfiles, ranking si se observa, servicio y devolución, últimos partidos verificables, superficie, formato y cuotas con reglas de retiro.',
    parameters:{
      tour:{type:'string',required:true,description:'atp o wta explícito.'},
      date:{type:'string',required:true,description:'Fecha AAAA-MM-DD.'},
      matchId:{type:'string',required:true,description:'matchId real devuelto por la cartelera del mismo tour y día.'},
      includeOdds:{type:'boolean',description:'Consultar cuotas reales ATP/WTA, defecto sí.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(args.tour!=='atp'&&args.tour!=='wta')throw Error('Circuito ATP/WTA inválido')
      const tour:TennisTour=args.tour
      const now=Date.now(),env=await sportsEnv(ctx)
      let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
      let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
      if(args.includeOdds!==false){
        try{
          const odds=await marketOddsDetailed('tennis_'+tour,'h2h,totals',env,fetch,now)
          quotes=odds.quotes;oddsSources=odds.sources
        }catch{/* No synthetic odds on errors. */}
      }
      const dossier=await investigateTennis(tour,args.date,args.matchId,fetch,now,env,quotes)
      return JSON.stringify({...dossier,sources:undefined,
        sourceStatus:{ok:dossier.sources.filter(x=>x.status==='observed').length,
          missing:dossier.sources.filter(x=>x.status!=='observed').slice(0,20)},
        oddsSources,
        instruction:'Kira debe comparar primer y segundo saque contra devolución rival, superficie, sets, descanso y evidencia contradictoria. Perfil sin statistics no es 0; ranking ausente no es sin ranking. La oferta debe coincidir ambos atletas, circuito, fecha, bookmaker y ruleset para retiro/walkover/super-tiebreak. No declarar ticket ganador ni P(win) inventada.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar ATP/WTA · servicio y devolución',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name:'sports_chat_hockey_slate',
    description:'Cartelera NHL oficial por fecha, equipo, NHL gameId, hora y estatus; calendario sin resultados ficticios.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha calendario AAAA-MM-DD de NHL.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now(),result=await nhlSlate(args.date,fetch,now)
      const uiBlock={component:'sports_espn_dashboard',version:1,props:{
        view:'event',title:'PHOENIX NHL · '+args.date,
        subtitle:result.games.length+' encuentros verificados con NHL',
        source:'NHL Web API',checkedAt:new Date(now).toISOString(),
        sections:[{heading:'Cartelera NHL',kind:'list',
          items:result.games.map(g=>({label:g.away.name+' vs '+g.home.name,
            value:g.date+' · '+g.state,
            detail:'gameId NHL '+g.id+' · '+g.venue})).slice(0,30)}],
        note:'Una cartelera no certifica porteros, líneas, lesiones, cuotas ni favoritos. Usa el gameId en sports_chat_nhl_investigate.'}}
      return JSON.stringify({...result,uiBlock,
        instruction:'Elige NHL gameId oficial y consulta sports_chat_nhl_investigate. No confundas gameId NHL con eventId ESPN.'})
    },
    presentCall:()=>({card:'generic',title:'Consultar cartelera NHL',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_nhl_investigate',
    description:'Investigar NHL por NHL gameId de cartelera: rosters, candidatos a portero, skaters, stats individuales, tabla, duelos posibles, períodos, cuotas y argumentos contra. No inventa starting goalie ni probabilidades.',
    parameters:{
      date:{type:'string',required:true,description:'Fecha del partido AAAA-MM-DD.'},
      gameId:{type:'string',required:true,description:'NHL gameId oficial obtenido de sports_chat_hockey_slate.'},
      maxSkaters:{type:'integer',description:'Número de forwards por equipo a investigar en detalle, entre 1 y 15; defecto 8.'},
      includeOdds:{type:'boolean',description:'Consultar cuotas NHL observadas si proveedor disponible; por defecto sí.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const now=Date.now(),env=await sportsEnv(ctx)
      let quotes:Awaited<ReturnType<typeof marketOddsDetailed>>['quotes']=[]
      let oddsSources:Awaited<ReturnType<typeof marketOddsDetailed>>['sources']=[]
      if(args.includeOdds!==false){
        try{
          const r=await marketOddsDetailed('icehockey_nhl','h2h,spreads,totals',env,fetch,now)
          quotes=r.quotes;oddsSources=r.sources
        }catch{/* Source absent is not a synthetic quote. */}
      }
      const d=await investigateNhl(args.date,args.gameId,fetch,now,quotes,args.maxSkaters??8)
      return JSON.stringify({...d,sources:undefined,
        sourceAudit:{verified:d.sources.filter(s=>s.status==='verified').length,
          failures:d.sources.filter(s=>s.status==='error').slice(0,20)},
        oddsSources,
        instruction:'Kira: no afirmar portero confirmado, lineup fijo, duelo real, xG/GSAx ni valor esperado sin fuente. Examina porteros y skaters versus el rival, PP/PK, descanso y lesiones pendientes. Distingue mercados 60 minutos, OT y shootout; abstenerse si falta evidencia.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar NHL · porteros y mercados',kind:'read' as const}),
  }))

  ctx.tools.register(defineTool({
    name:'sports_chat_source_resilience',
    description:'Auditoría de fuentes gratuitas y de respaldo para el ticket diario: capacidades realmente integradas frente a enlaces, estado por partido, controles de identidad y carencias de lesiones/cuotas. Sin prometer ganadores ni extraer datos restringidos.',
    parameters:{
      sport:{type:'string',description:'Disciplina si se desea cotejar un partido concreto.'},
      league:{type:'string',description:'Código ESPN de liga para cotejo exacto.'},
      eventId:{type:'string',description:'ID ESPN verificable del encuentro.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD del encuentro.'},
      home:{type:'string',description:'Equipo local observado en cartelera principal.'},
      away:{type:'string',description:'Equipo visitante observado en cartelera principal.'},
      kickoff:{type:'string',description:'Hora UTC ISO8601 ya verificada en ESPN.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=await sportsEnv(ctx),now=Date.now()
      const fields=[args.sport,args.league,args.eventId,args.date,
        args.home,args.away,args.kickoff]
      const complete=fields.every(value=>typeof value==='string'&&value.trim())
      if(fields.some(value=>value!==undefined)&&!complete)
        throw Error('Para verificar un partido especificar deporte, liga, eventId, fecha, local, visita y kickoff completo')
      const fixture=complete?{
        sport:args.sport!,league:args.league!,eventId:args.eventId!,
        date:args.date!,home:args.home!,away:args.away!,kickoff:args.kickoff!,
      }:null
      const checks=fixture?await crosscheckFreeFixture(fixture,fetch,now,env):[]
      const injury=fixture?.sport==='football'&&fixture.league==='nfl'?
        await nflverseInjuryReport(fixture,fetch,now,env):null
      return JSON.stringify({
        checkedAt:new Date(now).toISOString(),
        providers:freeSourceInventory,
        coverageBySport:args.sport?freeSourceCoverageForSport(args.sport,env):
          Object.keys(sportsCatalog).map(sport=>freeSourceCoverageForSport(sport,env)),
        liveAccess:{
          espn:env.PHOENIX_SPORTS_ESPN_DISABLED!=='1',
          officialMlb:env.PHOENIX_SPORTS_MLB_DISABLED!=='1',
          freeBackups:env.PHOENIX_SPORTS_FREE_BACKUPS_DISABLED!=='1',
          footballDataTokenConfigured:!!env.PHOENIX_FOOTBALL_DATA_TOKEN?.trim(),
          apiFootballConfigured:!!env.PHOENIX_API_FOOTBALL_KEY?.trim(),
          balldontlieConfigured:!!env.PHOENIX_BALLDONTLIE_API_KEY?.trim(),
          oddsV4Configured:!!env.THE_ODDS_API_KEY?.trim(),
          oddsSecondConfigured:!!env.THEODDSAPI_API_KEY?.trim(),
        },
        fixture:fixture?{sport:fixture.sport,league:fixture.league,
          eventId:fixture.eventId,date:fixture.date}:null,
        corroboration:checks,injuryReport:injury,
        evidenceStillPending:fixture?freeOfficialFollowUps(fixture.sport,fixture.date):[],
        recommendation:'Si falla un proveedor, usar los disponibles y ampliar ligas/candidatos. Una fuente del catálogo no prueba respuesta real; las cuotas requieren casa, mercado, timestamp y selección exacta. Si no se completan 5/6 patas con respaldo auténtico, presentar borrador explícitamente condicionado o incompleto, no inventar precios ni titulares.'
      })
    },
    presentCall:()=>({card:'generic',title:'Auditar fuentes deportivas gratuitas y respaldos',kind:'read' as const}),
  }))

}
