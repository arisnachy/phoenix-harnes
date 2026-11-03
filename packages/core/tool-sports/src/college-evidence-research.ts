/** Distinct NCAA Football and Men's Basketball research: identities, roster and evidence.
 * Football is 4 x 15 minutes; NCAA men's basketball is 2 x 20.
 * Depth charts/rosters NEVER prove starting units; odds NEVER imply edge.
 */
import {getFeed,hasSportsPermission,type MarketOutcome} from './sports.ts'
import {collectDirectEspnStats} from './sports-direct-stats.ts'
type R=Record<string,unknown>
const o=(v:unknown):R=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as R:{}
const a=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const w=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v).slice(0,120):''
const id=(v:unknown)=>/^\d{1,18}$/u.test(String(v??''))?String(v):''
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
  .replace(/[^a-z0-9]/gu,'')
const dateOk=(v:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export type CollegeLeague='college-football'|'mens-college-basketball'
export type CollegeGame={league:CollegeLeague;eventId:string;start:string;
  status:'pre'|'in'|'post'|'unknown';
  home:{id:string;name:string};away:{id:string;name:string};venue:string}
export type CollegeSource={url:string;status:'observed'|'error';at:string;error?:string}
export type CollegePlayer={id:string;name:string;teamId:string;position:string;
  confirmedStarter:boolean;unit:'offense'|'defense'|'basketball'|'unknown';
  metrics:Array<{name:string;value:string}>}
export const collegeSpec=(league:CollegeLeague)=>{
  if(league==='college-football')return{sport:'football',book:'americanfootball_ncaaf',
    minutes:60,format:'4 × 15 min',starters:'11 ataque + 11 defensa'}
  if(league==='mens-college-basketball')return{sport:'basketball',book:'basketball_ncaab',
    minutes:40,format:'2 × 20 min',starters:'5 titulares'}
  throw Error('Liga NCAA inválida')
}
async function read<T>(url:string,fetcher:typeof fetch,log:CollegeSource[],now:number){
  try{const data=await getFeed<T>(url,fetcher)
    log.push({url,status:'observed',at:new Date(now).toISOString()});return data}
  catch(e){log.push({url,status:'error',at:new Date(now).toISOString(),
    error:e instanceof Error?e.message.slice(0,100):'Error de fuente'});return null}
}
const parse=(raw:unknown,league:CollegeLeague):CollegeGame|null=>{
  const e=o(raw),c=o(a(e.competitions)[0]),teams=a(c.competitors).map(o)
  const find=(side:string)=>{
    const comp=teams.find(t=>t.homeAway===side),t=o(comp?.team)
    const x=id(t.id),name=w(t.displayName??t.name)
    return x&&name?{id:x,name}:null}
  const home=find('home'),away=find('away'),eventId=id(e.id)
  const start=w(e.date),state=w(o(o(e.status).type).state)
  if(!eventId||!home||!away||!Number.isFinite(Date.parse(start)))return null
  return{league,eventId,start,home,away,
    status:state==='pre'?'pre':state==='in'?'in':state==='post'?'post':'unknown',
    venue:w(o(c.venue).fullName)||'Sede sin verificar'}
}
export async function collegeSlate(league:CollegeLeague,date:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env){
  const spec=collegeSpec(league)
  if(!dateOk(date))throw Error('Fecha NCAA inválida')
  if(!hasSportsPermission('espn',env))throw Error('ESPN no autorizado')
  const sources:CollegeSource[]=[]
  const root='https://site.api.espn.com/apis/site/v2/sports/'+spec.sport+'/'+league+'/'
  const data=await read<unknown>(root+'scoreboard?dates='+date.replaceAll('-',''),
    fetcher,sources,now)
  const matches=a(o(data).events).flatMap(x=>{const v=parse(x,league);return v?[v]:[]})
  return{league,date,games:[...new Map(matches.map(x=>[x.eventId,x])).values()],
    sources,noGamesReported:!!data&&!matches.length}
}
function roster(raw:unknown,teamId:string):CollegePlayer[]{
  const rows=a(o(raw).athletes).flatMap(v=>{
    const nested=a(o(v).items);return nested.length?nested:[v]})
  const out=new Map<string,CollegePlayer>()
  for(const row of rows){
    const r=o(row),person=Object.keys(o(r.athlete)).length?o(r.athlete):r
    const playerId=id(person.id??r.id),name=w(person.displayName??person.fullName??person.name)
    const actualId=id(o(r.team).id??r.teamId)
    if(!playerId||!name||(actualId&&actualId!==teamId))continue
    out.set(playerId,{id:playerId,name,teamId,position:w(o(person.position).abbreviation),
      confirmedStarter:false,unit:'unknown',metrics:[]})
  }
  return[...out.values()].slice(0,90)
}
function starters(summary:unknown,teamId:string,league:CollegeLeague,
  people:CollegePlayer[]){
  const r=o(summary),box=o(r.boxscore)
  const team=[...a(r.rosters),...a(r.lineups),...a(box.players)].map(o)
    .find(v=>id(o(v.team).id)===teamId)
  if(!team)return
  const byUnit=new Map<string,string[]>()
  for(const x of a(team.roster??team.players??team.athletes)){
    const p=o(x),pid=id(o(p.athlete).id??p.id)
    if((p.starter!==true&&p.isStarter!==true&&p.starting!==true)||
      !people.some(y=>y.id===pid))continue
    const unit=league==='college-football'?w(p.unit??p.sideOfBall).toLowerCase():'basketball'
    byUnit.set(unit,[...(byUnit.get(unit)??[]),pid])
  }
  for(const [unit,count] of (league==='college-football'?
    [['offense',11],['defense',11]]:[['basketball',5]]) as Array<[string,number]>){
    const chosen=[...new Set(byUnit.get(unit)??[])]
    if(chosen.length!==count)continue
    for(const p of people)if(chosen.includes(p.id)){
      p.confirmedStarter=true;p.unit=unit as CollegePlayer['unit']}
  }
}
export async function collegeInvestigate(league:CollegeLeague,date:string,eventId:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[]){
  const spec=collegeSpec(league)
  if(!id(eventId))throw Error('ID NCAA inválido')
  const board=await collegeSlate(league,date,fetcher,now,env)
  const event=board.games.find(e=>e.eventId===eventId)
  if(!event)throw Error('Evento no identificado en cartelera NCAA')
  if(event.status!=='pre'||Date.parse(event.start)<=now)
    throw Error('Investigación pregame exige encuentro futuro')
  const sources=board.sources
  const root='https://site.api.espn.com/apis/site/v2/sports/'+spec.sport+'/'+league+'/'
  const [summary,rosterHome,rosterAway,injuryInfo,details]=await Promise.all([
    read<unknown>(root+'summary?event='+eventId,fetcher,sources,now),
    read<unknown>(root+'teams/'+event.home.id+'/roster',fetcher,sources,now),
    read<unknown>(root+'teams/'+event.away.id+'/roster',fetcher,sources,now),
    read<unknown>(root+'injuries',fetcher,sources,now),
    collectDirectEspnStats(spec.sport,league,[event.home,event.away],fetcher,now,12),
  ])
  const build=(side:'home'|'away')=>{
    const team=event[side],raw=side==='home'?rosterHome:rosterAway
    const full=roster(raw,team.id),deep=details.teams.find(t=>t.id===team.id)
    // A missing roster must not be rebuilt from cached or loosely named athletes.
    const metrics=new Map((deep?.athletes??[]).map(v=>[v.id,v.stats]))
    for(const p of full)p.metrics=metrics.get(p.id)??[]
    starters(summary,team.id,league,full)
    return{...team,players:full,stats:deep?.stats??[],
      verifiedStarters:full.filter(p=>p.confirmedStarter).length}
  }
  const teams={home:build('home'),away:build('away')}
  const injuries=a(o(injuryInfo).injuries).flatMap(v=>{
    const x=o(v),teamId=id(o(x.team).id??x.id)
    const side=teamId===teams.home.id?teams.home:teamId===teams.away.id?teams.away:null
    if(!side)return []
    return a(x.injuries??x.items).flatMap(y=>{
      const r=o(y),pid=id(o(r.athlete).id??r.athleteId)
      const person=side.players.find(p=>p.id===pid)
      return person&&w(r.status??r.description)?
        [{teamId,playerId:pid,name:person.name,status:w(r.status??r.description)}]:[]
    })
  })
  const market=quotes.filter(q=>{
    const time=Date.parse(q.timeIso??q.time),updated=Date.parse(q.updatedAt)
    return q.sportKey===spec.book&&norm(q.home)===norm(event.home.name)&&
      norm(q.away)===norm(event.away.name)&&Number.isFinite(time)&&
      Math.abs(time-Date.parse(event.start))<3_600_000&&Number.isFinite(updated)&&
      updated<=now&&now-updated<=3_600_000&&q.price>1&&Number.isFinite(q.price)&&
      !!q.bookmaker.trim()
  }).slice(0,25).map(q=>({bookmaker:q.bookmaker,market:q.market,
    selection:q.selection,point:q.point??null,price:q.price,
    updatedAt:q.updatedAt,eligibleForTicket:false as const}))
  const required=league==='college-football'?22:5
  const missing=[
    ...(['home','away'] as const).flatMap(side=>{
      const t=teams[side]
      return[...(t.players.length===0?['Roster '+t.name+' sin verificar']:[]),
        ...(t.verifiedStarters!==required?
          ['Titulares '+t.name+' sin confirmar ('+t.verifiedStarters+'/'+required+')']:[])]
    }),
    'Estado oficial de lesiones, transfer portal, elegibilidad e inactivos no cruzado',
    'Matchups individuales, descanso, forma, ritmo y eficiencia ajustada sin fuente suficiente',
    'Reglamento NCAA de prórroga y condiciones de cada casa sin verificar',
    'Sin probabilidad ni ventaja numérica auditada fuera de muestra',
  ]
  const uiBlock={component:'sports_espn_dashboard' as const,version:1 as const,
    props:{view:'event' as const,title:'PHOENIX NCAA · '+event.away.name+' vs '+event.home.name,
      subtitle:spec.format+' · '+spec.starters,source:'ESPN NCAA',
      checkedAt:new Date(now).toISOString(),
      sections:[
        {heading:'Plantillas y titulares',kind:'list' as const,items:[
          ...teams.home.players.slice(0,15),...teams.away.players.slice(0,15)]
          .map(p=>({label:p.name,value:p.position+(p.confirmedStarter?
            ' · titular confirmado':' · roster, no confirmado')}))},
        {heading:'Cuotas observadas',kind:'list' as const,items:market.map(q=>({
          label:q.bookmaker+' · '+q.selection,value:q.price.toFixed(2)}))},
        {heading:'Evidencia pendiente',kind:'list' as const,items:missing.map(m=>({
          label:m,value:'Por verificar'}))},
      ],
      note:'NCAA no reutiliza reglas NFL/NBA. Roster no confirma titulares ni cuotas rentables.'}}
  return{league,event,checkedAt:new Date(now).toISOString(),teams,injuries,
    markets:market,missingEvidence:missing,sources,uiBlock,
    opportunity:{sport:spec.sport,league,eventId,eligibleForTicket:false as const,
      calibratedProbability:false as const,decision:teams.home.players.length>=required&&
        teams.away.players.length>=required?'investigate' as const:'abstain' as const}}
}
