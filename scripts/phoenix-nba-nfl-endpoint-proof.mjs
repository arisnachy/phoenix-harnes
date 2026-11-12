/** Live, inspectable NBA/NFL network + PHOENIX adapter proof.
 * Run: node --experimental-strip-types scripts/phoenix-nba-nfl-endpoint-proof.mjs [YYYYMMDD]
 * Does not treat 200 OK as proof that the expected records exist.
 */
import {writeFile} from 'node:fs/promises'
import {collectDirectEspnStats} from '../packages/core/tool-sports/src/sports-direct-stats.ts'
const calendar=new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(new Date())
const date=process.argv[2]??['year','month','day'].map(part=>
  calendar.find(x=>x.type===part)?.value??'').join('')
if(!/^20\d{6}$/.test(date))throw Error('Expected YYYYMMDD date')
const report={date,checkedAt:new Date().toISOString(),leagues:{},errors:[]}
const accept={'accept':'application/json','user-agent':'PhoenixSportsEvidenceProbe/1.0'}
const http=async(url)=>{
  const started=Date.now()
  try{
    const response=await fetch(url,{headers:accept,redirect:'error',
      signal:AbortSignal.timeout(10000)})
    const payload=response.ok?await response.json():null
    const record={url,httpStatus:response.status,durationMs:Date.now()-started,
      topLevelKeys:payload&&typeof payload==='object'?Object.keys(payload).slice(0,16):[],
      body:payload}
    return record
  }catch(e){
    return {url,httpStatus:null,durationMs:Date.now()-started,
      error:String(e?.message??e).slice(0,220),topLevelKeys:[],body:null}
  }
}
const compact=(res, count)=>({
  url:res.url,httpStatus:res.httpStatus,durationMs:res.durationMs,
  topLevelKeys:res.topLevelKeys,recordCount:count,usable:res.httpStatus===200&&count>0,
  ...(res.error?{error:res.error}:{})
})
const arr=x=>Array.isArray(x)?x:[]
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x:{}
const athletes=raw=>{
  const seen=new Map(),queue=[...arr(obj(raw).athletes)]
  let traversed=0
  while(queue.length&&traversed++<220){
    const x=obj(queue.shift())
    if(/^\d+$/.test(String(x.id??''))&&x.displayName)
      seen.set(String(x.id),String(x.displayName))
    for(const child of arr(x.items??x.athletes))queue.push(child)
  }
  return [...seen].map(([id,name])=>({id,name}))
}
const depthCount=raw=>{
  const root=obj(raw),queue=[...arr(root.depthCharts),...arr(root.depthcharts),
    ...arr(root.depthchart),...arr(root.depthChart)]
  if(root.depthchart&&!Array.isArray(root.depthchart))queue.push(root.depthchart)
  if(!queue.length)queue.push(root)
  let n=0,examined=0
  while(queue.length&&examined++<200){
    const chart=obj(queue.shift())
    const positions=chart.positions
    const slots=Array.isArray(positions)?positions:Object.values(obj(positions))
    for(const pos of slots)n+=arr(obj(pos).athletes??obj(pos).players).length
    for(const child of arr(chart.items))queue.push(child)
    for(const child of arr(chart.depthCharts??chart.depthcharts))queue.push(child)
  }
  return n
}
const fetcher=(url,init)=>fetch(url,{...init,redirect:'error',
  signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10000)]):
    AbortSignal.timeout(10000)})
for(const [sport,league,fallback] of [
  ['basketball','nba',['18','15']],
  ['football','nfl',['1','4']],
]){
  const base='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+'/'
  const urls={
    schedule:base+'scoreboard?dates='+date,
    leagueInjuries:base+'injuries',
    standings:'https://site.api.espn.com/apis/v2/sports/'+sport+'/'+league+'/standings',
    news:base+'news?limit=8'
  }
  const core=await Promise.all(Object.values(urls).map(http))
  const [board,medical,standings,news]=core
  const events=arr(obj(board.body).events)
  // A quiet date is not a dead API. NFL also has a weekly scoreboard.
  let candidates=events
  let weekly=null
  if(league==='nfl'&&!candidates.length){
    weekly=await http(base+'scoreboard')
    candidates=arr(obj(weekly.body).events)
  }
  const match=candidates.find(x=>arr(obj(arr(obj(x).competitions)[0]).competitors).length===2)
  const teams=arr(obj(arr(obj(match).competitions)[0]).competitors).map(x=>obj(obj(x).team))
  const ids=teams.map(t=>String(t.id??'')).filter(x=>/^\d+$/.test(x))
  const chosen=[...new Set([...ids,...fallback])].slice(0,2)
  const teamRows=[]
  for(const teamId of chosen){
    const probes=await Promise.all([
      http(base+'teams/'+teamId+'/roster'),
      http(base+'teams/'+teamId+'/depthcharts'),
      http(base+'teams/'+teamId+'/statistics'),
      http(base+'teams/'+teamId+'/schedule')
    ])
    const [roster,depth,stats,schedule]=probes
    const rosterPeople=athletes(roster.body)
    const sample=rosterPeople[0]
    const personProbes=sample?await Promise.all(['stats','gamelog','splits'].map(route=>
      http('https://site.web.api.espn.com/apis/common/v3/sports/'+sport+
        '/'+league+'/athletes/'+sample.id+'/'+route))):[]
    if(teamRows.length===0){
      // Public JSON shapes only: cap bytes; no odds, secrets or full medical records.
      const shapeDepth=obj(depth.body)
      const groups=[...arr(shapeDepth.depthchart),...arr(shapeDepth.depthCharts)]
      const first=groups[0]??shapeDepth.depthchart??shapeDepth
      const positionEntries=Object.entries(obj(obj(first).positions))
      console.log('PHOENIX_ESPN_PUBLIC_SHAPE '+JSON.stringify({
        league,teamId,depthHttp:depth.httpStatus,
        depthKeys:depth.topLevelKeys,depthGroups:groups.length,
        positionCount:positionEntries.length,
        samplePositions:positionEntries.slice(0,2).map(([code,slot])=>({
          code,keys:Object.keys(obj(slot)),playerCount:arr(obj(slot).athletes).length,
          names:arr(obj(slot).athletes).slice(0,3).map(x=>obj(x).displayName)})),
        rosterGroups:arr(obj(roster.body).athletes).slice(0,2).map(x=>({
          keys:Object.keys(obj(x)),itemCount:arr(obj(x).items).length})),
        athleteId:sample?.id,
        splitsHttp:personProbes[2]?.httpStatus,
        splitsKeys:personProbes[2]?.topLevelKeys,
        splitsJson:personProbes[2]?.body,
        gamelogHttp:personProbes[1]?.httpStatus,
        gamelogKeys:personProbes[1]?.topLevelKeys
      }).slice(0,5500))
    }
    teamRows.push({
      teamId,roster:compact(roster,rosterPeople.length),rosterSample:rosterPeople.slice(0,3),
      depthChart:compact(depth,depthCount(depth.body)),
      teamStatistics:compact(stats,
        arr(obj(stats.body).results).length||
        Object.keys(obj(obj(stats.body).results)).length||
        arr(obj(stats.body).categories).length),
      schedule:compact(schedule,arr(obj(schedule.body).events).length),
      athlete:sample?{id:sample.id,name:sample.name,
        routes:personProbes.map(x=>compact(x,
          Object.keys(obj(x.body)).filter(k=>k!=='status'&&k!=='timestamp').length))}:null
    })
  }
  // This explicitly exercises the SAME adapter that Kira uses.
  let adapter
  try{
    const dossier=await collectDirectEspnStats(sport,league,
      chosen.map(id=>({id,name:teams.find(t=>String(t.id)===id)?.displayName??id})),
      fetcher,Date.now(),3)
    adapter={requests:dossier.requests,errors:dossier.errors,
      teams:dossier.teams.map(t=>({
        id:t.id,rosterCount:t.roster.length,depthChartRows:t.depthChart.length,
        depthChartSample:t.depthChart.slice(0,6),teamMetrics:t.stats.length,
        coverage:t.coverage,athletes:t.athletes.map(p=>({
          id:p.id,name:p.name,stats:p.stats.length,gamelog:p.lastGames.length,
          splits:p.splits.length,verifiedSources:p.verifiedSources,coverage:p.coverage
        }))
      }))}
  }catch(e){adapter={error:String(e?.message??e).slice(0,260)}}
  report.leagues[league]={
    schedule:compact(board,events.length),
    ...(weekly?{weeklySchedule:compact(weekly,candidates.length)}:{}),
    injuries:compact(medical,arr(obj(medical.body).injuries).length),
    standings:compact(standings,arr(obj(standings.body).children).length),
    news:compact(news,arr(obj(news.body).articles).length),
    eventId:match?String(match.id):null,
    teams:teamRows,adapter
  }
  console.log('PHOENIX_NBA_NFL_PROOF '+JSON.stringify({
    league,scheduledEvents:events.length,eventId:match?.id??null,
    sourceStatus:core.map(c=>c.httpStatus),
    teams:teamRows.map(t=>({id:t.teamId,roster:t.roster.recordCount,
      depthChartPlayers:t.depthChart.recordCount,
      statsHttp:t.teamStatistics.httpStatus})),
    adapter:adapter?.teams?.map(t=>({id:t.id,roster:t.rosterCount,
      depth:t.depthChartRows,playerSplits:t.athletes.map(p=>p.splits),
      splitSeasonSources:t.athletes.map(p=>p.verifiedSources.filter(x=>
        x.startsWith('splits')))}))
  }))
}
const file='phoenix-nba-nfl-endpoint-proof.json'
await writeFile(file,JSON.stringify(report,null,2))
const good=Object.values(report.leagues).every(league=>
  league.teams.some(t=>t.roster.usable)&&
  (league.adapter?.teams??[]).some(t=>t.rosterCount>0))
console.log('PHOENIX_NBA_NFL_PROOF_RESULT '+JSON.stringify({
  date,allLeaguesHaveLiveRostersAndParsedAdapter:good,file
}))
if(process.env.PHOENIX_SPORTS_PROOF_STRICT==='1'&&!good)process.exitCode=1
