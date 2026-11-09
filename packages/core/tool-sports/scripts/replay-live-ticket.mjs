/** Execute the SAME public-data ticket pipeline as PHOENIX, on a GitHub runner.
 * Real HTTP calls are observed without keys; every network failure is retained
 * as evidence. This is a diagnostic replay, not a paid betting recommendation.
 */
import {writeFile} from 'node:fs/promises'
import {scoutDailySports} from '../src/daily-sports-scout.ts'
import {evidencePricedTicket} from '../src/evidence-priced-ticket.ts'
import {santoDomingoDay} from '../src/sports-daily-preload.ts'
const day=process.env.PHOENIX_REPLAY_DATE||santoDomingoDay()
const count=Math.max(5,Math.min(6,Number(process.env.PHOENIX_REPLAY_COUNT||5)))
if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isInteger(count))
  throw Error('Fecha o cantidad de patas de replay inválida')
const now=Date.now()
const nativeFetch=globalThis.fetch.bind(globalThis)
const activity=new Map()
const errors=[]
let calls=0
const maxCalls=850
const fetcher=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
  const key=url.hostname+(url.pathname.includes('scoreboard')?'/scoreboard':
    url.pathname.includes('summary')?'/summary':'/other')
  if(++calls>maxCalls)throw Error('Replay superó presupuesto de llamadas públicas')
  const begin=Date.now()
  try{
    const abort=AbortSignal.timeout(9000)
    const signal=init.signal?AbortSignal.any([init.signal,abort]):abort
    const response=await nativeFetch(url,{...init,signal,redirect:'error'})
    const row=activity.get(key)||{requests:0,success:0,httpErrors:0,latencyMs:0}
    row.requests++
    row.success+=Number(response.ok)
    row.httpErrors+=Number(!response.ok)
    row.latencyMs+=Date.now()-begin
    activity.set(key,row)
    if(!response.ok)errors.push({source:key,status:response.status})
    return response
  }catch(error){
    const row=activity.get(key)||{requests:0,success:0,httpErrors:0,latencyMs:0}
    row.requests++;row.httpErrors++;row.latencyMs+=Date.now()-begin
    activity.set(key,row)
    errors.push({source:key,error:error instanceof Error?error.name:'unknown'})
    throw error
  }
}
// Make the instrumented adapter the default global transport too, so the
// SAME production dailyResearchFetcher cache/quota path runs on CI.
globalThis.fetch=fetcher
const report={
  day,count,startedAt:new Date(now).toISOString(),
  engine:'PHOENIX tool-sports real pipeline',publicOnly:true,
  stages:[],network:{},diagnostic:{},completedAt:null,
}
const stage=async(label,action)=>{
  const begin=Date.now()
  try{
    const value=await action()
    report.stages.push({step:label,status:'ok',elapsedMs:Date.now()-begin})
    return value
  }catch(error){
    report.stages.push({step:label,status:'failed',elapsedMs:Date.now()-begin,
      error:error instanceof Error?error.message.slice(0,300):'unknown'})
    return null
  }
}
const scout=await stage('01-slate',()=>scoutDailySports(day,36,fetcher,now,{
  PHOENIX_SPORTS_ESPN_DISABLED:'0',
}))
if(scout)report.diagnostic.discovery={
  totalEligible:scout.totalEligible,
  listed:scout.events.length,
  sports:[...new Set(scout.events.map(x=>x.sport))],
  coverage:scout.coverage.map(x=>({sport:x.sport,league:x.league,
    status:x.status,futureEvents:x.futureEvents})),
}
const ticket=await stage('02-historical-candidates-specialists-odds-critic',
  ()=>evidencePricedTicket(count,day,undefined,0,now,{
    PHOENIX_SPORTS_ESPN_DISABLED:'0',
    PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0',
    PHOENIX_SPORTS_FREE_BACKUPS_DISABLED:'0',
    PHOENIX_SPORTS_DAILY_PRELOAD_AUTO:'0',
  },fetcher,async()=>[],'winner'))
if(ticket)report.diagnostic.ticket={
  researchedBeforeFinalChoice:ticket.reviewedBeforeSelection,
  removedIdentityConflicts:ticket.removedConflicts,
  actualLegs:ticket.verifiedEvents,quoted:ticket.quotedLegs,
  complete:ticket.complete,conditional:ticket.conditional,
  risks:ticket.decisionAudit.legs.map(x=>({eventId:x.eventId,sport:x.sport,
    verdict:x.verdict,pending:x.criticalPending,reason:x.reasons})),
  specialists:ticket.specialistChecks.map(x=>({eventId:x.eventId,
    status:x.status,verified:x.checklist?.verified??null,
    pending:x.checklist?.criticalPending??x.pendingSteps.slice(0,5)})),
  sourceAudit:ticket.sourceAudit.map(x=>({name:x.source,status:x.status,offers:x.offers})),
  modelConflicts:ticket.modelAudit.filter(x=>x.status==='contradiction').length,
  explanation:ticket.explanation.slice(0,1200),
}
report.network={
  calls,byEndpoint:[...activity].map(([source,data])=>({source,...data})),
  recentFailures:errors.slice(-50),
}
report.completedAt=new Date().toISOString()
await writeFile('phoenix-sports-live-replay.json',JSON.stringify(report,null,2)+'\n')
console.log('PHOENIX SAME-ENGINE REPLAY',JSON.stringify(report))
if(!scout||!ticket)process.exitCode=1
