/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, discoverEspnLeagues, chatGames, compactSportsSchedule, marketOdds, marketOddsDetailed, pricedTicket, getFeed, type MarketSelection } from './sports.ts'
import { getMlbPitcherReport } from './mlb.ts'
import { researchTicket, autoResearchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { sportsPromptNeeded } from './sports-prompt.ts'
import { researchNbaSlate } from './nba-research.ts'

import { keylessOdds, keylessSports, keylessHistoricOdds } from './keyless-odds.ts'
import { loadHistoricalOdds } from './sports-archive.ts'
import { loadOddsSnapshots } from './odds-snapshots.ts'
import { researchSport } from './multi-sport-research.ts'
import { communityOpinions } from './sports-community.ts'
import { evidenceTicket } from './evidence-ticket.ts'
import { evidencePricedTicket } from './evidence-priced-ticket.ts'
import { ensureSportsSourcesStarted,hydrateSportsSources,managedSportsInstallStatus,sportsSourcesHealth } from './sports-source-health.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { auditUniversalMatchup } from './universal-matchup-factors.ts'
import { exploreEspn, type EspnExplorerInput } from './espn-intelligence.ts'
import { compareBettingMarkets,supportedMarketFamilies } from './sports-market-intelligence.ts'
import { describeBettingMarkets } from './sports-bet-markets.ts'
import { checkSportsTicket, type SportsBetLeg } from './sports-bet-settlement.ts'
import { espnCoreModes,queryEspnCore,type EspnCoreMode } from './espn-core-intelligence.ts'
import { fetchPublicEspnOddsDetailed } from './espn-odds.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
const sportsEnv=():NodeJS.ProcessEnv=>hydrateSportsSources(process.env)
const GUIDANCE = [
  'ODDS REALES Y HISTORIALES: sports_chat_odds ahora consulta varias fuentes independientes y devuelve estado observado/vacío/error/no configurado por proveedor. No declares sin cuotas hasta evaluar sources y buscar fecha y mercados reales por liga. OddsHarvester v0.20.0 permite transmitir filas NDJSON para recuperar partidos cotizados incluso si otras páginas del scraping fallan; distingue precios recuperados de scraping completamente exitoso. sports_chat_historical_odds acepta fecha y clave de deporte para leer archivos públicos locales y los snapshots de cotizaciones realmente vistos por PHOENIX. Los históricos NO son precios actuales, y el archivo local solo cubre desde que se capturaron observaciones: no inventar historial ausente. The Odds API v4 y TheOddsAPI requieren sus respectivas claves; la disponibilidad histórica completa suele ser de planes pagados. No prometas que las cotizaciones son de Juancito si el bookmaker indicado es otro. ',
  'JUANCITO SPORT: utiliza como fuente PRIMARIA su reglamento oficial https://www.juancitosport.com.do/reglas/ y términos https://www.juancitosport.com.do/banca/terminos/. Las reglas verificadas incluyen 3/5/9 innings, run line, ponches, hits, medio tiempo, props, 90 minutos fútbol y overtime diferenciado. Una apuesta solo es válida al mostrar el sistema «Apuesta Confirmada» (8.4); el mínimo publicado es RD$100 (7.10). Su condición 6.6 PROHÍBE usar robots o scripts para realizar apuestas: Kira NO debe automatizar clicks ni apuestas en esa web. Puede investigar fuentes, calcular y entregar el ticket; el usuario realiza la confirmación legalmente en la banca. El sitio juancitosports.com es informativo independiente: NO atribuirle reglamentos oficiales. ',
  'APUESTAS REALES NO FICTICIAS: si el usuario pide un ticket para apostar dinero real, NO respondas por defecto «simulado», «apuesta ficticia» o «no puedo investigar apuestas». Investiga eventos y mercados verificables, contrasta las reglas EXACTAS de la casa con sports_chat_bet_rules, obtiene precios reales por fuente con sports_chat_odds, sports_chat_odds_keyless y sports_chat_market_intelligence; si no hay ofertas auténticas no inventes cuotas. Un boleto cotizado NO equivale a una apuesta aceptada. Solo tras confirmación independiente del comprobante de la casa se puede declarar colocada; sin ella di «ticket cotizado, pendiente de aceptación». No ejecutes apuestas ni transferencias sin autorización explícita y una integración oficial operativa. Las reglas oficiales varían para extra innings, suspensiones, jugadores inactivos, pitcher listado, push, overtime y mercados por período. Prioriza mercados no limitados a ganador: spread/run line, -1.5/+1.5, totales 3/5/9 entradas, props de ponches/hits, handicaps, puntos, tiros, córners y más. Los precios solo son reales si se observan con casa, mercado exacto, línea, momento y correspondencia de evento. La calculadora del ticket se actualiza con el importe sin transferir fondos. Tras la fecha consulta sports_chat_ticket_track con IDs y recibo si lo hay para grados provisionales según marcador y jamás declares cobro/void confirmado sin liquidación oficial.',
  'MATCHUP FACTORS UNIVERSAL: si el usuario pide favorito bien investigado, ventaja o desventaja, cruces, rendimiento en estadio, H2H, abridores MLB o carreras en 3/5/9 innings, llama sports_chat_matchup_factors con ID real y fecha ESPN. Combina forma reciente, descansos, enfrentamientos, sede, MLB tramos de entradas, abridores probables y últimas salidas, partes médicos, noticias y cuotas reconciliadas. Una media histórica de carreras no es predicción calibrada: no declares ganador cierto, porcentaje propio, ventaja de EV, o impacto causal del clima sin modelo validado. Si clima, bullpen, rotación, alineación, xG o condiciones del estadio carecen de fuentes, marca PENDIENTE y explica qué dato falta. Usa el panel adaptativo dentro del chat, no menús. ',
  'ESPN ODDS POR PARTIDO: sports_chat_odds admite eventId real de sports_chat_games y fecha local AAAA-MM-DD para consultar un encuentro concreto, verificando primero el scoreboard, luego ESPN Core (lista de casas y refs seguras) y finalmente summary/pickcenter. Devuelve endpointSource, casa, mercado, línea, fecha de actualización y diagnósticos. Si eventId no coincide con la fecha o el partido ya empezó, no lo presentes como cuota vigente. sports_chat_espn_core sirve para consultar por separado movement, odds_records, ATS, futures, probabilities y predictor; son datos para análisis, NO tickets apostables sin oferta actual. ESPN puede devolver cero odds; nunca conviertas un predictor en moneyline ni atribuyas un precio de otra casa a Juancito. ',
  'ESPN INTELLIGENCE: cuando el usuario pida un equipo específico, un jugador, su historia, splits, gamelog, tabla, líderes, noticias o búsqueda, consulta sports_chat_espn_explore con la vista apropiada y un ID real comprobado. Esa herramienta devuelve una superficie adaptable de estadísticas, noticias, plantillas, fotos y fuentes; Phoenix dibuja sports_espn_dashboard automáticamente. Para carteleras utiliza sports_chat_games y para cuotas comercializables sports_chat_odds; evita convertir probabilidades ESPN o referencias Core en cuotas actuales. Las plantillas se construyen dinámicamente a partir de secciones verificadas, sin nuevas pantallas.',
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, sports_chat_ticket, sports_chat_ticket_research, sports_chat_ticket_research_auto, sports_chat_nba_research, sports_chat_research, sports_chat_historical_odds, sports_chat_community_opinions, sports_chat_odds_keyless, sports_chat_sources_health, sports_chat_sources_repair, sports_chat_deep_research, sports_chat_matchup_factors, sports_chat_bet_rules, sports_chat_ticket_track, sports_chat_market_intelligence, sports_chat_espn_core, sports_chat_espn_core_catalog, sports_chat_ticket_evidence_auto o sports_chat_ticket_evidence_priced_auto.',
  'NO abras pantallas independientes ni crees entradas de menú. Antes de redactar una cartelera o boleto, llama sports_chat_games y, cuando corresponda, sports_chat_mlb_pitchers / sports_chat_odds / sports_chat_ticket. Phoenix dibuja de manera nativa las tarjetas verificadas de los resultados. NO copies el JSON de los resultados en la respuesta, NO escribas fences generative-ui ni bloques de código, aunque una herramienta los incluya en sus datos. No dibujes tickets con caracteres ASCII, bordes de texto ni bloques de código etiquetados text: para eventos y selecciones reales usa exclusivamente los contratos nativos, conservando la presentación original de Phoenix. Si el usuario quiere solo una demostración, descríbela explícitamente como ficticia y no introduzcas cuotas o equipos inventados como hechos. Explica los hallazgos y las fuentes con un texto humano breve.',
  'INVESTIGACIÓN NBA: antes de defender cualquier favorito o selección NBA, consulta sports_chat_nba_research (y sports_chat_odds cuando existan cuotas). Contrasta forma en marcadores finales, márgenes, descanso y muestra; revisa además informe oficial de lesiones, rotaciones, estadísticas avanzadas, rival, localía y movimiento de precios desde fuentes autorizadas. Lo no consultado debe permanecer explícitamente SIN VERIFICAR. No transformes la forma descriptiva en porcentajes de victoria ni cites atletas que no tengan plantilla actual confirmada. Un ticket automático se considera SOLO una preselección, nunca una investigación completa.',
  'INVESTIGAR TODOS LOS DEPORTES: llama sports_chat_research para estudiar los marcadores finales recientes del deporte y liga que el usuario pidió. Para MLB complementa con pitchers y bullpen; fútbol exige revisar goles, localía, bajas, forma y opciones 1X2/doble oportunidad; tenis requiere superficie, historial y fatiga; hockey necesita portero y estadísticas defensivas; en otros deportes usa métricas propias. Si el informe indica insuficiente, no proclames favorito respaldado. sports_chat_historical_odds agrega históricos de ambos repositorios SportsbookReview para entrenamiento/backtest, jamás cuotas actuales; y sports_chat_community_opinions observa pronósticos públicos solo como opinión separada.',
  'Si la primera auto-instalación falla o se queda en retry-cooldown, llama sports_chat_sources_repair a petición del usuario; nunca solicites claves para OddsHarvester. Avisa cuando esté instalando y vuelve a verificar el manifest antes de buscar cuotas. ',
  'AUTOREPARACIÓN: sports_chat_sources_health inicia automáticamente el instalador en segundo plano cuando falta (autoRepair.status=started/running); no digas que el scraper está bloqueado definitivamente mientras se esté instalando. Si autoRepair.status=missing-installer, informa que faltan los scripts en el runtime y da la ruta de checkout; si retry-cooldown o error, indica el log y pide diagnóstico sin inventar. Nunca pegues instrucciones en lenguaje natural en PowerShell: solamente comandos PowerShell copiados literalmente, distintos del mensaje de chat para Kira. ',
  'INSTALACIÓN AUTOMÁTICA: OddsHarvester 0.20.0 requiere Python 3.12+ y Playwright Chromium. El manifest del actualizador guarda el estado separado de los resultados de mercado. Cuando la fuente marque desactivado o sin datos, consulta sports_chat_sources_health e informa installation.state, error, logPath y cómo reparar sin claves; no digas que está instalada si no hay prueba. El protocolo OddsHarvester es oddsharvester upcoming -s <deporte> -d YYYYMMDD -m <mercado> --headless -f json -o archivo; fútbol 1x2, btts, double_chance y totales; NHL home_away usa período full_including_ot; baloncesto 1x2 reglamentario usa full_time. La salida JSON tiene match_date, scraped_date, match_link, bookmaker_name y *_market. Debes exigir partido futuro, cuota decimal válida, hora reciente y mercado completo de una misma casa. SportsbookReview flancast90 usa python cli.py --sport nhl --start 2011 --end 2021 --filename archivo.json; MLB ArnavSaraogi usa python scraper.py AAAA-MM-DD AAAA-MM-DD -t moneyline pointspread totals -o archivo.json; ambos son HISTÓRICOS y solo se usan para backtesting, nunca como cuota de hoy. ',
  'ESPN CORE EXTENDIDO SIN CLAVES: cuando el usuario pida ATS, futuros, rendimiento según cuotas, movimiento de precios, histórico de casas, probabilidad ESPN o predictor usa sports_chat_espn_core_catalog y sports_chat_espn_core con los IDs ESPN verificados. Modos odds, provider, movement, head_to_heads, ats, futures, past_performances, odds_records, probabilities, predictor y providers. No conviertas predicciones, ATS, históricos o futuros en moneylines para apostar hoy; odds sin proveedor y fecha actual no implica cotización vigente. Core lista $ref que se resuelven solo si son del dominio ESPN permitido, con límite de peticiones. Ante HTTP 404/403 o lista vacía, dilo claramente sin declarar que el endpoint universalmente funciona. ',
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
    name:'sports_chat_sources_health',
    description:'Audita los proveedores deportivos. Si faltan, inicia su instalación administrada opcional sin bloquear el chat; retorna estado y logs, sin exponer credenciales ni prometer cuotas.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>false,
    async execute(){
      // Recover missing source installs even when the prepared Windows runtime
      // did not ship the updater script. Launch remains nonblocking.
      const autoRepair=await ensureSportsSourcesStarted(process.env)
      const env=sportsEnv()
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
      },fetch,sportsEnv())
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
      const result=await investigateEventDeep(args.sport,args.league,args.eventId,fetch,Date.now(),sportsEnv())
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
      },fetch,Date.now(),sportsEnv())
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
      },fetch,sportsEnv())
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
      const env=sportsEnv()
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
              tennis:{sport:'tennis',markets:['match_winner','over_under']},
            }
            const route=routes[args.sportKey.split('_')[0]??'']
            if(!route)return []
            const quotes=await Promise.allSettled(route.markets.map(m=>
              keylessOdds(route.sport,m,args.date,env)))
            return quotes.flatMap(x=>x.status==='fulfilled'?x.value.map(q=>({
              ...q,timeIso:q.time,
            })):[])
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
      return JSON.stringify({summary:selected.length?result.summary:(args.liveOnly?'No hay partidos en vivo confirmados para esta liga y fecha.':'Ningún encuentro coincide con esos filtros.'),
        date:result.date,source:result.source,count:selected.length,uiBlocks,
        remaining:Math.max(0,selected.length-(slate?25:6)),
        instruction:'Phoenix renderiza uiBlocks automáticamente en el chat y consulta marcadores ESPN sin consumir tokens. En juegos en vivo no repitas el marcador textual de la instantánea; la UI lo actualiza. Para partidos de un ticket, consulta las ligas/equipos de las patas pertinentes. No imprimas JSON ni repliques las tarjetas en prosa.' })
    },
    presentCall:()=>({ card:'generic',title:'Buscar partidos y sus datos',kind:'read' as const }),
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
    name:'sports_chat_espn_core_catalog',
    description:'Lista las 11 familias de endpoints Core ESPN para cuotas, historial, ATS, futuros, movimientos de mercado, pronósticos y proveedores. No se realiza red ni se gasta cuota.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(){
      return JSON.stringify({source:'ESPN Core API /v2 pública (no oficial)',modes:espnCoreModes,
        guide:'Primero usa sports_chat_games para identificar eventId/competitionId y sports_chat_catalog para league; para ATS e históricos usa teamId y season o providerId genuinos. Consulta un modo por vez mediante sports_chat_espn_core. Providers informa los IDs de las casas en ESPN; su presencia no prueba que haya cuotas publicadas.',
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
      limit:{type:'integer',description:'1..100, por defecto 25. Hasta 12 muestras y 6 referencias resueltas'},
      page:{type:'integer',description:'Página ESPN 1..1000, por defecto 1'},
      resolveRefs:{type:'boolean',description:'Resolver hasta 6 referencias Core del mismo deporte y liga, por defecto true'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      if(!Object.hasOwn(espnCoreModes,args.mode))throw Error('Modo ESPN Core no reconocido: consulta sports_chat_espn_core_catalog')
      if(sportsEnv().PHOENIX_SPORTS_ESPN_DISABLED==='1')return JSON.stringify({
        state:'unavailable',provider:'ESPN Core',error:'ESPN deshabilitado expresamente por configuración del host'})
      const input={
        mode:args.mode as EspnCoreMode,sport:args.sport,league:args.league,
        eventId:args.eventId,competitionId:args.competitionId,
        teamId:args.teamId,providerId:args.providerId,season:args.season,
        seasonType:args.seasonType,limit:args.limit,page:args.page,
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
    name:'sports_chat_odds',
    description:'Busca cuotas públicas ESPN sin clave, el proveedor de nivel gratuito TheOddsAPI con THEODDSAPI_API_KEY o The Odds API v4 con THE_ODDS_API_KEY; mercados y cuota dependen de cada proveedor.',
    parameters:{
      sportKey:{ type:'string',required:true,description:'Clave del proveedor: baseball_mlb, basketball_nba, soccer_epl, etc.' },
      markets:{ type:'string',description:'h2h, totals o spreads. Por defecto h2h.' },
      eventId:{type:'string',description:'ID ESPN real de un encuentro futuro; restringe la búsqueda de odds a ese juego.'},
      date:{type:'string',description:'Fecha local AAAA-MM-DD del juego, obtenida del scoreboard ESPN.'},
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=sportsEnv()
      const observedAt=Date.now()
      // ESPN event IDs are not equivalent to commercial sportsbook event IDs.
      // A targeted game therefore probes only ESPN and never matches third-party
      // prices by unrelated IDs or silently returns a different encounter.
      const report:Awaited<ReturnType<typeof marketOddsDetailed>>=args.eventId?
        await (async()=>{
          if(env.PHOENIX_SPORTS_ESPN_DISABLED==='1')return{
            quotes:[],sources:[{provider:'ESPN Site/Core',status:'unconfigured' as const,
              count:0,detail:'Deshabilitado por el operador'}],
          }
          const result=await fetchPublicEspnOddsDetailed(args.sportKey,args.markets??'h2h',
            <T>(url:string)=>getFeed<T>(url),
            {now:observedAt,cache:true,eventId:args.eventId,
              ...(args.date?{date:args.date}:{}),days:1})
          return{
            quotes:result.quotes.map(q=>({...q,sportKey:args.sportKey,
              source:'ESPN '+q.endpointSource+' (sin clave)'})),
            sources:[{provider:'ESPN Site/Core',status:result.quotes.length?
              'observed' as const:'empty' as const,count:result.quotes.length,
              detail:result.diagnostics.datesQueried.join(', ')+
                ' · evento encontrado: '+String(result.diagnostics.eventMatched)+
                ' · scoreboard '+result.diagnostics.embedded+
                ' · Core '+result.diagnostics.core+
                ' · summary '+result.diagnostics.summary+
                ' · refs '+result.diagnostics.resolvedRefs+
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
        observedAt:new Date(observedAt).toISOString(),requestedEventId:args.eventId??null,
        requestedDate:args.date??null,excludedStaleOrStarted,outcomes:quotes.slice(0,120),
        total:quotes.length,remaining:Math.max(0,quotes.length-120),
        note:quotes.length?'Ofertas auténticas observadas; elegir la casa y el horario antes de cotizar. No son cuotas automáticamente atribuibles a Juancito.':'Sin precios para esa liga/mercado ahora. Revisar sources para conocer fallos, fuentes ausentes y mercados vacíos; ampliar búsqueda antes de declarar imposible. Nunca inventar.' })
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
      const env=sportsEnv()
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
    name:'sports_chat_odds_keyless',
    description:'Cuotas multideporte sin API key desde OddsHarvester local autorizado: 11 deportes, mercados de prepartido, precios por casa con fuente y antigüedad. No promete acceso ilimitado.',
    parameters:{
      sport:{type:'string',required:true,description:'football, basketball, baseball, american-football, tennis, ice-hockey, rugby-league, rugby-union, handball, volleyball o cricket.'},
      market:{type:'string',required:true,description:'Mercado del deporte: 1x2, double_chance, btts, moneyline, home_away, match_winner u over_under.'},
      date:{type:'string',description:'Día AAAA-MM-DD en Santo Domingo; predeterminado hoy.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const env=sportsEnv()
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
      catch(error){scrapeError=error instanceof Error?error.message.slice(0,240):'Error del scraper'}
      // The targeted scraping tool must not strand Kira after a blocked page.
      // Query other independently authorized sources, without re-running OddsHarvester.
      const knownSportKeys:Record<string,string[]>={
        basketball:['basketball_nba'],baseball:['baseball_mlb'],
        'american-football':['americanfootball_nfl'],'ice-hockey':['icehockey_nhl'],
        football:['soccer_epl','soccer_spain_la_liga','soccer_usa_mls','soccer_mexico_ligamx'],
      }
      const otherSources:Awaited<ReturnType<typeof marketOddsDetailed>>[]=[]
      if(scrapeError||!quotes.length){
        const alternativeEnv={...env,PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'}
        const candidate=knownSportKeys[args.sport]??[]
        for(const key of candidate.slice(0,4)){
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
    description:'Investiga 5 o 6 eventos con historial más amplio y contextualización prepartido, consulta OddsHarvester habilitado para precios reales; combina SOLO cuotas vigentes de una misma casa. No inventa cuotas, lesiones ni probabilidades.',
    parameters:{
      count:{type:'integer',required:true,description:'Patas deseadas: 5 o 6 (admite 1 a 6).'},
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
        Date.now(),sportsEnv(),fetch,undefined,preference)
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
      const result=await evidenceTicket(args.count,args.date,args.sport,fetch,Date.now(),sportsEnv())
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
    description:'Prepara un ticket con cuotas comerciales verificadas y calculadora de retorno real, pendiente de aceptación de la banca; NO coloca apuestas sin integración y confirmación.',
    parameters:{
      sportKey:{ type:'string',description:'Clave deportiva de The Odds API. Para varios deportes utiliza sportKeys.' },
      sportKeys:{ type:'array',description:'Claves para ticket multisport, máximo cuatro.',items:{ type:'string' } },
      markets:{ type:'string',description:'h2h, totals o spreads, mismo mercado de las selecciones.' },
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
      if (keys.length < 1 || keys.length > 4) throw new Error('Indica entre 1 y 4 disciplinas para el ticket.')
      const consultedAt=Date.now()
      const quotes = (await Promise.all(keys.map(key => marketOdds(key,args.markets)))).flat()
      const current=quotes.filter(q=>{
        const at=Date.parse(q.updatedAt),kickoff=Date.parse(q.timeIso??q.time)
        return Number.isFinite(at)&&at<=consultedAt&&consultedAt-at<=3_600_000&&
          Number.isFinite(kickoff)&&kickoff>consultedAt&&q.price>1&&
          Boolean(q.bookmaker.trim())&&Boolean(q.source?.trim())
      })
      if(!current.length)throw Error('No hay mercados y cuotas actuales confirmables: se requiere fuente, hora de actualización, partido futuro y casa identificada.')
      const { card,warning }=pricedTicket(args.selections as MarketSelection[],current,args.stake)
      return JSON.stringify({ uiBlock:card,warning,quoteVerified:true,placed:false,placementStatus:'not-confirmed',
        observedQuotes:current.length,excludedMissingOrStale:quotes.length-current.length,
        observedAt:new Date(consultedAt).toISOString(),
        instruction:'Phoenix muestra uiBlock automáticamente en el chat. No reproduzcas su JSON ni un bloque de código. Nunca prometas que ganará. La tarjeta contiene cuotas observadas no aceptadas; confirma siempre la banca y el ticket antes de declararlo pagado.' })
    },
    presentCall:()=>({ card:'generic',title:'Crear ticket visual de análisis',kind:'read' as const }),
  }))
}
