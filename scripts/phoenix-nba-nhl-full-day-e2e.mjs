/** Full-day, read-only PHOENIX NBA/NHL E2E audit, real ESPN/NHL endpoints.
 * Audits ALL fixtures, both teams, rosters/IDs, injuries, odds, specialists
 * and the actual PHOENIX ticket builder. Saves checkpoints without hiding
 * failed HTTP calls. Never places wagers or invents predictions.
 * Usage: PHOENIX_E2E_DATE=2026-11-12 node --experimental-strip-types scripts/phoenix-nba-nhl-full-day-e2e.mjs
 */
import {writeFile} from 'node:fs/promises'
import {collectDirectEspnStats} from '../packages/core/tool-sports/src/sports-direct-stats.ts'
import {parseEspnRoster} from '../packages/core/tool-sports/src/espn-public-roster.ts'
import {fetchEspnInjuryBackup} from '../packages/core/tool-sports/src/espn-injury-backup.ts'
import {fetchPublicEspnOddsDetailed} from '../packages/core/tool-sports/src/espn-odds.ts'
import {investigateTicketSpecialists,resolveNhlTicketMatch} from '../packages/core/tool-sports/src/ticket-specialist-gate.ts'
import {nhlSlate} from '../packages/core/tool-sports/src/nhl-evidence-research.ts'
import {evidencePricedTicket} from '../packages/core/tool-sports/src/evidence-priced-ticket.ts'

const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const date=process.env.PHOENIX_E2E_DATE||localDay()
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('Invalid PHOENIX_E2E_DATE')
const checkedAt=new Date().toISOString(),now=Date.now(),day=date.replaceAll('-','')
const site='https://site.api.espn.com/apis/site/v2/sports/'
const work={date,checkedAt,mode:'read-only/full-day NBA NHL',leagueCounts:{},
  checks:[],specialists:[],ticketEngine:[],audit:{
    httpRequests:0,cacheHits:0,httpErrors:[],unmatchedInjuries:0,
    lostRosters:0,missingGamelogs:0,missingSplits:0,identityConflicts:0,
  },notes:['ESPN web public APIs may change.',
    'A verified roster member is not a confirmed starter.',
    'An observed ESPN sportsbook quote is not a confirmed executable wager.']}
const clean=(e)=>String(e?.message??e).slice(0,200)
const recorded=new Map()
let inflight=0
const queue=[]
const withSlot=async task=>{
  if(inflight>=7)await new Promise(resolve=>queue.push(resolve))
  inflight++
  try{return await task()}finally{inflight--;queue.shift()?.()}
}
const request=async (input,init={})=>{
  const url=String(input instanceof Request?input.url:input)
  const host=new URL(url).hostname
  const cached=['site.api.espn.com','site.web.api.espn.com',
    'sports.core.api.espn.com','api-web.nhle.com','api.nhle.com'].includes(host)
  const prior=cached?recorded.get(url):null
  if(prior){
    work.audit.cacheHits++
    return (await prior).clone()
  }
  const task=withSlot(async()=>{
    work.audit.httpRequests++
    try{
      const signal=init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(9000)]):
        AbortSignal.timeout(9000)
      const response=await fetch(input,{...init,redirect:'error',signal,
        headers:{accept:'application/json','user-agent':'PHOENIX-FullDay-E2E/1.0',
          ...(init.headers??{})}})
      if(!response.ok){
        if(work.audit.httpErrors.length<100)work.audit.httpErrors.push({
          url:url.slice(0,250),status:response.status})
      }
      return response
    }catch(e){
      if(work.audit.httpErrors.length<100)work.audit.httpErrors.push({
        url:url.slice(0,250),status:'network',detail:clean(e)})
      throw e
    }
  })
  if(cached)recorded.set(url,task)
  try{return (await task).clone()}
  catch(e){recorded.delete(url);throw e}
}
const json=async url=>{
  const response=await request(url)
  if(!response.ok)throw Error('HTTP '+response.status+' '+url)
  return response.json()
}
const save=()=>writeFile('phoenix-nba-nhl-full-day-e2e.json',JSON.stringify(work,null,2)+'\n')
const one=async(event,sport,league,key)=>{
  const competition=event.competitions?.[0],competitors=competition?.competitors??[]
  const home=competitors.find(x=>x.homeAway==='home')?.team
  const away=competitors.find(x=>x.homeAway==='away')?.team
  const game={sport,league,eventId:String(event.id??''),
    competitionId:String(competition?.id??event.id??''),date,
    home:home?.displayName??null,away:away?.displayName??null,
    homeId:String(home?.id??''),awayId:String(away?.id??''),
    kickoff:String(event.date??''),status:event.status?.type?.state??'unknown'}
  const row={game,checkedAt:new Date().toISOString(),stats:null,
    rosters:null,injuries:null,odds:null,errors:[]}
  if(!/^\d{1,18}$/.test(game.eventId)||!home?.id||!away?.id||!game.kickoff){
    row.errors.push('Fixture without verified teams/eventId/date');return row
  }
  const base=site+sport+'/'+league+'/'
  const result=await Promise.allSettled([
    collectDirectEspnStats(sport,league,[
      {id:game.homeId,name:game.home},{id:game.awayId,name:game.away}
    ],request,now,4),
    fetchEspnInjuryBackup({sport,league,home:game.home,away:game.away,
      date,eventId:game.eventId,kickoff:game.kickoff},request,now),
    fetchPublicEspnOddsDetailed(key,'h2h,spreads,totals',json,
      {date,eventId:game.eventId,now,cache:false}),
    Promise.allSettled([game.homeId,game.awayId].map(tid=>
      json(base+'teams/'+tid+'/roster'))),
  ])
  const [stats,injuries,odds,rosters]=result
  const rosterIds={home:new Set(),away:new Set()}
  if(rosters.status==='fulfilled'){
    const arrays=rosters.value.map((data,i)=>{
      if(data.status!=='fulfilled')return{side:i?'away':'home',error:clean(data.reason),players:0}
      const people=parseEspnRoster(data.value)
      rosterIds[i?'away':'home']=new Set(people.map(p=>p.id))
      return{side:i?'away':'home',players:people.length,
        athleteIdsPresent:people.filter(p=>p.id).length,
        sample:people.slice(0,5).map(p=>({id:p.id,name:p.name,position:p.position}))}
    })
    row.rosters=arrays
  }else row.errors.push('Raw rosters: '+clean(rosters.reason))
  if(stats.status==='fulfilled'){
    row.stats={requests:stats.value.requests,errors:stats.value.errors,
      teams:stats.value.teams.map(t=>({
        id:t.id,name:t.name,rosterFound:t.athleteCount,
        athletesInspected:t.selectedCount,
        stats:t.stats.slice(0,16),
        athletes:t.athletes.map(p=>({
          id:p.id,name:p.name,statsCount:p.stats.length,
          lastGamesCount:p.lastGames.length,splitsCount:p.splits.length,
          verifiedSources:p.verifiedSources})),
        coverage:t.coverage,
      }))}
    for(const t of row.stats.teams){
      const raw=row.rosters?.find(x=>x.side===(t.id===game.homeId?'home':'away'))
      if(raw?.players>t.rosterFound)work.audit.lostRosters++
      work.audit.missingGamelogs+=t.athletes.filter(x=>x.lastGamesCount===0).length
      work.audit.missingSplits+=t.athletes.filter(x=>x.splitsCount===0).length
    }
  }else row.errors.push('Stats: '+clean(stats.reason))
  if(injuries.status==='fulfilled'){
    const report=injuries.value
    const format=(side)=>report[side].injuries.map(x=>{
      const known=Boolean(x.athleteId&&rosterIds[side].has(x.athleteId))
      if(!known)work.audit.unmatchedInjuries++
      return{athlete:x.athlete,athleteId:x.athleteId,
        status:x.status,reportedAt:x.reportedAt,
        rosterIdentity:known?'matched':'unmatched-or-unavailable'}
    })
    row.injuries={status:report.status,feedUpdatedAt:report.feedUpdatedAt,
      homeMatched:report.home.matched,awayMatched:report.away.matched,
      home:format('home'),away:format('away'),
      note:report.notes.slice(0,5)}
  }else row.errors.push('Injuries: '+clean(injuries.reason))
  if(odds.status==='fulfilled'){
    const report=odds.value
    row.odds={entries:report.quotes.length,
      bookmakers:[...new Set(report.quotes.map(x=>x.bookmaker))],
      h2h:report.quotes.filter(x=>x.market==='h2h').map(x=>({
        selection:x.selection,bookmaker:x.bookmaker,price:x.price,
        observedAt:x.observedAt,source:x.endpointSource})),
      markets:[...new Set(report.quotes.map(x=>x.market))],
      observedSince:row.checkedAt,diagnostics:report.diagnostics}
  }else row.errors.push('Odds: '+clean(odds.reason))
  return row
}
const config=[['basketball','nba','basketball_nba'],
  ['hockey','nhl','icehockey_nhl']]
const fixtures=[]
for(const [sport,league,key] of config){
  try{
    const board=await json(site+sport+'/'+league+'/scoreboard?dates='+day)
    const rows=(Array.isArray(board.events)?board.events:[]).filter(x=>
      x?.competitions?.[0]?.competitors?.length===2)
    work.leagueCounts[league]={raw:board.events?.length??0,valid:rows.length}
    fixtures.push(...rows.map(event=>({event,sport,league,key})))
  }catch(e){work.leagueCounts[league]={error:clean(e)}}
}
try{
  const slate=await nhlSlate(date,request,now)
  const espnHockey=fixtures.filter(x=>x.league==='nhl').map(x=>{
    const c=x.event.competitions?.[0]
    const h=c?.competitors?.find(y=>y.homeAway==='home')?.team
    const a=c?.competitors?.find(y=>y.homeAway==='away')?.team
    const target={home:h?.displayName??'',away:a?.displayName??'',kickoff:x.event.date??''}
    const exact=resolveNhlTicketMatch(slate.games,target)
    const near=slate.games.map(g=>({
      officialId:g.id,home:g.home.name,away:g.away.name,
      kickoff:g.date,homeAbbrev:g.home.abbrev,awayAbbrev:g.away.abbrev,
    })).filter(g=>Math.abs(Date.parse(g.kickoff)-Date.parse(target.kickoff))<60*60_000)
    return{eventId:String(x.event.id),espn:target,officialMatch:exact?.id??null,
      nearby:near.slice(0,5)}
  })
  work.nhlIdentity={officialGames:slate.games.length,espenGames:espnHockey.length,
    officialSample:slate.games.slice(0,6).map(g=>({
      id:g.id,home:g.home,away:g.away,date:g.date})),
    compare:espnHockey}
  console.log('FULL_DAY_NHL_IDENTITIES '+JSON.stringify(work.nhlIdentity).slice(0,18000))
}catch(e){work.nhlIdentity={error:clean(e)}}
console.log('FULL_DAY_DISCOVERY '+JSON.stringify(work.leagueCounts))
await save()
const rows=[]
let cursor=0
await Promise.all(Array.from({length:3},async()=>{
  while(cursor<fixtures.length){
    const {event,sport,league,key}=fixtures[cursor++] 
    try{
      const row=await one(event,sport,league,key)
      rows.push(row)
      console.log('FULL_DAY_EVENT '+JSON.stringify({
        eventId:row.game.eventId,league,home:row.game.home,away:row.game.away,
        rosters:row.stats?.teams?.map(t=>t.rosterFound),
        logs:row.stats?.teams?.map(t=>t.athletes.filter(x=>x.lastGamesCount>0).length),
        splits:row.stats?.teams?.map(t=>t.athletes.filter(x=>x.splitsCount>0).length),
        odds:row.odds?.entries,books:row.odds?.bookmakers,
        injuries:row.injuries?.status,errors:row.errors.length,
      }))
    }catch(e){rows.push({eventId:String(event.id),sport,league,error:clean(e)})}
    work.checks=[...rows].sort((a,b)=>(a.game?.kickoff??'').localeCompare(b.game?.kickoff??''))
    await save()
  }
}))
// Diagnose missing player gamelog/splits from the exact current ESPN payload.
// No invented values: emit shape and minimal structural samples, not raw data.
try{
  const nba=work.checks.find(x=>x.game?.league==='nba'&&
    x.stats?.teams?.some(t=>t.athletes.length))
  const nhl=work.checks.find(x=>x.game?.league==='nhl'&&
    x.stats?.teams?.some(t=>t.athletes.length))
  work.playerShape={}
  const summarize=(d)=>{
    const r=d&&typeof d==='object'?d:{}
    const seasons=Array.isArray(r.seasonTypes)?r.seasonTypes:[]
    const season=seasons[0]??{}
    const categories=Array.isArray(season.categories)?season.categories:[]
    const category=categories[0]??{}
    const splits=Array.isArray(r.splitCategories)?r.splitCategories:[]
    return{keys:Object.keys(r).slice(0,25),
      eventsType:typeof r.events,eventCount:r.events&&typeof r.events==='object'?
        Object.keys(r.events).length:0,
      seasonTypes:seasons.length,seasonKeys:Object.keys(season).slice(0,20),
      categories:categories.length,categoryKeys:Object.keys(category).slice(0,22),
      categoryEvents:category.events?.length??0,
      eventFirstKeys:Object.keys(category.events?.[0]??{}).slice(0,18),
      categoryLabels:category.labels?.slice?.(0,10)??null,
      splitCategories:splits.length,splitKeys:Object.keys(splits[0]??{}).slice(0,20),
      splitFirstKeys:Object.keys(splits[0]?.splits?.[0]??{}).slice(0,20),
    }
  }
  for(const candidate of [nba,nhl]){
    if(!candidate)continue
    const sport=candidate.game.sport,league=candidate.game.league
    const person=candidate.stats.teams.find(t=>t.athletes.length)?.athletes[0]
    if(!person)continue
    const root='https://site.web.api.espn.com/apis/common/v3/sports/'+sport+
      '/'+league+'/athletes/'+person.id+'/'
    const result={}
    for(const suffix of ['gamelog','splits']){
      try{result[suffix]=summarize(await json(root+suffix))}
      catch(e){result[suffix]={error:clean(e)}}
    }
    work.playerShape[league]={athleteId:person.id,...result}
  }
  console.log('FULL_DAY_PLAYER_SHAPES '+JSON.stringify(work.playerShape))
}catch(e){work.notes.push('Player shape probe: '+clean(e))}
await save()
const specialists=work.checks.filter(x=>x.game?.home&&x.game?.away).map(x=>({
  sport:x.game.sport,league:x.game.league,eventId:x.game.eventId,
  date,home:x.game.home,away:x.game.away,kickoff:x.game.kickoff,
}))
try{
  const audited=await investigateTicketSpecialists(specialists,request,now,
    {...process.env,PHOENIX_SPORTS_DAILY_PRELOAD_AUTO:'0'},[],17_000)
  work.specialists=audited.map(x=>({
    league:x.league,eventId:x.eventId,status:x.status,checkedAt:x.checkedAt,
    criticalPending:x.checklist?.criticalPending??[],
    steps:x.checklist?.fullSteps?.map(v=>({key:v.key,state:v.state,
      title:v.title,detail:v.detail}))??[],
    sourceChecks:x.sourceChecks?.map(v=>({provider:v.provider,status:v.status}))??[],
    endpointAudit:x.endpointAudit?.map(v=>({url:v.url,status:v.status}))??[],
    injuryStatus:x.injuryAudit?.status??'not-checked',
    playerHistoryAudit:x.playerHistoryAudit??null,
    pendingSteps:x.pendingSteps?.slice(0,10)??[],
  }))
}catch(e){work.notes.push('Specialist execution failed: '+clean(e))}
await save()
for(const sport of ['basketball','hockey','basketball,hockey']){
  try{
    const t=await evidencePricedTicket(5,date,sport,0,now,{
      ...process.env,PHOENIX_SPORTS_DAILY_PRELOAD_AUTO:'0',
      PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0',
    },request,undefined,'winner')
    const props=t.card?.props??{}
    const legKeys=(Array.isArray(props.legs)?props.legs:[]).map(x=>Object.keys(x))
    work.ticketEngine.push({sport,source:'actual evidencePricedTicket',
      publishedCard:t.card?.component,priced:t.priced,complete:t.complete,
      discoveredEvents:t.discoveredEvents,verifiedEvents:t.verifiedEvents,
      quotedLegs:t.quotedLegs,researchedLegs:t.researchedLegs,
      reviewedBeforeSelection:t.reviewedBeforeSelection,
      removedConflicts:t.removedConflicts,
      sourceAudit:t.sourceAudit?.map(s=>({
        source:s.source,status:s.status,offers:s.offers})),
      cardPropsKeys:Object.keys(props),legPropsKeys:legKeys.slice(0,2),
      uiHasAuditPayload:Boolean(props.discoveryAudit),
      explanation:String(t.explanation??'').slice(0,700)})
  }catch(e){work.ticketEngine.push({sport,error:clean(e)})}
  await save()
}
work.audit.fixtures=fixtures.length
work.audit.processed=work.checks.length
work.audit.withBothRosters=work.checks.filter(x=>x.stats?.teams?.every(t=>t.rosterFound>0)).length
work.audit.withH2HOdds=work.checks.filter(x=>x.odds?.h2h?.length>=2).length
work.audit.withBilateralInjuries=work.checks.filter(x=>
  x.injuries?.homeMatched&&x.injuries?.awayMatched).length
work.audit.specialistAudited=work.specialists.length
work.audit.completeCards=work.ticketEngine.filter(x=>x.complete).length
await save()
const markdown=[
  '# PHOENIX · NBA + NHL E2E '+date,'',
  'Read-only · '+checkedAt+' · 4 NBA/11 NHL only if returned by ESPN.','',
  '| League | Event | Home | Away | Roster H/A | H2H | Books | Injuries | Specialist |',
  '|---|---|---|---|---|---|---|---|---|',
  ...work.checks.map(x=>{
    const g=x.game??{},rs=x.stats?.teams?.map(t=>t.rosterFound).join('/')??'—'
    const sp=work.specialists.find(s=>s.eventId===g.eventId)
    return '| '+(g.league??x.league)+' | '+(g.eventId??x.eventId)+' | '+
      (g.home??'—')+' | '+(g.away??'—')+' | '+rs+' | '+
      (x.odds?.h2h?.length??0)+' | '+(x.odds?.bookmakers?.length??0)+' | '+
      (x.injuries?.status??'error')+' | '+(sp?.status??'missing')+' |'
  }),
  '','## Ticket builders', '',
  ...work.ticketEngine.map(x=>'- '+x.sport+': '+(x.error??(
    'discovered='+x.discoveredEvents+', researched='+x.researchedLegs+
    ', priced='+x.quotedLegs+', complete='+x.complete))),
  '','## Observed data gaps', '',
  ...Object.entries(work.audit).map(([key,value])=>'- '+key+': '+
    (Array.isArray(value)?value.length:JSON.stringify(value))),
  '','HTTP 200 alone is not player stats or bookmaker acceptance.',
]
await writeFile('phoenix-nba-nhl-full-day-e2e.md',markdown.join('\n')+'\n')
console.log('FULL_DAY_SUMMARY '+JSON.stringify({
  date,leagues:work.leagueCounts,audit:work.audit,ticketEngine:work.ticketEngine.map(x=>({
    sport:x.sport,discovered:x.discoveredEvents,researched:x.researchedLegs,
    priced:x.quotedLegs,complete:x.complete,error:x.error})),
}))
