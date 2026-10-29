/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, discoverEspnLeagues, chatGames, compactSportsSchedule, marketOdds, pricedTicket, type MarketSelection } from './sports.ts'
import { getMlbPitcherReport } from './mlb.ts'
import { researchTicket, autoResearchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { sportsPromptNeeded } from './sports-prompt.ts'
import { researchNbaSlate } from './nba-research.ts'

import { keylessOdds, keylessSports } from './keyless-odds.ts'
import { loadHistoricalOdds } from './sports-archive.ts'
import { researchSport } from './multi-sport-research.ts'
import { communityOpinions } from './sports-community.ts'
import { evidenceTicket } from './evidence-ticket.ts'
import { evidencePricedTicket } from './evidence-priced-ticket.ts'
import { hydrateSportsSources,sportsSourcesHealth } from './sports-source-health.ts'
import { investigateEventDeep } from './sports-deep-context.ts'
import { compareBettingMarkets,supportedMarketFamilies } from './sports-market-intelligence.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
const sportsEnv=():NodeJS.ProcessEnv=>hydrateSportsSources(process.env)
const GUIDANCE = [
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, sports_chat_ticket, sports_chat_ticket_research, sports_chat_ticket_research_auto, sports_chat_nba_research, sports_chat_research, sports_chat_historical_odds, sports_chat_community_opinions, sports_chat_odds_keyless, sports_chat_sources_health, sports_chat_deep_research, sports_chat_market_intelligence, sports_chat_ticket_evidence_auto o sports_chat_ticket_evidence_priced_auto.',
  'NO abras pantallas independientes ni crees entradas de menú. Antes de redactar una cartelera o boleto, llama sports_chat_games y, cuando corresponda, sports_chat_mlb_pitchers / sports_chat_odds / sports_chat_ticket. Phoenix dibuja de manera nativa las tarjetas verificadas de los resultados. NO copies el JSON de los resultados en la respuesta, NO escribas fences generative-ui ni bloques de código, aunque una herramienta los incluya en sus datos. No dibujes tickets con caracteres ASCII, bordes de texto ni bloques de código etiquetados text: para eventos y selecciones reales usa exclusivamente los contratos nativos, conservando la presentación original de Phoenix. Si el usuario quiere solo una demostración, descríbela explícitamente como ficticia y no introduzcas cuotas o equipos inventados como hechos. Explica los hallazgos y las fuentes con un texto humano breve.',
  'INVESTIGACIÓN NBA: antes de defender cualquier favorito o selección NBA, consulta sports_chat_nba_research (y sports_chat_odds cuando existan cuotas). Contrasta forma en marcadores finales, márgenes, descanso y muestra; revisa además informe oficial de lesiones, rotaciones, estadísticas avanzadas, rival, localía y movimiento de precios desde fuentes autorizadas. Lo no consultado debe permanecer explícitamente SIN VERIFICAR. No transformes la forma descriptiva en porcentajes de victoria ni cites atletas que no tengan plantilla actual confirmada. Un ticket automático se considera SOLO una preselección, nunca una investigación completa.',
  'INVESTIGAR TODOS LOS DEPORTES: llama sports_chat_research para estudiar los marcadores finales recientes del deporte y liga que el usuario pidió. Para MLB complementa con pitchers y bullpen; fútbol exige revisar goles, localía, bajas, forma y opciones 1X2/doble oportunidad; tenis requiere superficie, historial y fatiga; hockey necesita portero y estadísticas defensivas; en otros deportes usa métricas propias. Si el informe indica insuficiente, no proclames favorito respaldado. sports_chat_historical_odds agrega históricos de ambos repositorios SportsbookReview para entrenamiento/backtest, jamás cuotas actuales; y sports_chat_community_opinions observa pronósticos públicos solo como opinión separada.',
  'Antes de declarar sin cuotas, llama sports_chat_sources_health para distinguir proveedor deshabilitado, CLI no instalado, histórico no cargado y precio no disponible. No confundas fuente configurada con consulta efectiva ni marcador con titular confirmado. Los 3 proyectos GitHub acordados NO son 3 feeds vivos: solo OddsHarvester puede consultar cuotas actuales cuando está activo y accesible; SportsbookReview y MLB son históricos. ',
  'Para cuotas gratuitas por scraping (sin API key) consulta sports_chat_odds_keyless si el host habilitó OddsHarvester. No prometas consultas ilimitadas ni uses cuotas históricas como cotizaciones vigentes. El motor debe investigar todas las disciplinas disponibles, no solo NBA, y contrastar historial, lesionados, alineaciones, rendimiento, localía, cuota y fuentes externas cuando existan. Las votaciones y picks de otras personas son una referencia secundaria, no estimaciones propias ni garantía.',
  'PROCEDIMIENTO DE INVESTIGACIÓN: nunca digas que un ticket está profundamente investigado solo por salir en 2 segundos o por cinco marcadores. Para 5/6 patas emplea sports_chat_ticket_evidence_priced_auto cuando haya proveedor de cuotas habilitado; si no, sports_chat_ticket_evidence_auto. Exige historial con al menos cinco partidos terminados DIFERENTES por equipo (NFL tres), coherencia entre forma y margen, y comprobación separada de resumen ESPN y disponibilidad de parte médico. Las ausencias, el portero NHL, rotaciones NBA, pitchers MLB, once y xG en fútbol, superficie en tenis y mercados actuales que no se hayan confirmado deben quedar marcados PENDIENTES, sin atribuir jugadores, estatus ni probabilidad inventados. Si hay menos de cinco/seis selecciones justificables, muestra borrador INCOMPLETO. La opción antigua sports_chat_ticket_research_auto solo vale para exploración, nunca como análisis profundo.',
  'EN VIVO SIN TOKENS: cuando el usuario pida juegos en vivo, marcadores actuales o seguimiento de los partidos de su ticket, llama sports_chat_games con liveOnly=true por cada liga incluida (o team/eventId para un partido). Conserva los nombres y liga del ticket sin inventar equivalencias. La cartelera y las tarjetas consultan ESPN directamente desde el navegador de manera compartida y periódica mientras están visibles, sin llamadas adicionales al modelo. Las situaciones de MLB incluyen bases/outs/conteo cuando ESPN los publica; NBA ofrece período, reloj, parciales y última jugada; NFL, NHL, fútbol y otras disciplinas muestran sus datos disponibles. No afirmes transmisión de video ni tiempo real garantizado: informa si la fuente se retrasa o no publica detalles.',
  'Cuando el usuario pida una cartelera, deja que sports_chat_games entregue una sola cartelera compacta en el chat con hasta 25 encuentros reales. Para un partido, cruce o equipo concreto, pasa team, opponent o eventId a sports_chat_games: así se mantiene la sports_game_card detallada existente. No cambies el menú, la página ni la caja del chat. Nunca inventes eventos, cuotas, lanzadores, lesiones ni resultados ausentes.',
  'MERCADOS MÚLTIPLES: antes de elegir un ganador, consulta sports_chat_market_intelligence para evaluar 1X2, doble oportunidad 1X/X2, over/under, BTTS, spread o handicap según el deporte y mercados REALES presentes. 1/cuota representa expectativa del precio del bookmaker, NO tu probabilidad calibrada; no digas que una apuesta es la más probable basándote solo en su precio. Para investigar jugadores, lesiones, noticias, plantillas y métricas de cada evento usa sports_chat_deep_research con el ID ESPN confirmado. No trates titulares, porteros ni jugadores mencionados en noticias como confirmados si la fuente no lo dice. ',
  'DOBLE OPORTUNIDAD: si el usuario quiere 1X/X2, indica marketPreference=double_chance en sports_chat_ticket_evidence_priced_auto para encuentros de fútbol; elige solo cuotas auténticas del mismo bookmaker. 1X cubre local o empate; X2, visita o empate. No transformes ganador directo en doble oportunidad sin consultar ese mercado. El usuario puede pedir 5 o 6 selecciones y debe ver razones y riesgos, no una promesa de acierto.',
  'CONTRATO DE PATAS: cuando el usuario pide 5 patas, el resultado DEBE contener exactamente cinco selecciones verificadas; jamás presentes 1 de 5 como ticket completo. Si faltan datos, muestra explícitamente el número conseguido y el número pendiente como borrador incompleto. Respeta igualmente cualquier otro número de 1 a 6. No afirmes que una combinada ganará.',
  'Si se pide un ticket y no hay cuotas, no finjas precio ni retorno. Prefiere sports_chat_ticket_evidence_auto para calcular una preselección con marcadores históricos verificables. sports_chat_ticket_research_auto es solo un respaldo antiguo por récord y NO cumple investigación deportiva profunda. Si ya tienes IDs y fundamentos por partido usa sports_chat_ticket_research. Un borrador de menos patas debe mostrarse INCOMPLETO. Si no hay partidos verificables, dilo y busca otras ligas y fechas sin inventar mercados.',
  'Usa ESPN Site/Core como proveedor público para marcadores y moneylines cuando se publiquen. Hay DOS proveedores comerciales distintos, opcionales: TheOddsAPI (api.theoddsapi.com, THEODDSAPI_API_KEY, acceso gratuito con cupo) y The Odds API v4 (api.the-odds-api.com, THE_ODDS_API_KEY); no confundas claves, endpoints ni formatos. Si ambos están configurados, prioriza THE_ODDS_API_KEY como se implementó en marketOdds. Si ESPN no presenta cuotas, no inventes precios: sports_chat_ticket_research ofrece un ticket de pronósticos sin cotización basado en encuentros futuros verificados. sports_chat_ticket es un ticket COTIZADO y solo puede usar precios del proveedor consultados en ese momento. Ambos son simulaciones; no hay garantía de acierto. Identifica correlaciones y ausencia de predicción calibrada.',
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
    description:'Audita de forma segura los proveedores deportivos de Kira: OddsHarvester instalado/habilitado, claves opcionales presentes sin exponer secretos, históricos GitHub montados. No promete precios disponibles.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(){
      const sources=await sportsSourcesHealth(sportsEnv())
      return JSON.stringify({sources,checkedAt:new Date().toISOString(),
        warning:'Configuración o CLI disponible NO equivale a cuotas actuales. Para comprobar precios requiere consulta de mercado con marca de tiempo y casa. Los archivos de SportsbookReview y MLB no son cuotas vivas.'})
    },
    presentCall:()=>({card:'generic',title:'Comprobar proveedores deportivos y datos históricos',kind:'read' as const}),
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
              icehockey:{sport:'ice-hockey',markets:['home_away','over_under']},
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
        ...comparison,sourceReadiness:sources,
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
    name:'sports_chat_odds',
    description:'Busca cuotas públicas ESPN sin clave, el proveedor de nivel gratuito TheOddsAPI con THEODDSAPI_API_KEY o The Odds API v4 con THE_ODDS_API_KEY; mercados y cuota dependen de cada proveedor.',
    parameters:{
      sportKey:{ type:'string',required:true,description:'Clave del proveedor: baseball_mlb, basketball_nba, soccer_epl, etc.' },
      markets:{ type:'string',description:'h2h, totals o spreads. Por defecto h2h.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const quotes=await marketOdds(args.sportKey,args.markets,sportsEnv())
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
      return JSON.stringify({ uiBlocks,source:quotes[0]?.source||'ESPN público (sin cuotas disponibles) / TheOddsAPI o The Odds API v4 opcionales',observedAt:new Date().toISOString(),outcomes:quotes.slice(0,120),
        total:quotes.length,remaining:Math.max(0,quotes.length-120),
        note:quotes.length?'Cuotas verificadas, no probabilidades propias. Actualizar antes de componer tickets.':'No hubo cotizaciones accesibles con los proveedores configurados. ESPN puede mostrar partidos sin moneylines; TheOddsAPI y The Odds API requieren claves diferentes, y pueden aplicar límites. No se inventan precios.' })
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
    description:'Históricos sin clave API de los dos repositorios SportsbookReview para MLB, NBA, NFL y NHL. Exclusivamente para backtesting y análisis pasado, nunca como cuota de hoy.',
    parameters:{sport:{type:'string',required:true,description:'nba, mlb, nfl o nhl.'}},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const report=await loadHistoricalOdds(args.sport,sportsEnv())
      return JSON.stringify({sport:args.sport,sources:report.sources,liveQuotes:false,
        count:report.historical.length,samples:report.historical.slice(-20),
        instruction:'Archivo histórico: NUNCA usar sus precios en tickets actuales. Solo calcular antecedentes y backtesting out-of-sample.'})
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
      const quotes=await keylessOdds(args.sport,args.market,args.date,sportsEnv())
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
    description:'Genera un ticket visual SIMULADO con selecciones verificadas nuevamente en cuotas reales. No ejecuta apuestas.',
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
      stake:{ type:'number',description:'Importe ficticio para simular el retorno; no es una operación financiera.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const requestedKeys = args.sportKeys?.length ? args.sportKeys : args.sportKey ? [args.sportKey] : []
      const keys = [...new Set(requestedKeys)]
      if (keys.length < 1 || keys.length > 4) throw new Error('Indica entre 1 y 4 disciplinas para el ticket.')
      const quotes = (await Promise.all(keys.map(key => marketOdds(key,args.markets)))).flat()
      const { card,warning }=pricedTicket(args.selections as MarketSelection[],quotes,args.stake)
      return JSON.stringify({ uiBlock:card,warning,simulationOnly:true,placed:false,
        instruction:'Phoenix muestra uiBlock automáticamente en el chat. No reproduzcas su JSON ni un bloque de código. Nunca prometas que ganará.' })
    },
    presentCall:()=>({ card:'generic',title:'Crear ticket visual de análisis',kind:'read' as const }),
  }))
}
