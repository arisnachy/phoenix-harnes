/** Live read-only inventory of the actual ESPN route families used by PHOENIX.
 * All outcomes, including 404, empty data and challenges, are recorded.
 * Does not assert a bookmaker price when a web page merely displays odds.
 */
import {writeFile} from 'node:fs/promises'
const now=new Date(),date=now.toISOString().slice(0,10),day=date.replaceAll('-','')
const site='https://site.api.espn.com/apis/site/v2/sports/'
const core='https://sports.core.api.espn.com/v2/sports/'
const web='https://site.web.api.espn.com/apis/common/v3/sports/'
const leagues=[
 ['basketball','nba','20261109'],['basketball','wnba','20260912'],
 ['football','nfl','20261108'],['baseball','mlb','20261015'],
 ['hockey','nhl','20261109'],['soccer','eng.1','20261108'],
 ['soccer','esp.1','20261108'],['soccer','usa.1','20261108'],
 ['soccer','mex.1','20261108'],['soccer','uefa.champions','20261104'],
 ['soccer','ita.1','20261108'],['soccer','ger.1','20261108'],
 ['soccer','fra.1','20261108'],['soccer','por.1','20261108'],
 ['soccer','ned.1','20261108'],['soccer','bra.1','20261108'],
 ['soccer','arg.1','20261108'],['soccer','uefa.europa','20261105'],
 ['soccer','fifa.world','20260620'],['basketball','mens-college-basketball','20261109'],
 ['football','college-football','20261107'],
]
const coreLeagues=new Set(['basketball/nba','basketball/wnba','football/nfl',
 'baseball/mlb','hockey/nhl','soccer/eng.1'])
const injuries=new Set(['basketball/nba','basketball/wnba',
 'football/nfl','baseball/mlb','hockey/nhl'])
const tests=[],results=[],payloads=new Map()
const add=(sport,league,step,url,shape,sample=false)=>{
 tests.push({sport,league,step,url,shape,sample})
}
for(const [sport,league,history] of leagues){
 const root=site+sport+'/'+league+'/',id=sport+'/'+league
 add(sport,league,'cartelera',''+root+'scoreboard?dates='+day,'events')
 if(coreLeagues.has(id)){
   add(sport,league,'cartelera_histórica_prueba',root+'scoreboard?dates='+history,'events',true)
   add(sport,league,'plantillas_equipos',root+'teams','sports')
   add(sport,league,'noticias',root+'news?limit=8','articles')
   add(sport,league,'clasificacion',
     'https://site.api.espn.com/apis/v2/sports/'+sport+'/'+league+'/standings','children')
 }
 if(injuries.has(id))add(sport,league,'lesiones_espn',root+'injuries','injuries')
}
add('hockey','nhl','nhl_oficial','https://api-web.nhle.com/v1/score/'+date,'games')
add('baseball','mlb','mlb_oficial','https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date,'dates')
add('basketball','nba','nba_cdn','https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json','scoreboard')
add('basketball','nba','nba_lesiones_oficial_indice',
 'https://official.nba.com/nba-injury-report-2026-27-season/','html')
add('basketball','nba','espn_web_odds',
 'https://www.espn.com/nba/odds','html')
const err=(e)=>String(e?.message??e).slice(0,240)
async function fetchOne(item){
 const begin=Date.now()
 const output={step:item.step,sport:item.sport,league:item.league,
   url:item.url,sample:!!item.sample,status:'error',http:null,
   items:null,evidence:null,elapsedMs:0,checkedAt:new Date().toISOString()}
 try{
   const response=await fetch(item.url,{
     headers:{accept:'application/json, text/html;q=0.9,*/*;q=0.8',
       'user-agent':'PhoenixSportsSourceAudit/1.0 (read-only quality check)'},
     redirect:'error',signal:AbortSignal.timeout(8500)})
   output.http=response.status
   if(!response.ok){output.status='http_error';output.evidence='HTTP '+response.status;return output}
   if(item.shape==='html'){
     const body=(await response.text()).slice(0,500000)
     const pdfs=[...new Set(body.match(/https?:\/\/[^\s"'<>]+\.pdf/giu)??[])]
     output.items=pdfs.length
     output.status=body.length>500?'available':'empty'
     output.evidence={bytes:body.length,pdfLinks:pdfs.slice(0,4),
       hasOddsWords:/odds|moneyline|betting/iu.test(body)}
     return output
   }
   let data
   try{data=await response.json()}catch{output.status='invalid_json';return output}
   const obj=data&&typeof data==='object'?data:{}
   const val=obj[item.shape]
   if(item.shape==='scoreboard'){
     const games=obj.scoreboard?.games
     output.status=Array.isArray(games)?games.length?'available':'empty':'invalid_schema'
     output.items=Array.isArray(games)?games.length:null
     output.evidence={keys:Object.keys(obj).slice(0,9)}
   }else{
     const valid=Array.isArray(val)
     output.status=!valid?'invalid_schema':val.length?'available':'empty'
     output.items=valid?val.length:null
     output.evidence={keys:Object.keys(obj).slice(0,12)}
   }
   // A structurally valid but empty off-season feed is not an outage.
   if(['events','injuries','articles','sports','children','dates','games','scoreboard','roster','athletes','items'].includes(item.shape)){
     payloads.set(item.url,data)
   }
   if(item.step.includes('cartelera')&&Array.isArray(obj.events)){
     const found=obj.events.slice(0,25)
     output.evidence={...output.evidence,
       eventIds:found.slice(0,3).map(x=>String(x.id??'')),
       gamesWithEmbeddedOdds:found.filter(x=>
         x.competitions?.some(y=>Array.isArray(y.odds)&&y.odds.length>0)).length,
       games:found.length}
   }
   if(item.step.includes('lesiones')&&Array.isArray(obj.injuries))
     output.evidence={...output.evidence,
       sampleKeys:Object.keys(obj.injuries[0]??{}).slice(0,15),
       sampleTeam:obj.injuries[0]?.displayName??obj.injuries[0]?.team?.displayName??null,
       feedTimestamp:obj.timestamp??null}
   if(item.step==='cuotas_core'&&typeof data==='object')
     output.evidence={...output.evidence,
       refCount:obj.count??null,itemsPreview:Array.isArray(obj.items)?obj.items.slice(0,2).map(x=>x.$ref??null):[]}
   return output
 }catch(e){output.evidence=err(e);return output}
 finally{output.elapsedMs=Date.now()-begin}
}
async function runBatch(rows,parallel=4){
 let next=0
 const jobs=Array.from({length:Math.min(parallel,rows.length)},async()=>{
   while(next<rows.length){
     const item=rows[next++],result=await fetchOne(item)
     results.push(result);console.log('SOURCE_AUDIT '+JSON.stringify(result))
   }
 })
 await Promise.all(jobs)
}
await runBatch(tests,5)
// Select event and team identifiers ONLY from the returned ESPN scoreboard.
const followup=[]
for(const [sport,league,history] of leagues){
 const key=sport+'/'+league
 if(!coreLeagues.has(key))continue
 const root=site+sport+'/'+league+'/'
 const b=payloads.get(root+'scoreboard?dates='+day)
 const past=payloads.get(root+'scoreboard?dates='+history)
 const event=(Array.isArray(b?.events)&&b.events.length?b.events:
   Array.isArray(past?.events)?past.events:[]).find(e=>
    /^\d{1,20}$/u.test(String(e.id??''))&&e.competitions?.[0]?.competitors?.length>1)
 if(!event)continue
 const historic=!(b?.events??[]).some(e=>String(e.id)===String(event.id))
 const id=String(event.id),competition=event.competitions[0]
 addFollow('resumen_partido',root+'summary?event='+id,'header')
 addFollow('cuotas_core',core+sport+'/leagues/'+league+'/events/'+id+
   '/competitions/'+String(competition.id??event.id)+'/odds','items')
 for(const player of competition.competitors.slice(0,2)){
   const tid=String(player.team?.id??'')
   if(!/^\d{1,16}$/u.test(tid))continue
   addFollow('plantilla_del_equipo',root+'teams/'+tid+'/roster','athletes')
   addFollow('estadisticas_equipo',root+'teams/'+tid+'/statistics','results')
   addFollow('profundidad',root+'teams/'+tid+'/depthcharts','depthCharts')
   if(injuries.has(key))addFollow('lesiones_equipo',root+'teams/'+tid+'/injuries','injuries')
 }
 function addFollow(step,url,shape){
   followup.push({sport,league,step,url,shape,sample:historic})
 }
}
await runBatch(followup,4)
// Probe at least one real athlete ID from an observed roster.
const athletes=[]
for(const row of followup.filter(x=>x.step==='plantilla_del_equipo')){
 const obj=payloads.get(row.url),players=Array.isArray(obj?.athletes)?obj.athletes:[]
 const candidate=players.find(p=>/^\d{1,16}$/u.test(String(p.id??p.athlete?.id??'')))
 if(!candidate)continue
 const id=String(candidate.id??candidate.athlete?.id)
 const route=web+row.sport+'/'+row.league+'/athletes/'+id+'/'
 for(const step of ['stats','gamelog','splits'])
   athletes.push({...row,step:'jugador_'+step,
     url:route+step,shape:'categories',sample:row.sample})
}
await runBatch(athletes.slice(0,18),4)
const tally={}
for(const row of results){
 tally[row.status]=(tally[row.status]??0)+1
}
const summary={generatedAt:new Date().toISOString(),day,requested:results.length,
 byStatus:tally,criticalFailures:results.filter(r=>r.status==='error'||
  r.status==='http_error'||r.status==='invalid_json'||r.status==='invalid_schema')
  .map(x=>({sport:x.sport,league:x.league,step:x.step,
    url:x.url,http:x.http,evidence:x.evidence})),results}
await writeFile('phoenix-sports-endpoint-audit.json',JSON.stringify(summary,null,2))
console.log('SOURCE_AUDIT_SUMMARY '+JSON.stringify({
 day,total:summary.requested,byStatus:summary.byStatus,
 failed:summary.criticalFailures.length,
 critical:summary.criticalFailures.slice(0,15)}))
// This workflow is diagnostic: nonzero useful endpoints still produce a full
// report, and failures are NOT hidden by a green build label.
