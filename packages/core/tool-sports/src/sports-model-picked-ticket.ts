/** Kira makes the picks after research; ESPN only verifies their prices.
 * Never let an odds ranking choose the winner or invent a fifth priced leg.
 */
import { getFeed,type ChatBlock,type MarketOutcome } from './sports.ts'
import { lookupExactEspnWinner,sameEspnTeam } from './sports-exact-espn-winner.ts'
import { ticketLeagueOddsKey } from './evidence-priced-ticket.ts'
/** One pregame selection researched by the active model. */
export type ModelChosenLeg={
  sport:string
  league:string
  eventId:string
  date:string
  home:string
  away:string
  kickoff:string
  pick:'home'|'away'
  reason:string
  /** Article URLs Kira actually opened, ideally independent publishers. */
  sourceUrls?:string[]
  /** Strongest evidence that the selected side could lose. */
  counterEvidence?:string
  /** Explicit unresolved critical blockers; [] means reviewed, not proved. */
  criticalPending?:string[]
  /**
   * Receipt that the model actually read the bilateral dossier before making
   * this decision. Counts and stages are descriptive evidence, never scores
   * or weights; deep player logs remain recoverable by eventId.
   */
  researchEvidence?:ExpertResearchEvidence
}

export type ExpertResearchEvidence={
  eventId:string
  homeRosterCount:number
  awayRosterCount:number
  reviewedStages:string[]
  observedFacts:string[]
}
/** Runtime-owned stage observations from research tools; never model-authored. */
export type TrustedResearchStageReader=(leg:ModelChosenLeg)=>readonly string[]|undefined
const valid=(leg:ModelChosenLeg,now:number)=>/^\d{1,18}$/u.test(leg.eventId)&&
  /^\d{4}-\d{2}-\d{2}$/u.test(leg.date)&&
  Number.isFinite(Date.parse(leg.kickoff))&&Date.parse(leg.kickoff)>now&&
  ['home','away'].includes(leg.pick)&&leg.home.trim().length>2&&
  leg.away.trim().length>2&&leg.reason.trim().length>=15
const isObserved=(q:MarketOutcome,now:number)=>{
  const observed=Date.parse(q.observedAt??'')
  return typeof q.bookmaker==='string'&&q.bookmaker.trim().length>0&&
    Number.isFinite(observed)&&observed<=now&&now-observed<=15*60_000&&
    typeof q.price==='number'&&Number.isFinite(q.price)&&q.price>1&&
    q.source?.startsWith('ESPN')===true
}
type ExactQuote=MarketOutcome
const sourceHost=(raw:unknown):string|null=>{
  if(typeof raw!=='string')return null
  try{
    const url=new URL(raw)
    if(url.protocol!=='https:'||url.username||url.password||
      !url.hostname.includes('.')||url.hostname.endsWith('espncdn.com'))return null
    return url.hostname.replace(/^www\./u,'')
  }catch{return null}
}
/**
 * Check whether Kira documented each decision.
 * @param chosen - The model's event picks and cited evidence.
 * @returns Missing documentation or unresolved decisive evidence for each pick.
 */
export function ticketResearchChecklist(chosen:readonly ModelChosenLeg[]):string[]{
  const missing:string[]=[]
  if(chosen.length<5||chosen.length>6)
    missing.push('El ticket diario final necesita cinco o seis eventos diferentes.')
  for(const leg of chosen){
    const name=leg.away+' vs '+leg.home
    const uniqueHosts=new Set((leg.sourceUrls??[]).map(sourceHost).filter(Boolean))
    if(uniqueHosts.size<2)missing.push(name+': citar dos publicaciones leídas de editores independientes.')
    if(!leg.counterEvidence||leg.counterEvidence.trim().length<20)
      missing.push(name+': falta refutación deportiva del pick.')
    if(!Array.isArray(leg.criticalPending))
      missing.push(name+': falta revisión explícita de titulares, bajas y otros riesgos críticos.')
    else if(leg.criticalPending.length)
      missing.push(name+': riesgos decisivos abiertos: '+leg.criticalPending.slice(0,3).join('; '))
  }
  return missing
}

const REQUIRED_EXPERT_STAGES=['teams','rosters','availability','context','news'] as const

/**
 * Enforce that the model's final pick came after a bilateral dossier read.
 * This is intentionally qualitative: the receipt records coverage only and
 * never contributes a numerical winner score or probability.
 */
export function ticketExpertEvidenceChecklist(
  chosen:readonly ModelChosenLeg[],
  observedStages?:TrustedResearchStageReader,
  requireTrusted=false,
):string[]{
  const missing:string[]=[]
  for(const leg of chosen){
    const name=leg.away+' vs '+leg.home
    const evidence=leg.researchEvidence
    if(!evidence||typeof evidence!=='object'){
      missing.push(name+': falta comprobante de expediente bilateral leído.')
      continue
    }
    if(evidence.eventId!==leg.eventId)
      missing.push(name+': el comprobante bilateral no corresponde al eventId elegido.')
    if(!Number.isInteger(evidence.homeRosterCount)||evidence.homeRosterCount<1||
      !Number.isInteger(evidence.awayRosterCount)||evidence.awayRosterCount<1)
      missing.push(name+': el comprobante no contiene roster observado de ambos rivales.')
    const stages=new Set(evidence.reviewedStages)
    const absent=REQUIRED_EXPERT_STAGES.filter(stage=>!stages.has(stage))
    if(absent.length)
      missing.push(name+': etapas bilaterales no leídas: '+absent.join(', ')+'.')
    if(!Array.isArray(evidence.observedFacts)||
      evidence.observedFacts.filter(x=>typeof x==='string'&&x.trim().length>=12).length<3)
      missing.push(name+': el comprobante necesita al menos tres hechos observados, no cálculos.')
    let observed:readonly string[]|undefined
    try{observed=observedStages?.(leg)}catch{observed=undefined}
    if(requireTrusted&&!observed){
      missing.push(name+': falta evidencia de etapas confiable producida por las herramientas.')
    }else if(observed){
      const observedStageSet=new Set(observed)
      const absent=REQUIRED_EXPERT_STAGES.filter(stage=>!observedStageSet.has(stage))
      if(absent.length)
        missing.push(name+': las herramientas no verificaron estas etapas: '+absent.join(', ')+'.')
    }
  }
  return missing
}

type ModelChosenTicket = {
  complete: boolean
  priced: boolean
  finalReady: boolean
  finalizationMissing: string[]
  /** The receipt is supplied by the model; source content remains separately audited. */
  researchEvidenceStatus: 'trusted'|'self-reported'
  placed: false
  bookmaker: string | null
  quotes: Array<{
    eventId: string
    selection: string
    price: number
    bookmaker: string
    source: string
    observedAt: string
  }>
  missing: string[]
  uiBlock: ChatBlock
}

/** Validate selected predictions against exact ESPN event/time/market records.
 * @param chosen - Kira's explicit pregame reasons and source-backed fixtures.
 * @param fetcher - Injected provider for deterministic tests.
 * @param now - Quote observation moment.
 * @param requestedCount - Original ticket size, even if fewer picks were justified.
 * @param observedStages - Runtime-owned stage reader; absent stages keep the
 * ticket self-reported and not final-ready.
 * @returns A ticket draft or a properly priced same-bookmaker research ticket.
 */
export async function quoteKiraChosenTicket(chosen:readonly ModelChosenLeg[],
  fetcher:typeof fetch=fetch,now=Date.now(),requestedCount=chosen.length,
  observedStages?:TrustedResearchStageReader,
):Promise<ModelChosenTicket>{
  if(!Number.isInteger(requestedCount)||requestedCount<1||requestedCount>6||
    chosen.length<1||chosen.length>requestedCount||
    chosen.some(leg=>!valid(leg,now))||
    new Set(chosen.map(leg=>leg.sport+'|'+leg.league+'|'+leg.eventId)).size!==chosen.length)
    throw Error('Kira debe aportar 1-6 partidos futuros únicos y justificación propia verificable por pata')
  const verified=await Promise.all(chosen.map(async (leg)=>{
    const key=ticketLeagueOddsKey(leg,'dynamic')
    if(!key)return [] as ExactQuote[]
    try{
      const result=await lookupExactEspnWinner({
        sportKey:key,eventId:leg.eventId,date:leg.date,
        home:leg.home,away:leg.away,kickoff:leg.kickoff,
        ...(leg.sport==='soccer'?{ espnLeague:leg.league }:{}),
      },<T>(url:string)=>getFeed<T>(url,fetcher),now)
      const selected=leg.pick==='home'?leg.home:leg.away
      return result.quotes.filter(q=>
        q.eventId===leg.eventId&&sameEspnTeam(q.home,leg.home,key)&&
        sameEspnTeam(q.away,leg.away,key)&&sameEspnTeam(q.selection,selected,key)&&
        (q.market==='h2h'||leg.sport==='soccer'&&
          (q.market==='1x2'||q.market==='h2h'))&&isObserved(q,now))
    }catch{return [] as ExactQuote[]}
  }))
  const byBook=new Map<string,number>()
  for(const rows of verified)for(const book of new Set(rows.map(q=>q.bookmaker)))
    byBook.set(book,(byBook.get(book)??0)+1)
  // Deterministic alphabetical tie-break, NOT a ranking by odds or favorites.
  const best=[...byBook.entries()]
    .sort(([a,left],[b,right])=>right-left||a.localeCompare(b))[0]?.[0]??null
  const chosenQuotes=verified.map(rows=>rows.find(q=>q.bookmaker===best)??null)
  const complete=chosen.length===requestedCount&&best!==null&&chosenQuotes.every(q=>q!==null)
  const priced=complete
  const finalizationMissing=[...ticketResearchChecklist(chosen),
    ...ticketExpertEvidenceChecklist(chosen,observedStages,true)]
  const finalReady=complete&&finalizationMissing.length===0
  const trustedComplete=chosen.every((leg) => {
    try{return REQUIRED_EXPERT_STAGES.every(stage=>
      observedStages?.(leg)?.includes(stage)===true)}catch{return false}
  })
  const missing=chosen.flatMap((leg,i)=>chosenQuotes[i]?[ ]:
    ['Sin cuota ESPN del mismo bookmaker para '+leg.away+' vs '+leg.home+
      ' · selección '+(leg.pick==='home'?leg.home:leg.away)])
  if(chosen.length<requestedCount)
    missing.push(`Faltan ${requestedCount-chosen.length} de ${requestedCount} selecciones justificadas.`)
  const legs=chosen.map((leg,i)=>{
    const q=chosenQuotes[i],name=leg.pick==='home'?leg.home:leg.away
    return{ event:leg.away+' vs '+leg.home,selection:name,
      price:q?String(q.price):'No disponible',bookmaker:q?.bookmaker??'Sin precio',
      market:q?.market??(leg.sport==='soccer'?'1x2':'h2h'),
      sport:leg.sport,league:leg.league,eventId:leg.eventId,eventDate:leg.date,
      homeTeam:leg.home,awayTeam:leg.away,rationale:leg.reason.slice(0,475),
      quoteStatus:q?'espn-observed' as const:'unpriced' as const,
      quoteSource:q?.source??'ESPN sin oferta cotejada',
      quoteObservedAt:q?.observedAt??null,
      displayStatus:'research-selection' as const,
    }
  })
  const quotes=chosenQuotes.flatMap(q=>q?.observedAt?[{ eventId:q.eventId,
    selection:q.selection,price:q.price,bookmaker:q.bookmaker,
    source:q.source??'ESPN',observedAt:q.observedAt }]:[])
  const product=complete?quotes.reduce((total,q)=>total*q.price,1):null
  return{ complete,priced,finalReady,finalizationMissing,
    researchEvidenceStatus:trustedComplete?'trusted' as const:'self-reported' as const,
    placed:false as const,
    bookmaker:best,quotes,missing,
    uiBlock:{ component:'sports_ticket_card' as const,version:1 as const,props:{
      title:finalReady?'PHOENIX · Ticket final de análisis':
        'PHOENIX · Selecciones razonadas por Kira',
      subtitle:finalReady?'5–6 selecciones · evidencia documentada y cotizada':
        complete?'Cotizado, aún NO definitivo · evidencia pendiente':
          'Investigación incompleta · selecciones o cuotas de un mismo operador pendientes',
      source:'ESPN Site/Core · verificación exacta de cuotas por evento',
      requestedLegs:requestedCount,legs,
      combinedOdds:product===null?'No disponible':product.toFixed(3),
      note:(finalReady?'TICKET FINAL DE ANÁLISIS, NO APUESTA ACEPTADA. ':
        complete?'COTIZADO PERO NO DEFINITIVO: '+finalizationMissing.slice(0,3).join(' | ')+'. ':
          'TICKET INCOMPLETO. '+missing.join(' | ')+'. ')+
        'Kira eligió tras comparar datos; esta función no ordena equipos, '+
        'no evalúa probabilidades ni modifica los picks por el precio. '+
        'ESPN observado no significa que el bookmaker haya aceptado la apuesta. '+
        'El comprobante de etapas es autodeclarado por Kira; las URL deben abrirse y contrastarse. ' +
        'No se realizó ninguna apuesta ni se garantiza ganar.',
    } } }
}
