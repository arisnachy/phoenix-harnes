/**
 * Real-HTTP snapshot of the 2026-11-12 NHL sources used by PHOENIX.
 * Never equates a 200 response, a team roster or a probable goalie with
 * confirmed starters, lineup availability or a valid bet.
 */
import {writeFileSync} from 'node:fs'
const B='https://api-web.nhle.com/v1/'
const season='20262027'
const teams=['CBJ','TBL','BUF','CHI','WPG','DAL','NYI','LAK']
const cases=[
  {kind:'NHL daily score',url:B+'score/2026-11-11'},
  {kind:'NHL daily score',url:B+'score/2026-11-12'},
  {kind:'NHL gamecenter',url:B+'gamecenter/2026020304/landing'},
  {kind:'NHL gamecenter',url:B+'gamecenter/2026020304/right-rail'},
  {kind:'NHL gamecenter',url:B+'gamecenter/2026020304/boxscore'},
  {kind:'NHL leaders',url:B+'goalie-stats-leaders/current'},
  {kind:'NHL standings',url:B+'standings/now'},
  {kind:'NHL player landing',url:B+'player/8476883/landing'},
  {kind:'NHL player game log',url:B+'player/8476883/game-log/'+season+'/2'},
  {kind:'ESPN NBA depthchart reference',
    url:'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/teams/27/depthcharts'},
  {kind:'ESPN NHL injuries',
    url:'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'},
  ...teams.flatMap(code=>[
    {kind:'NHL roster '+code,url:B+'roster/'+code+'/'+season},
    {kind:'NHL season schedule '+code,url:B+'club-schedule-season/'+code+'/'+season},
  ]),
]
const observations=new Array(cases.length)
let cursor=0
async function inspect(item){
  let target=item.url,response=null,redirects=0
  const start=Date.now()
  try{
    for(let count=0;count<=2;count++){
      response=await fetch(target,{redirect:'manual',headers:{accept:'application/json'},
        signal:AbortSignal.timeout(10000)})
      if(![301,302,303,307,308].includes(response.status))break
      redirects++
      if(count===2)throw Error('More than two provider redirects')
      const location=response.headers.get('location')
      if(!location)throw Error('Redirect without Location')
      const next=new URL(location,target),initial=new URL(item.url)
      if(next.protocol!=='https:'||next.host!==initial.host||
        next.username||next.password)throw Error('Unsafe cross-provider redirect')
      target=next.toString()
    }
    const body=await response.text()
    let data=null
    try{data=JSON.parse(body)}catch{}
    const root=data&&typeof data==='object'&&!Array.isArray(data)?data:{}
    const counts=Object.fromEntries(['games','forwards','defensemen','goalies',
      'standings','gameLog','entries','items','depthcharts','athletes','injuries']
      .filter(k=>Array.isArray(root[k])).map(k=>[k,root[k].length]))
    const structuralEvidence=Object.keys(counts).length>0||
      Object.keys(root).length>0
    return{...item,http:response.status,finalUrl:target,redirects,
      contentType:response.headers.get('content-type'),
      bytes:Buffer.byteLength(body),json:data!==null,
      keys:Object.keys(root).slice(0,16),counts,
      verifiedResponse:response.ok&&data!==null&&structuralEvidence,
      ms:Date.now()-start}
  }catch(e){
    return{...item,http:response?.status??null,finalUrl:target,redirects,
      verifiedResponse:false,error:e instanceof Error?e.message:String(e),
      ms:Date.now()-start}
  }
}
await Promise.all(Array.from({length:3},async()=>{
  while(cursor<cases.length){
    const n=cursor++
    observations[n]=await inspect(cases[n])
  }
}))
const ok=observations.filter(x=>x.verifiedResponse).length
const report={date:'2026-11-12',checkedAt:new Date().toISOString(),
  note:'HTTP/JSON structural observations, not player availability or confirmed goalies.',
  checked:observations.length,verifiedResponses:ok,missing:observations.length-ok,
  observations}
writeFileSync('phoenix-nhl-2026-live-probe.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({checked:report.checked,verifiedResponses:ok,
  missing:report.missing,failed:observations.filter(x=>!x.verifiedResponse)
    .map(x=>({kind:x.kind,http:x.http,error:x.error??null}))},null,2))
// Endpoint access is external and may vary; persist failures rather than
// blindly failing deployment CI. --strict allows explicit hard-gating.
if(process.argv.includes('--strict')&&ok!==observations.length)process.exitCode=1
