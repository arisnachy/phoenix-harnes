/** Compact, evidence-bound game insights shared by the ESPN event view.
 * Outputs source-neutral UI labels, while source/provenance remains auditable.
 */
import { normalizeEspnMarkets } from './espn-odds.ts'

type Row=Record<string,unknown>
const obj=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const value=(x:unknown,max=90)=>typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').slice(0,max):''
type Item={label:string;value?:string;detail?:string}
export type SportsInsightSection={heading:string;kind:'metrics'|'list';items:Item[]}
export type SportsEventEvidence={
  sections:SportsInsightSection[];quotes:number;providerQuotes:number
  projected:boolean;limitations:string[]
}
const percent=(v:unknown):string=>{
  const n=typeof v==='string'?Number(v.replace('%','').trim()):v
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)return ''
  return (n<=1?n*100:n).toFixed(1)+'%'
}
const metric=(label:string,x:unknown,detail?:string):Item|null=>{
  const v=value(x,90);return v?{label,value:v,...(detail?{detail}:{})}:null
}
const teams=(summary:unknown)=>{
  const h=obj(obj(summary).header),comp=obj(arr(h.competitions)[0])
  return {header:h,competition:comp,contestants:arr(comp.competitors)}
}
/** Decode only explicit team percentages published by the external predictor.
 * @param predictor - Read-only predictor endpoint payload.
 * @returns Displayable reference scores, never a fabricated model output.
 */
export function observedEventProjection(predictor:unknown):SportsInsightSection|null{
  const root=obj(predictor),home=obj(root.homeTeam),away=obj(root.awayTeam)
  const hp=percent(home.gameProjection??home.winProbability??root.homeWinPercentage)
  const ap=percent(away.gameProjection??away.winProbability??root.awayWinPercentage)
  const result=[hp?metric('Local',hp):null,ap?metric('Visitante',ap):null]
    .filter((x):x is Item=>x!==null)
  return result.length?{heading:'Proyección de referencia',kind:'metrics',
    items:result.map(x=>({...x,detail:'Indicador externo; no es una cuota ni una predicción calibrada por PHOENIX'}))}:null
}
/** Assemble bounded, independently observed game statistics and odds.
 * @param input - Event identity, provider payloads and observation time.
 * @returns Concise first-screen sections with transparent missing evidence.
 */
export function sportsEventInsights(input:{
  eventId:string;summary:unknown;coreOdds:readonly unknown[];predictor:unknown;now:number
}):SportsEventEvidence{
  const {header,competition,contestants}=teams(input.summary)
  const date=value(competition.date??header.date,45)
  const dateMillis=Date.parse(date)
  const validFuture=Number.isFinite(dateMillis)&&dateMillis>input.now
  const event={
    id:input.eventId,date,
    competitions:[{competitors:contestants.map(c=>{
      const competitor=obj(c),team=obj(competitor.team)
      return {homeAway:value(competitor.homeAway,15),
        team:{displayName:value(team.displayName??team.name,100)}}
    })}],
  }
  const pickcenter=arr(obj(input.summary).pickcenter)
  const listed=arr(competition.odds)
  const core=input.coreOdds.filter(x=>Object.keys(obj(x)).length>0)
  // A pointer ($ref) is NOT a price; the existing Core reader resolves
  // a bounded set before passing them here.
  const entries=[...core,...listed,...pickcenter].filter(x=>!obj(x).$ref)
  const prices=normalizeEspnMarkets(event,
    entries as Parameters<typeof normalizeEspnMarkets>[1],
    {now:input.now,historical:true})
  const matching=prices.filter(p=>p.eventId===input.eventId)
  const sections:SportsInsightSection[]=[]
  const push=(heading:string,kind:SportsInsightSection['kind'],items:Array<Item|null>)=>{
    const found=items.filter((x):x is Item=>x!==null).slice(0,8)
    if(found.length)sections.push({heading,kind,items:found})
  }
  const directRecords=contestants.flatMap(c=>{
    const comp=obj(c),team=obj(comp.team)
    const name=value(team.abbreviation??team.displayName??team.name,45)
    return arr(comp.records).slice(0,2).map(record=>{
      const r=obj(record);return metric(name+' · '+value(r.name??r.type??'Récord',40),r.summary)
    }).filter((x):x is Item=>x!==null)
  })
  push('Rendimiento de los equipos','metrics',directRecords)
  const boxTeams=arr(obj(obj(input.summary).boxscore).teams)
  const boxStats:Item[]=[]
  for(const t of boxTeams.slice(0,2)){
    const side=obj(t),team=obj(side.team)
    const name=value(team.abbreviation??team.displayName,30)
    for(const s of arr(side.statistics).slice(0,6)){
      const stat=obj(s),key=value(stat.abbreviation??stat.label??stat.name,45)
      const val=value(stat.displayValue??stat.value,45)
      if(name&&key&&val)boxStats.push({label:name+' · '+key,value:val})
    }
  }
  push('Estadísticas verificadas','metrics',boxStats)
  const selected=matching.filter(p=>['h2h','spreads','totals'].includes(p.market)).slice(0,8)
  const priced=selected.map(p=>{
    const updated=Date.parse(p.updatedAt)
    const observed=Number.isFinite(updated)&&updated<=input.now
      &&input.now-updated<=3_600_000
    const line=p.point===null?'':' · '+p.point
    return {label:value(p.selection,65)+' · '+p.market,
      value:p.price.toFixed(2)+line,
      detail:observed&&validFuture?'Precio observado hace menos de una hora · vigencia final no confirmada':
        'Precio de referencia: actualización o vigencia sin confirmar'}
  })
  push('Cuotas y mercados','metrics',priced)
  const projection=observedEventProjection(input.predictor)
  if(projection)sections.push(projection)
  return {sections:sections.slice(0,5),quotes:matching.length,providerQuotes:core.length,
    projected:projection!==null,
    limitations:[
      ...(!matching.length?['Cuotas no publicadas o sin datos suficientes para mostrar']:[]),
      ...(!projection?['Proyección de referencia no publicada por la fuente']:[]),
      ...(!boxStats.length?['Estadísticas de boxscore no disponibles antes del partido']:[]),
      'Las cuotas sin marca de actualización comprobable no se presentan como ofertas vigentes',
    ]}
}
