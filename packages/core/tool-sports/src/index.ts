/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, discoverEspnLeagues, chatGames, marketOdds, pricedTicket, type MarketSelection } from './sports.ts'
import { getMlbPitcherReport } from './mlb.ts'
import { researchTicket, autoResearchTicket, type ResearchTicketLeg } from './research-ticket.ts'
import { sportsPromptNeeded } from './sports-prompt.ts'
import { keylessOdds, keylessSports } from './keyless-odds.ts'
import { loadHistoricalOdds } from './sports-archive.ts'
import { researchSport } from './multi-sport-research.ts'
import { communityOpinions } from './sports-community.ts'
import { evidenceTicket } from './evidence-ticket.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
const GUIDANCE = [
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds, sports_chat_ticket, sports_chat_ticket_research o sports_chat_ticket_research_auto.',
  'NO abras pantallas independientes ni crees entradas de menú. Antes de redactar una cartelera o boleto, llama sports_chat_games y, cuando corresponda, sports_chat_mlb_pitchers / sports_chat_odds / sports_chat_ticket. Phoenix dibuja de manera nativa las tarjetas verificadas de los resultados. NO copies el JSON de los resultados en la respuesta, NO escribas fences generative-ui ni bloques de código, aunque una herramienta los incluya en sus datos. No dibujes tickets con caracteres ASCII, bordes de texto ni bloques de código etiquetados text: para eventos y selecciones reales usa exclusivamente los contratos nativos, conservando la presentación original de Phoenix. Si el usuario quiere solo una demostración, descríbela explícitamente como ficticia y no introduzcas cuotas o equipos inventados como hechos. Explica los hallazgos y las fuentes con un texto humano breve.',
  'INVESTIGAR TODOS LOS DEPORTES: llama sports_chat_research para estudiar los marcadores finales recientes del deporte y liga que el usuario pidió. Para MLB complementa con pitchers y bullpen; fútbol exige revisar goles, localía, bajas, forma y opciones 1X2/doble oportunidad; tenis requiere superficie, historial y fatiga; hockey necesita portero y estadísticas defensivas; en otros deportes usa métricas propias. Si el informe indica insuficiente, no proclames favorito respaldado. sports_chat_historical_odds agrega históricos de ambos repositorios SportsbookReview para entrenamiento/backtest, jamás cuotas actuales; y sports_chat_community_opinions observa pronósticos públicos solo como opinión separada.',
  'Para cuotas gratuitas por scraping (sin API key) consulta sports_chat_odds_keyless si el host habilitó OddsHarvester. No prometas consultas ilimitadas ni uses cuotas históricas como cotizaciones vigentes. El motor debe investigar todas las disciplinas disponibles, no solo NBA, y contrastar historial, lesionados, alineaciones, rendimiento, localía, cuota y fuentes externas cuando existan. Las votaciones y picks de otras personas son una referencia secundaria, no estimaciones propias ni garantía.',
  'Para muchos partidos muestra como máximo seis tarjetas relevantes y ofrece ampliar; nunca inventes eventos, cuotas, lanzadores, lesiones ni resultados ausentes.',
  'Para tickets automáticos de 5 o 6 patas, usa PRIMERO sports_chat_ticket_evidence_auto y no sports_chat_ticket_research_auto, que emplea solamente récords simplificados. El modo evidence_auto investiga enfrentamientos entre deportes y no debe anunciar probabilidades ni alto porcentaje de acierto sin modelos calibrados. Si no hay datos suficientes, muestra explícitamente un borrador incompleto. Para cuotas usa sports_chat_odds_keyless y solo compón un ticket cotizado tras reconciliar correctamente IDs de proveedores.',
  'CONTRATO DE PATAS: cuando el usuario pide 5 patas, el resultado DEBE contener exactamente cinco selecciones verificadas; jamás presentes 1 de 5 como ticket completo. Si faltan datos, muestra explícitamente el número conseguido y el número pendiente como borrador incompleto. Respeta igualmente cualquier otro número de 1 a 6. No afirmes que una combinada ganará.',
  'Si piden un ticket y sports_chat_odds no devuelve cuotas, NO termines con NO BET. Usa sports_chat_ticket_research_auto con count igual al número solicitado cuando no dispongas de IDs: esta herramienta investiga carteleras y registros de los equipos en varias ligas y propone hasta esa cantidad de eventos reales, sin cuotas. Si la investigación especializada ya confirmó tus eventId y fundamentos, llama sports_chat_ticket_research con requestedLegs igual al número solicitado y todas las patas. El resultado con menos patas debe identificarse como borrador incompleto. No afirmes que los registros tempranos sean probabilidades calibradas. Si no hay partidos futuros verificados, explica la limitación.',
  'Usa ESPN Site/Core como proveedor gratuito para marcadores y, cuando ESPN los publique, moneylines sin claves; usa The Odds API solo como opción ampliada si existe THE_ODDS_API_KEY. Si ESPN no presenta cuotas, no inventes precios: sports_chat_ticket_research ofrece un ticket de pronósticos sin cotización basado en encuentros futuros verificados. sports_chat_ticket es un ticket COTIZADO y solo puede usar precios del proveedor consultados en ese momento. Ambos son simulaciones; no hay garantía de acierto. Identifica correlaciones y ausencia de predicción calibrada.',
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
    description:'Eventos reales en el chat: liga, horario, estadio, equipos y estadísticas verificables. Devuelve tarjetas renderizables.',
    parameters:{
      sport:{ type:'string',required:true,description:'Deporte: soccer, baseball, basketball, etc.' },
      league:{ type:'string',required:true,description:'Liga: mlb, nba, mex.1, eng.1, etc.' },
      date:{ type:'string',description:'Fecha AAAA-MM-DD, opcional: hoy en Santo Domingo.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await chatGames(args.sport,args.league,args.date)
      return JSON.stringify({ summary:result.summary,date:result.date,source:result.source,count:result.count,
        uiBlocks:result.items.slice(0,6),remaining:Math.max(0,result.items.length-6),
        instruction:'Phoenix renderiza uiBlocks automáticamente en el chat. No vuelvas a imprimirlos como JSON o código; comenta datos y fuentes en prosa.' })
    },
    presentCall:()=>({ card:'generic',title:'Buscar partidos y sus datos',kind:'read' as const }),
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
    description:'Busca cuotas públicas ESPN sin clave o The Odds API si está configurada; puede devolver vacío cuando ESPN no publica precios.',
    parameters:{
      sportKey:{ type:'string',required:true,description:'Clave del proveedor: baseball_mlb, basketball_nba, soccer_epl, etc.' },
      markets:{ type:'string',description:'h2h, totals o spreads. Por defecto h2h.' },
    },
    output:{ schema:{ type:'string' },render:(_a,v)=>[{ type:'text' as const,text:v }] },
    isConcurrencySafe:()=>true,
    async execute(args){
      const quotes=await marketOdds(args.sportKey,args.markets)
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
      return JSON.stringify({ uiBlocks,source:quotes[0]?.source||'ESPN público (sin cuotas disponibles) / The Odds API opcional',observedAt:new Date().toISOString(),outcomes:quotes.slice(0,120),
        total:quotes.length,remaining:Math.max(0,quotes.length-120),
        note:quotes.length?'Cuotas verificadas, no probabilidades propias. Actualizar antes de componer tickets.':'ESPN no publicó moneylines accesibles para ese día y mercado; no hace falta una clave para ver partidos. Las cuotas faltantes no se inventan.' })
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
      const report=await loadHistoricalOdds(args.sport)
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
      const quotes=await keylessOdds(args.sport,args.market,args.date)
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
      const result=await evidenceTicket(args.count,args.date,args.sport)
      return JSON.stringify({uiBlock:result.card,requestedLegs:args.count,verifiedEvents:result.verifiedEvents,
        complete:result.complete,candidatesEvaluated:result.candidatesEvaluated,
        researchLeagues:result.researchLeagues,priced:false,placed:false,modelProbabilities:false,
        instruction:result.complete?
          'Ticket con exactamente las patas pedidas y resultados históricos verificados, pero aún no cotizado ni calibrado; requiere lesiones, modelos específicos, noticias y precio del operador antes de defenderlo como apuestas de mayor probabilidad.':
          'Borrador incompleto. No sustituyas patas ni inventes cuotas. Indica cuántas selecciones se pudieron fundamentar.'})
    },
    presentCall:()=>({card:'generic',title:'Investigar ticket multideporte por evidencia',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket_research_auto',
    description:'Descubre partidos futuros en varias ligas públicas ESPN y propone hasta el número EXACTO de patas solicitado. No pide IDs al modelo, no inventa cuotas y etiqueta el borrador como INCOMPLETO si no consigue todas.',
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
        instruction:result.complete?'Ticket completo de eventos verificados. Describe el razonamiento como tendencia, no certeza.':
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
