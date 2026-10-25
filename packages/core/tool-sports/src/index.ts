/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, discoverEspnLeagues, chatGames, marketOdds, pricedTicket, type MarketSelection } from './sports.ts'
import { getMlbPitcherReport } from './mlb.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
const GUIDANCE = [
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_discover, sports_chat_games, sports_chat_mlb_pitchers, sports_chat_odds o sports_chat_ticket.',
  'NO abras pantallas independientes ni crees entradas de menú. Antes de redactar una cartelera o boleto, llama sports_chat_games y, cuando corresponda, sports_chat_mlb_pitchers / sports_chat_odds / sports_chat_ticket. Phoenix dibuja de manera nativa las tarjetas verificadas de los resultados. NO copies el JSON de los resultados en la respuesta, NO escribas fences generative-ui ni bloques de código, aunque una herramienta los incluya en sus datos. No dibujes tickets con caracteres ASCII, bordes de texto ni bloques de código etiquetados text: para eventos y selecciones reales usa exclusivamente los contratos nativos, conservando la presentación original de Phoenix. Si el usuario quiere solo una demostración, descríbela explícitamente como ficticia y no introduzcas cuotas o equipos inventados como hechos. Explica los hallazgos y las fuentes con un texto humano breve.',
  'Para muchos partidos muestra como máximo seis tarjetas relevantes y ofrece ampliar; nunca inventes eventos, cuotas, lanzadores, lesiones ni resultados ausentes.',
  'Usa ESPN Site/Core como proveedor gratuito para marcadores y, cuando ESPN los publique, moneylines sin claves; usa The Odds API solo como opción ampliada si existe THE_ODDS_API_KEY. Si ESPN no presenta cuotas verificables, devuelve lista vacía y explica cobertura, sin generar precios ficticios; el chat mostrará automáticamente NO BET. Los tickets solo pueden usar precios del proveedor consultados en ese momento. Son simulaciones; no hay garantía de acierto. Identifica correlaciones y ausencia de predicción calibrada.',
  'Los datos deben indicar su fuente, fecha y zona horaria, y adaptar el detalle a cada deporte. Cuando el usuario pida favoritos, muestra primero los encuentros reales con escudos, horarios, país y liga (si son conocidos), y solo después una tendencia propia sustentada en investigación verificable; una cuota baja no prueba cuál equipo es favorito de tu modelo. En tickets separa visualmente por deporte, país y liga y, si hay un mercado de jugador respaldado por el proveedor, muestra también el jugador; no inventes nombres, mercados ni fotos. Los tickets heredan el tema claro/oscuro de Phoenix. Nunca presentes porcentajes de ESPN como estimaciones propias ni afirmes un porcentaje sin calibración.',
].join(' ')

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name:'tool:sports', order:118, text:GUIDANCE })
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
