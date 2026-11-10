/** Execute actual PHOENIX sports adapters, not just HEAD checks or mock fixtures.
 * Records the data delivered to the selection engine per matchup.
 */
import {writeFile} from 'node:fs/promises'
import {fetchEspnInjuryBackup} from '../packages/core/tool-sports/src/espn-injury-backup.ts'
import {collectDirectEspnStats} from '../packages/core/tool-sports/src/sports-direct-stats.ts'
import {fetchPublicEspnOddsDetailed} from '../packages/core/tool-sports/src/espn-odds.ts'
const now=Date.now(),date=new Date(now).toISOString().slice(0,10)
const output={date,checkedAt:new Date(now).toISOString(),checks:[],errors:[]}
const root='https://site.api.espn.com/apis/site/v2/sports/'
const error=(e)=>String(e?.message??e).slice(0,300)
const request=async url=>{
 const response=await fetch(url,{headers:{accept:'application/json',
   'user-agent':'PhoenixSportsAdapterEvidence/1.0'},
   redirect:'error',signal:AbortSignal.timeout(8500)})
 if(!response.ok)throw Error('HTTP '+response.status+' @ '+url)
 return response.json()
}
const fetcher=async(input,init)=>{
 const url=String(input instanceof Request?input.url:input)
 return fetch(url,{...init,signal:init?.signal?
   AbortSignal.any([init.signal,AbortSignal.timeout(8500)]):AbortSignal.timeout(8500)})
}
for(const [sport,league,oddsKey] of [
 ['basketball','nba','basketball_nba'],
 ['hockey','nhl','icehockey_nhl'],
]){
 try{
   const board=await request(root+sport+'/'+league+'/scoreboard?dates='+date.replaceAll('-',''))
   const fixture=(board.events??[]).find(e=>e.competitions?.[0]?.competitors?.length===2)
   if(!fixture){output.checks.push({sport,league,status:'no_game_today'});continue}
   const competitors=fixture.competitions[0].competitors
   const home=competitors.find(c=>c.homeAway==='home')?.team
   const away=competitors.find(c=>c.homeAway==='away')?.team
   if(!home||!away)throw Error('Competitor identity missing')
   const game={sport,league,eventId:String(fixture.id),date,home:home.displayName,
     away:away.displayName,kickoff:fixture.date}
   const [injury,stats,odds]=await Promise.allSettled([
     fetchEspnInjuryBackup(game,fetcher,now),
     collectDirectEspnStats(sport,league,[
       {id:String(home.id),name:home.displayName},
       {id:String(away.id),name:away.displayName}],fetcher,now,2),
     fetchPublicEspnOddsDetailed(oddsKey,'h2h,totals,spreads',
       url=>request(url),{now,date,eventId:String(fixture.id),cache:false}),
   ])
   const row={game,checkedAt:new Date().toISOString(),
     injuries:injury.status==='fulfilled'?{
       status:injury.value.status,homeMatched:injury.value.home.matched,
       awayMatched:injury.value.away.matched,
       homeInjuries:injury.value.home.injuries.slice(0,12).map(x=>({
         athlete:x.athlete,status:x.status,reportedAt:x.reportedAt})),
       awayInjuries:injury.value.away.injuries.slice(0,12).map(x=>({
         athlete:x.athlete,status:x.status,reportedAt:x.reportedAt})),
       feedUpdatedAt:injury.value.feedUpdatedAt,notes:injury.value.notes,
       source:injury.value.source}: {error:error(injury.reason)},
     stats:stats.status==='fulfilled'?{
       requests:stats.value.requests,errors:stats.value.errors,
       teams:stats.value.teams.map(t=>({
         team:t.name,players:t.athleteCount,
         metrics:t.stats.slice(0,8),
         playerStats:t.athletes.map(a=>({name:a.name,statCount:a.stats.length,
           lastGames:a.lastGames.length,splits:a.splits.length})),
         sourceCoverage:t.coverage
       }))}:{error:error(stats.reason)},
     odds:odds.status==='fulfilled'?{
       activeQuotes:odds.value.quotes.length,
       referenceQuotes:odds.value.observations.length,
       sampleReferences:odds.value.observations.slice(0,6).map(q=>({
         selection:q.selection,bookmaker:q.bookmaker,price:q.price,
         market:q.market,reason:q.reason,origin:q.endpointSource})),
       diagnostics:odds.value.diagnostics,
     }:{error:error(odds.reason)},
   }
   output.checks.push(row)
   console.log('SPORTS_ADAPTER_RESULT '+JSON.stringify(row))
 }catch(e){
   const x={sport,league,error:error(e)}
   output.errors.push(x);console.log('SPORTS_ADAPTER_ERROR '+JSON.stringify(x))
 }
}
await writeFile('phoenix-sports-adapter-live.json',JSON.stringify(output,null,2))
console.log('SPORTS_ADAPTER_SUMMARY '+JSON.stringify({
 date,events:output.checks.length,errors:output.errors.length,
 checks:output.checks.map(x=>({league:x.game?.league,
 injury:x.injuries?.status,injuredHome:x.injuries?.homeInjuries?.length,
 injuredAway:x.injuries?.awayInjuries?.length,
 metrics:x.stats?.teams?.map(t=>t.metrics.length),
 oddsReferences:x.odds?.referenceQuotes,oddsPriced:x.odds?.activeQuotes}))}))
