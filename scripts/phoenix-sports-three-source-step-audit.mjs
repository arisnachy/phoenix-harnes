/* PHOENIX 3-source evidence audit. A reachable page is not a validated metric. */
import {writeFile} from 'node:fs/promises'
import {auditDeepProtocol} from '../packages/core/tool-sports/src/sports-original-deep-protocol.ts'
const cases=[['basketball','nba','2026-11-09'],['basketball','wnba','2026-09-12'],
 ['hockey','nhl','2026-11-09'],['baseball','mlb','2026-10-15'],
 ['football','nfl','2026-11-09'],['soccer','eng.1','2026-11-08'],
 ['tennis','atp','2026-11-09']]
const base='https://site.api.espn.com/apis/site/v2/sports/'
const cache=new Map()
async function get(url){
 if(cache.has(url))return cache.get(url)
 const task=(async()=>{
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(7500),redirect:'error',
    headers:{accept:'application/json,text/html;q=0.9,*/*;q=0.8'}})
   if(!response.ok)return {state:'http_error',http:response.status}
   const raw=(await response.text()).slice(0,150000)
   if(/<!doctype html|<html/i.test(raw.slice(0,300)))return {
    state:/captcha|access denied|not a robot|enable javascript/i.test(raw)?
      'anti_bot':'html_only',http:response.status}
   let json
   try{json=JSON.parse(raw)}catch{return {state:'not_json',http:response.status}}
   const keys=json&&typeof json==='object'?Object.keys(json):[]
   return {state:keys.length?'json_present':'empty',http:response.status,
     keys:keys.slice(0,18),sample:raw.slice(0,32000),json}
  }catch(e){return {state:'network_error',reason:String(e?.message??e).slice(0,130)}}
 })()
 cache.set(url,task);return task
}
const ptn=[
 [/espn.*(?:scoreboard|históric|fixture)|scoreboard.*espn/i,'scoreboard'],
 [/espn.*(?:summary|boxscore|pickcenter|lastfive|matchup|leader)/i,'summary'],
 [/espn.*injur/i,'injuries'],[/espn.*roster/i,'roster'],
 [/espn.*(?:team stat|statistics|splits)/i,'stats'],
 [/espn.*(?:athlete|player stat|gamelog)/i,'athlete'],
 [/espn.*(?:core|odds)/i,'odds'],[/espn.*news/i,'news'],
 [/mlb.*(?:schedule|pitcher|calendario)/i,'mlbschedule'],
 [/mlb.*(?:boxscore|lineup)/i,'mlbbox'],
 [/mlb.*(?:stat|roster|splits|logs)/i,'mlbstats'],
 [/nhl.*(?:api|gamecenter|score|calendario)/i,'nhlscore'],
 [/nhl.*(?:stat|power|penalty|goalie)/i,'nhlstats'],
 [/nba.*injur/i,'nbaInj'],[/wnba.*injur/i,'wnbaInj'],
 [/nba.*stat|wnba.*stat/i,'nbaStats'],
 [/nflverse/i,'nflverse'],[/next gen stats/i,'nflnext'],
 [/nfl.*(?:injur|inactive)/i,'nflInj'],
 [/moneypuck/i,'moneypuck'],[/daily faceoff/i,'faceoff'],
 [/baseball savant|statcast/i,'savant'],[/fangraphs/i,'fangraphs'],
 [/american soccer analysis/i,'asa'],[/understat/i,'understat'],
 [/open-meteo/i,'weather'],[/the sportsdb/i,'sportsdb'],
 [/gdel[t]?/i,'gdelt'],[/atp tour|atp official|atp\/wta/i,'atp'],
 [/wta.*(?:official|stat)/i,'wta'],[/match charting/i,'charting'],
 [/tennis abstract/i,'abstract'],[/kickserve/i,'kickserve'],
 [/odds api|odds harvester|juancito/i,'licensedOdds'],
 [/model|backtest|simula|calibrad/i,'localModel']]
async function setup(sport,league,date){
 const root=base+sport+'/'+league+'/'
 const board=await get(root+'scoreboard?dates='+date.replaceAll('-',''))
 const event=board.json?.events?.find(x=>x?.competitions?.[0]?.competitors?.length===2)
 const competitors=event?.competitions?.[0]?.competitors??[]
 const team=competitors.find(x=>x.homeAway==='home')?.team??competitors[0]?.team
 const ctx={sport,league,date,root,id:String(event?.id??''),
  cid:String(event?.competitions?.[0]?.id??event?.id??''),teamId:String(team?.id??''),gameId:''}
 if(sport==='hockey'){
  const answer=await get('https://api-web.nhle.com/v1/score/'+date)
  ctx.gameId=String(answer.json?.games?.[0]?.id??'')
 }
 if(sport==='baseball'){
  const answer=await get('https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date)
  ctx.gameId=String(answer.json?.dates?.[0]?.games?.[0]?.gamePk??'')
 }
 return ctx
}
function endpoint(label,c){
 const key=ptn.find(x=>x[0].test(label))?.[1]??'unmapped'
 const day=c.date.replaceAll('-',''),team=c.teamId?c.root+'teams/'+c.teamId:null
 const paths={
  scoreboard:c.root+'scoreboard?dates='+day,
  summary:c.id?c.root+'summary?event='+c.id:null,
  injuries:c.root+'injuries',
  roster:team?team+'/roster':null,stats:team?team+'/statistics':null,
  athlete:null, // must resolve a real athlete ID from the team's roster
  odds:c.id?'https://sports.core.api.espn.com/v2/sports/'+c.sport+
    '/leagues/'+c.league+'/events/'+c.id+'/competitions/'+c.cid+'/odds':null,
  news:c.root+'news?limit=10',
  mlbschedule:'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+c.date+
    '&hydrate=probablePitcher',
  mlbbox:c.gameId?'https://statsapi.mlb.com/api/v1/game/'+c.gameId+'/boxscore':null,
  mlbstats:'https://statsapi.mlb.com/api/v1/teams/119/stats?stats=season&group=hitting&season=2026',
  nhlscore:'https://api-web.nhle.com/v1/score/'+c.date,
  nhlstats:'https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=seasonId=20262027',
  nbaInj:'https://official.nba.com/nba-injury-report-2026-27-season/',
  wnbaInj:'https://www.wnba.com/wnba-injury-report',
  nbaStats:'https://stats.nba.com/stats/leaguedashteamstats?LeagueID=00&Season=2026-27&SeasonType=Regular%20Season',
  nflverse:'https://github.com/nflverse/nflverse-data/releases',
  nflnext:'https://nextgenstats.nfl.com/',nflInj:'https://www.nfl.com/injuries/',
  moneypuck:'https://moneypuck.com/data.htm',
  faceoff:'https://www.dailyfaceoff.com/starting-goalies',
  savant:'https://baseballsavant.mlb.com/leaderboard/expected_statistics?year=2026',
  fangraphs:'https://www.fangraphs.com/leaders/major-league',
  asa:'https://app.americansocceranalysis.com/api/v1/mls/teams/xgoals?season_name=2026',
  understat:'https://understat.com/league/EPL',
  weather:null, // requires venue coords; an arbitrary weather URL is invalid
  sportsdb:'https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d='+c.date+
    '&s='+encodeURIComponent({basketball:'Basketball',hockey:'Ice Hockey',
      baseball:'Baseball',football:'American Football',soccer:'Soccer',tennis:'Tennis'}[c.sport]),
  gdelt:'https://api.gdeltproject.org/api/v2/doc/doc?query='+encodeURIComponent(c.league+' sports')+
    '&mode=artlist&format=json&maxrecords=5',
  atp:'https://www.atptour.com/en/stats',wta:'https://www.wtatennis.com/stats',
  charting:'https://raw.githubusercontent.com/JeffSackmann/tennis_MatchChartingProject/master/charting-m-matches.csv',
  abstract:'https://www.tennisabstract.com/',kickserve:'https://kick-serve.com/data/',
  licensedOdds:null,localModel:null,unmapped:null
 }
 return{provider:key,url:paths[key]??null}
}
const contexts=await Promise.all(cases.map(x=>setup(...x)))
const steps=[]
for(const ctx of contexts){
 for(const row of auditDeepProtocol(ctx.sport,{})){
  const sourceNames=row.sources.slice(0,3)
  while(sourceNames.length<3)sourceNames.push('SIN TERCER RESPALDO INDEPENDIENTE ACREDITADO')
  steps.push({sport:ctx.sport,league:ctx.league,step:row.key,title:row.title,
    providers:sourceNames.map((name,index)=>({rank:index+1,name,...endpoint(name,ctx)}))})
 }
}
const urls=[...new Set(steps.flatMap(x=>x.providers.map(p=>p.url)).filter(Boolean))]
let next=0
await Promise.all(Array.from({length:5},async()=>{
 while(next<urls.length){const i=next++;await get(urls[i])}
}))
for(const row of steps)for(const s of row.providers){
 const a=s.url?await get(s.url):{state:'unverified_source',
  reason:'No se identificó URL ejecutable y compatible con este paso'}
 s.status=a.state;s.http=a.http??null;s.keys=a.keys??[]
 // Never mark the WHOLE step as verified from an HTTP 200.
 const rule=row.step==='B04'?/offensiveRating|defensiveRating|netRating|pace/i:
   row.step==='B08'?/athlete|injur|out|questionable/i:
   row.step==='H05'?/expectedGoals|xg|corsi/i:
   row.step==='M04'?/era|whip|fip|pitcher/i:
   row.step==='N03'?/epa|successRate/i:
   row.step==='S04'?/xg|expectedGoals/i:
   row.step==='T04'?/aces|firstServe|doubleFault/i:
   row.step==='U09'?/moneyLine|moneyline|odds|provider/i:null
 s.relevantFieldSeen=Boolean(a.state==='json_present'&&rule?.test(a.sample??''))
 s.stepVerified=false
 delete s.provider // preserve provider name from label; source host in URL
}
const counts={}
for(const row of steps)for(const p of row.providers)counts[p.status]=(counts[p.status]??0)+1
const data={checkedAt:new Date().toISOString(),steps:steps.length,
 sources:steps.length*3,uniqueURLs:urls.length,counts,rows:steps,
  warning:'The presence of a field does NOT validate complete statistics, both rivals or timestamps'}
await writeFile('phoenix-3-source-step-audit.json',JSON.stringify(data,null,2))
let md='# PHOENIX · tres fuentes por paso; prueba HTTP real con evidencia\n\n'
md+='Corte '+data.checkedAt+'. '+data.steps+' pasos por 7 casos (NBA, WNBA, NHL, MLB, NFL, fútbol, tenis); '+
 data.sources+' posiciones y '+urls.length+' URLs únicas. Ningún paso se certifica únicamente con HTTP200.\n\n'
for(const ctx of contexts){
 md+='## '+ctx.sport+'/'+ctx.league+'\\n\\n| Paso | Investigación | Principal | Respaldo 1 | Respaldo 2 |\\n|---|---|---|---|---|\\n'
 for(const row of steps.filter(x=>x.league===ctx.league)){
  const col=row.providers.map(p=>(p.url?'['+p.name+']('+p.url+')':p.name)+
    ': '+p.status+(p.http?' HTTP '+p.http:'')+
    (p.relevantFieldSeen?' (campo localizado, no prueba completa)':'')).map(t=>t.replaceAll('|','/'))
  md+='| '+row.step+' | '+row.title.replaceAll('|','/')+' | '+col.join(' | ')+' |\\n'
 }
 md+='\\n'
}
md+='\\n**Criterio de aceptación:** cada indicador necesita los valores exigidos de ambos rivales, identidades, muestra temporal, fuente, actualización y comprobación de redundancia. HTML, JSON sin campos o una ruta alternativa listada no acreditan dato. Los modelos locales y mercados de casa no tienen tres APIs públicas universales; se registran sin inventarlas.\\n'
await writeFile('phoenix-3-source-step-audit.md',md)
console.log('PHOENIX_STEP_THREE_SOURCE_SUMMARY '+JSON.stringify({
 steps:data.steps,sourceSlots:data.sources,uniqueURLs:urls.length,counts,
 examples:steps.filter(x=>x.league==='nba'&&['B04','B07','B08','B12'].includes(x.step))}))
