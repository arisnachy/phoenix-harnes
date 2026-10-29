#!/usr/bin/env node
/** Non-destructive availability diagnostics for four unofficial ESPN Core paths.
 * A 200 response with a provider is not necessarily a fresh sportsbook quote.
 */
import {espnCoreUrl} from '../packages/core/tool-sports/src/espn-core-intelligence.ts'
const base={sport:'football',league:'nfl'}
const probes=[
  {mode:'odds',eventId:'401220181',competitionId:'401220181'},
  {mode:'ats',season:2026,teamId:'1',seasonType:2},
  {mode:'futures',season:2026},
  {mode:'past_performances',teamId:'1',providerId:'41',limit:2},
]
const results=[]
for(const q of probes){
  const url=espnCoreUrl({...base,...q})
  const start=Date.now()
  try{
    const response=await fetch(url,{
      headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8500),
    })
    let count=null,keys=[]
    if(response.ok){
      const raw=await response.text()
      if(raw.length>2_000_000)throw Error('Respuesta supera 2 MB')
      const parsed=JSON.parse(raw)
      count=typeof parsed?.count==='number'?parsed.count:undefined
      keys=parsed&&typeof parsed==='object'?Object.keys(parsed).slice(0,12):[]
    }
    results.push({mode:q.mode,httpStatus:response.status,
      state:response.ok?'reachable':'not-available',count,keys,durationMs:Date.now()-start})
  }catch(e){
    results.push({mode:q.mode,state:'network-error',error:e instanceof Error?e.message.slice(0,130):'Unknown',durationMs:Date.now()-start})
  }
}
console.log(JSON.stringify({source:'ESPN Core API (unofficial)',checkedAt:new Date().toISOString(),results,
  note:'Availability is per route/event/year. HTTP 200 or count>0 does not verify bookmaker offers, price freshness, betting authorization or unlimited access.'},null,2))
