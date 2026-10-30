#!/usr/bin/env node
/** Bounded, read-only ESPN transport probe. ESPN endpoints are undocumented;
 * successful HTTP responses are observations, NOT proof of live wagerability.
 */
import {espnCoreUrl} from '../packages/core/tool-sports/src/espn-core-intelligence.ts'

const core={sport:'football',league:'nfl'}
const localDay=new Intl.DateTimeFormat('en-CA',{
  timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit',
}).format(new Date()).replaceAll('-','')
const probes=[
  {label:'MLB reference shared by user',url:espnCoreUrl({
    sport:'baseball',league:'mlb',mode:'odds',
    eventId:'401809303',competitionId:'401809303',limit:25,
  })},
  {label:'MLB reference event summary',url:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=401809303'},
  {label:'NBA scoreboard today',url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+localDay},
  {label:'NHL scoreboard today',url:'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates='+localDay},
  {label:'NFL old reference',url:espnCoreUrl({...core,mode:'odds',eventId:'401220181',competitionId:'401220181'})},
  {label:'NFL ATS',url:espnCoreUrl({...core,mode:'ats',season:2026,teamId:'1',seasonType:2})},
  {label:'NFL futures',url:espnCoreUrl({...core,mode:'futures',season:2026})},
  {label:'NFL past performances',url:espnCoreUrl({...core,mode:'past_performances',teamId:'1',providerId:'41',limit:2})},
]
const results=[]
for(const {label,url} of probes){
  const start=Date.now()
  try{
    const response=await fetch(url,{
      headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6500),
    })
    const result={label,httpStatus:response.status,
      state:response.ok?'reachable':'not-available',durationMs:Date.now()-start}
    if(response.ok){
      const raw=await response.text()
      if(raw.length>2_000_000)throw Error('Respuesta supera 2 MB')
      const parsed=JSON.parse(raw)
      const items=Array.isArray(parsed?.items)?parsed.items:[]
      const events=Array.isArray(parsed?.events)?parsed.events:[]
      const event=parsed?.header?.competitions?.[0]
      if(event){
        result.eventDate=typeof event.date==='string'?event.date:null
        result.eventState=event.status?.type?.state??'unverified'
      }
      result.itemCount=typeof parsed?.count==='number'?parsed.count:items.length
      result.eventCount=events.length
      result.embeddedOddsEntries=events.reduce((sum,event)=>sum+
        (Array.isArray(event?.competitions?.[0]?.odds)
          ?event.competitions[0].odds.length:0),0)
      result.providers=[...new Set(items
        .map(item=>item?.provider?.name).filter(p=>typeof p==='string'))].slice(0,8)
      result.sampleFields=items[0]&&typeof items[0]==='object'
        ?Object.keys(items[0]).slice(0,15):[]
      result.resolvedRefCandidates=items.filter(x=>typeof x?.$ref==='string').length
    }
    results.push(result)
  }catch(e){
    results.push({label,state:'network-error',
      error:e instanceof Error?e.message.slice(0,130):'Unknown',
      durationMs:Date.now()-start})
  }
}
console.log(JSON.stringify({source:'ESPN Site/Core (undocumented)',checkedAt:new Date().toISOString(),
  localDay,results,note:'HTTP 200 and count>0 confirm endpoint data exists, not that its odds are current, published for NBA/NHL, or eligible for betting. A failed old NFL ID is not a global ESPN outage.'},null,2))
