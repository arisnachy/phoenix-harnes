/** Inspect NHL's public API contracts using real HTTP, independently of ESPN.
 * Run: node scripts/phoenix-nhl-live-endpoint-proof.mjs [YYYY-MM-DD]
 * Logs HTTP code, transport errors, actual JSON keys and useful record counts.
 */
import {writeFile} from 'node:fs/promises'

const date=process.argv[2]??'2026-11-12'
if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Date must be YYYY-MM-DD')
const season='20262027',base='https://api-web.nhle.com/v1/'
const teams=['CBJ','TBL','BUF','CHI','WPG','DAL','NYI','LAK']
const games=['2026020304','2026020305','2026020306','2026020308']
const urls=[
  {group:'league',type:'score',url:base+'score/'+date},
  {group:'league',type:'schedule',url:base+'schedule/'+date},
  {group:'league',type:'standings',url:base+'standings/now'},
  {group:'league',type:'goalie-leaders',url:base+'goalie-stats-leaders/current'},
  ...teams.flatMap(team=>[
    {group:team,type:'roster-current',url:base+'roster/'+team+'/current'},
    {group:team,type:'roster-season',url:base+'roster/'+team+'/'+season},
    {group:team,type:'schedule-now',url:base+'club-schedule-season/'+team+'/now'},
    {group:team,type:'schedule-season',url:base+'club-schedule-season/'+team+'/'+season},
    {group:team,type:'schedule-month',url:base+'club-schedule/'+team+'/month/now'},
  ]),
  ...games.flatMap(id=>['landing','right-rail','boxscore'].map(t=>({
    group:id,type:t,url:base+'gamecenter/'+id+'/'+t
  }))),
  {group:'player',type:'landing',url:base+'player/8476883/landing'},
  {group:'player',type:'gamelog',url:base+'player/8476883/game-log/'+season+'/2'},
  {group:'stats-rest',type:'powerplay',
    url:'https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp='+encodeURIComponent('seasonId='+season+' and gameTypeId=2')+'&limit=100'},
  {group:'stats-rest',type:'penaltykill',
    url:'https://api.nhle.com/stats/rest/en/team/penaltykill?cayenneExp='+encodeURIComponent('seasonId='+season+' and gameTypeId=2')+'&limit=100'},
]
const arr=x=>Array.isArray(x)?x:[]
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x:{}
const counts=x=>{
  const o=obj(x),depth=obj(o.depthchart)
  return {games:arr(o.games).length,gameWeek:arr(o.gameWeek).length,
    forwards:arr(o.forwards).length,defensemen:arr(o.defensemen).length,
    goalies:arr(o.goalies).length,standings:arr(o.standings).length,
    gameLog:arr(o.gameLog).length,data:arr(o.data).length,
    scoring:arr(o.scoringLeaders).length,
    items:arr(o.items).length,keys:Object.keys(o).length}
}
const fetchOne=async t=>{
  const begin=Date.now()
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await fetch(t.url,{headers:{accept:'application/json',
        'user-agent':'PHOENIX-NHL-SourceProof/1.0'},
        redirect:'error',signal:AbortSignal.timeout(11000)})
      const type=response.headers.get('content-type')??''
      let body=null
      if(response.ok&&type.includes('json')){
        body=await response.json()
      }
      const meta={...t,http:response.status,ok:response.ok,attempt,
        elapsedMs:Date.now()-begin,contentType:type,
        topLevelKeys:Object.keys(obj(body)).slice(0,18),
        counts:counts(body),
        sampleGameIds:arr(obj(body).games).slice(0,3).map(x=>obj(x).id),
        samplePlayer:arr(obj(body).goalies).slice(0,1).map(x=>({
          id:obj(x).id,firstName:obj(x).firstName,lastName:obj(x).lastName})),
      }
      console.log('NHL_PROOF '+JSON.stringify(meta))
      return meta
    }catch(e){
      if(attempt===2){
        const record={...t,http:null,ok:false,attempt,
          elapsedMs:Date.now()-begin,error:String(e?.message??e).slice(0,180)}
        console.log('NHL_PROOF '+JSON.stringify(record))
        return record
      }
    }
  }
}
const results=Array(urls.length)
let pos=0
await Promise.all(Array.from({length:3},async()=>{
  while(pos<urls.length){
    const idx=pos++
    results[idx]=await fetchOne(urls[idx])
  }
}))
const summary={checkedAt:new Date().toISOString(),date,season,
  requested:results.length,success:results.filter(x=>x.ok).length,
  transportErrors:results.filter(x=>x.http===null).length,
  results}
await writeFile('phoenix-nhl-live-endpoint-proof.json',JSON.stringify(summary,null,2))
const matrix=teams.map(team=>{
  const rows=results.filter(x=>x.group===team)
  return{team,rosterCurrent:rows.find(x=>x.type==='roster-current')?.http??null,
    rosterSeason:rows.find(x=>x.type==='roster-season')?.http??null,
    scheduleNow:rows.find(x=>x.type==='schedule-now')?.http??null,
    scheduleSeason:rows.find(x=>x.type==='schedule-season')?.http??null,
    scheduleMonth:rows.find(x=>x.type==='schedule-month')?.http??null}
})
console.log('NHL_PROOF_SUMMARY '+JSON.stringify({date,success:summary.success,
  transportErrors:summary.transportErrors,teams:matrix}))
if(process.env.PHOENIX_NHL_PROOF_STRICT==='1'&&
  (!results.find(x=>x.type==='score'&&x.counts?.games>0)||
  !teams.every(team=>results.some(x=>x.group===team&&
    x.type.startsWith('roster')&&
    (x.counts?.forwards??0)+(x.counts?.defensemen??0)+(x.counts?.goalies??0)>0))))
  process.exitCode=1
