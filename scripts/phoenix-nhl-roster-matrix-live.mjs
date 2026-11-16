/** All 32 NHL rosters, official season stats and cautious ESPN injury reports.
 * Outputs per-player evidence, source URLs, missingness, not betting advice.
 * Run: node --experimental-strip-types scripts/phoenix-nhl-roster-matrix-live.mjs
 */
import {writeFile} from 'node:fs/promises'
import {buildNhlFullRosterAudit,reconcileNhlRosterAvailability}
  from '../packages/core/tool-sports/src/nhl-roster-integrity.ts'
const clubs=Object.entries({
  ANA:'Anaheim Ducks',BOS:'Boston Bruins',BUF:'Buffalo Sabres',
  CGY:'Calgary Flames',CAR:'Carolina Hurricanes',CHI:'Chicago Blackhawks',
  COL:'Colorado Avalanche',CBJ:'Columbus Blue Jackets',DAL:'Dallas Stars',
  DET:'Detroit Red Wings',EDM:'Edmonton Oilers',FLA:'Florida Panthers',
  LAK:'Los Angeles Kings',MIN:'Minnesota Wild',MTL:'Montreal Canadiens',
  NJD:'New Jersey Devils',NSH:'Nashville Predators',NYI:'New York Islanders',
  NYR:'New York Rangers',OTT:'Ottawa Senators',PHI:'Philadelphia Flyers',
  PIT:'Pittsburgh Penguins',SEA:'Seattle Kraken',SJS:'San Jose Sharks',
  STL:'St. Louis Blues',TBL:'Tampa Bay Lightning',TOR:'Toronto Maple Leafs',
  UTA:'Utah Mammoth',VAN:'Vancouver Canucks',VGK:'Vegas Golden Knights',
  WPG:'Winnipeg Jets',WSH:'Washington Capitals',
})
const now=Date.now(),clock=new Date(now).toISOString()
const utc=new Date(now),year=utc.getUTCFullYear(),
  start=utc.getUTCMonth()>=6?year:year-1
const season=String(start)+String(start+1),urlBase='https://api-web.nhle.com/v1/'
const espn='https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries'
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const object=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{}
const arr=x=>Array.isArray(x)?x:[]
// NHL limits burst traffic. Across the entire 32-team scan, reserve one
// NHL HTTP slot every 1.5 seconds, including retries and both endpoint types.
// ESPN has its own host and is not bound to the NHL request calendar.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let nextNhlSlot=Date.now()
async function scheduledNhlRequest(url){
  if(!url.startsWith(urlBase))return
  const slot=Math.max(Date.now(),nextNhlSlot)
  nextNhlSlot=slot+1_500
  await sleep(Math.max(0,slot-Date.now()))
}
const read=async url=>{
  const t=Date.now()
  let last={url,http:null,data:null,ok:false,
    error:'No response obtained',elapsedMs:0}
  for(let attempt=1;attempt<=4;attempt++){
    await scheduledNhlRequest(url)
    try{
      const r=await fetch(url,{headers:{accept:'application/json'},
        signal:AbortSignal.timeout(9000),redirect:'error'})
      if(r.status===429){
        const retryHeader=r.headers.get('retry-after')??''
        const retrySeconds=Number(retryHeader)
        const backoff=Number.isFinite(retrySeconds)&&retrySeconds>0?
          Math.min(90_000,retrySeconds*1000):Math.min(75_000,15_000*attempt)
        last={url,http:429,data:null,ok:false,attempt,
          error:'NHL rate limited HTTP 429, waiting for retry',
          elapsedMs:Date.now()-t}
        if(attempt<4){await sleep(backoff);continue}
        return last
      }
      const json=r.ok?await r.json():null
      const result={url,http:r.status,data:json,ok:r.ok&&!!json,
        attempt,elapsedMs:Date.now()-t}
      if(r.status>=500&&attempt<4){
        await sleep(Math.min(20_000,2000*attempt))
        continue
      }
      return result
    }catch(e){
      last={url,http:null,data:null,ok:false,attempt,
        error:String(e?.message??e).slice(0,180),
        elapsedMs:Date.now()-t}
      if(attempt<4){await sleep(1500*attempt);continue}
    }
  }
  return last
}
const leagueFeed=await read(espn)
const injuryGroups=arr(object(leagueFeed.data).injuries).map(object)
const timestamp=String(object(leagueFeed.data).timestamp??'')
const published=Date.parse(timestamp)
const feedFresh=leagueFeed.ok&&Number.isFinite(published)&&
  published<=now+15*60_000&&now-published<=36*60*60_000
const captures=new Array(clubs.length)
let cursor=0
await Promise.all(Array.from({length:2},async()=>{
  while(cursor<clubs.length){
    const i=cursor++,[code,name]=clubs[i]
    const rosterUrl=urlBase+'roster/'+code+'/'+season
    const statUrl=urlBase+'club-stats/'+code+'/'+season+'/2'
    const [roster,stats]=await Promise.all([read(rosterUrl),read(statUrl)])
    const people=[]
    for(const [field,role]of [
      ['forwards','forward'],['defensemen','defense'],['goalies','goalie']
    ]){
      for(const entry of arr(object(roster.data)[field])){
        const p=object(entry),id=String(p.id??'')
        const first=object(p.firstName).default??p.firstName??''
        const last=object(p.lastName).default??p.lastName??''
        const full=[first,last].join(' ').trim()
        if(!/^\d{5,18}$/u.test(id)||!full)continue
        people.push({id,team:code,name:full,role,stats:{},
          last5:[],starterConfirmed:false,idProvider:'NHL'})
      }
    }
    const unique=[...new Map(people.map(p=>[p.id,p])).values()]
    const teamGroup=injuryGroups.find(g=>norm(g.displayName??g.name)===norm(name))
    const reports=arr(teamGroup?.injuries).map(raw=>{
      const x=object(raw),athlete=object(x.athlete),
        detail=object(x.details)
      return{team:name,athlete:String(athlete.displayName??athlete.fullName??''),
        athleteId:athlete.id?String(athlete.id):null,
        status:String(x.status??object(x.type).description??'Unknown'),
        reportedAt:x.date??x.updatedAt??null,
        details:String(detail.type??detail.detail??x.shortComment??''),
        returnDate:detail.returnDate??null,
        source:espn}
    }).filter(x=>x.athlete)
    const backup=feedFresh?{
      status:teamGroup?'partial':'unavailable',league:'nhl',checkedAt:clock,
      feedUpdatedAt:timestamp,source:espn,officialSource:null,notes:[],
      home:{name,matched:!!teamGroup,injuries:reports},
      away:{name:'unmatched',matched:false,injuries:[]},
    }:null
    const base=buildNhlFullRosterAudit({home:unique,away:[]},
      {home:stats.data,away:null},null,now)
    const audit=reconcileNhlRosterAvailability(base,backup,now,
      new Date(now+36*60*60_000).toISOString()).home
    captures[i]={team:code,name,season,rosterUrl,statsUrl:statUrl,
      rosterHttp:roster.http,statsHttp:stats.http,
      rosterError:roster.error??null,statsError:stats.error??null,
      count:audit.count,statCoveragePct:audit.statCoveragePct,
      matchedStats:audit.matchedStats,
      missingSeasonStats:audit.missingSeasonStats,
      injured:audit.players.filter(p=>p.availability==='reported-out'||
        p.availability==='reported-injured-reserve').map(p=>({
          name:p.name,role:p.role,status:p.availability,
          published:p.availabilityPublishedAt,
          impactIfAbsent:p.impactIfAbsent,source:p.availabilitySource,
        })),
      questionable:audit.players.filter(p=>[
        'reported-questionable','reported-doubtful','reported-day-to-day'
      ].includes(p.availability)).map(p=>({
        name:p.name,status:p.availability,
        published:p.availabilityPublishedAt,
        impactIfAbsent:p.impactIfAbsent,source:p.availabilitySource,
      })),
      unmatchedInjuryReports:audit.unmatchedInjuries,
      players:audit.players,
    }
  }
}))
const teams=captures.filter(x=>x.rosterHttp===200&&x.count>0).length
const statTeams=captures.filter(x=>x.statsHttp===200&&x.matchedStats>0).length
const players=captures.reduce((n,x)=>n+x.count,0)
const matched=captures.reduce((n,x)=>n+x.matchedStats,0)
const report={checkedAt:clock,season,teamsExpected:clubs.length,
  teamsWithRoster:teams,teamsWithSomeStats:statTeams,
  players,playersWithStats:matched,
  percentPlayersWithStats:players?Number((matched/players*100).toFixed(2)):0,
  injuryFeed:{url:espn,http:leagueFeed.http,publishedAt:feedFresh?timestamp:null,
    fresh:feedFresh,
    note:'No injury record is NOT proof of a healthy player; ESPN is secondary.'},
  teams:captures,
  note:'Captured on live date. Cannot reconstruct earlier decisions using this snapshot.'}
await writeFile('phoenix-nhl-full-roster-matrix.json',JSON.stringify(report,null,2))
await writeFile('phoenix-nhl-full-roster-matrix.md',
  '# NHL league roster coverage · '+clock+'\n\n'+
  '|Club|Roster|Season stats|Coverage|Reported out|Questionable|\n'+
  '|---|---:|---:|---:|---:|---:|\n'+
  captures.map(x=>'|'+x.team+'|'+x.count+'|'+x.matchedStats+'|'+
    x.statCoveragePct+'%|'+x.injured.length+'|'+x.questionable.length+'|').join('\n')+
  '\n\nRaw by-player values, source status and time stamps are in JSON.\n')
console.log('NHL_ROSTER_MATRIX '+JSON.stringify({
  capturedAt:clock,season,teamRosters:teams,statTeams,
  players,playersWithStats:matched,percentPlayersWithStats:report.percentPlayersWithStats,
  injuryFeed:{http:leagueFeed.http,fresh:feedFresh},
  failures:captures.filter(x=>!x.count||!x.matchedStats)
    .map(x=>({club:x.team,rosterHttp:x.rosterHttp,
      statHttp:x.statsHttp,players:x.count})),
}))
if(process.env.PHOENIX_NHL_ROSTER_STRICT==='1'&&
  (teams!==clubs.length||statTeams!==clubs.length))process.exitCode=1
