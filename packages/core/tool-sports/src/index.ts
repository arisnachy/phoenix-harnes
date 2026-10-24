/** Kira's sports-only model-facing tools. Cards belong in the existing chat. */
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { sportsCatalog, chatGames, marketOdds, pricedTicket, type MarketSelection } from './sports.ts'

export const name = 'tool-sports'
export const inject = ['tools','systemPrompt']
const GUIDANCE = [
  'Solo cuando el usuario pida deportes, juegos del día, jugadores, cuotas o tickets, consulta las herramientas sports_chat_catalog, sports_chat_games, sports_chat_odds o sports_chat_ticket.',
  'NO abras pantallas independientes ni crees entradas de menú. Reproduce en TU RESPUESTA del chat los objetos uiBlocks/uiBlock recibidos como JSON intacto dentro de un bloque de código etiquetado generative-ui. Phoenix los renderiza como tarjetas nativas.',
  'Para muchos partidos muestra como máximo seis tarjetas relevantes y ofrece ampliar; nunca inventes eventos, cuotas, lanzadores, lesiones ni resultados ausentes.',
  'Los tickets solo pueden usar precios del proveedor consultados en ese momento. Son simulaciones; no hay garantía de acierto. Identifica correlaciones y ausencia de predicción calibrada.',
  'Los datos deben indicar su fuente, fecha y zona horaria, y adaptar el detalle a cada deporte.',
].join(' ')

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name:'tool:sports', order:118, text:GUIDANCE })
  ctx.tools.register(defineTool({
    name:'sports_chat_catalog',
    description:'Lista disciplinas y ligas documentadas. No crea menú ni abre otra pantalla.',
    parameters:{},
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    execute:()=>Promise.resolve(JSON.stringify({sports:sportsCatalog,notice:'La disponibilidad de ligas y recursos varía por proveedor.'})),
    presentCall:()=>({card:'generic',title:'Consultar deportes',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_games',
    description:'Eventos reales en el chat: liga, horario, estadio, equipos y estadísticas verificables. Devuelve tarjetas renderizables.',
    parameters:{
      sport:{type:'string',required:true,description:'Deporte: soccer, baseball, basketball, etc.'},
      league:{type:'string',required:true,description:'Liga: mlb, nba, mex.1, eng.1, etc.'},
      date:{type:'string',description:'Fecha AAAA-MM-DD, opcional: hoy en Santo Domingo.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const result=await chatGames(args.sport,args.league,args.date)
      return JSON.stringify({summary:result.summary,date:result.date,source:result.source,count:result.count,
        uiBlocks:result.items.slice(0,6),remaining:Math.max(0,result.items.length-6),
        instruction:'En tu respuesta del chat reproduce los bloques uiBlocks como JSON exacto en fences generative-ui; no proporciones enlace a un menú.'})
    },
    presentCall:()=>({card:'generic',title:'Buscar partidos y sus datos',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_odds',
    description:'Busca cuotas vigentes con casa, mercado, selección, precio y fecha de observación, sin realizar apuestas.',
    parameters:{
      sportKey:{type:'string',required:true,description:'Clave del proveedor: baseball_mlb, basketball_nba, soccer_epl, etc.'},
      markets:{type:'string',description:'h2h, totals o spreads. Por defecto h2h.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const quotes=await marketOdds(args.sportKey,args.markets)
      return JSON.stringify({source:'The Odds API',observedAt:new Date().toISOString(),outcomes:quotes.slice(0,120),
        total:quotes.length,remaining:Math.max(0,quotes.length-120),
        note:'Cuotas observadas, no probabilidades propias. Actualizar antes de componer tickets.'})
    },
    presentCall:()=>({card:'generic',title:'Comparar cuotas',kind:'read' as const}),
  }))
  ctx.tools.register(defineTool({
    name:'sports_chat_ticket',
    description:'Genera un ticket visual SIMULADO con selecciones verificadas nuevamente en cuotas reales. No ejecuta apuestas.',
    parameters:{
      sportKey:{type:'string',required:true,description:'Clave deportiva de The Odds API.'},
      markets:{type:'string',description:'h2h, totals o spreads, mismo mercado de las selecciones.'},
      selections:{type:'array',required:true,description:'Entre una y diez selecciones verificables.',
        items:{type:'object',additionalProperties:false,properties:{
          eventId:{type:'string',required:true},bookmaker:{type:'string',required:true},
          market:{type:'string',required:true},selection:{type:'string',required:true},
          point:{type:'number'},
        }}},
      stake:{type:'number',description:'Importe ficticio para simular el retorno; no es una operación financiera.'},
    },
    output:{schema:{type:'string'},render:(_a,v)=>[{type:'text' as const,text:v}]},
    isConcurrencySafe:()=>true,
    async execute(args){
      const quotes=await marketOdds(args.sportKey,args.markets)
      const {card,warning}=pricedTicket(args.selections as MarketSelection[],quotes,args.stake)
      return JSON.stringify({uiBlock:card,warning,simulationOnly:true,placed:false,
        instruction:'Incluye uiBlock como JSON intacto entre fences generative-ui en tu respuesta. Nunca prometas que ganará.'})
    },
    presentCall:()=>({card:'generic',title:'Crear ticket visual de análisis',kind:'read' as const}),
  }))
}
