/** PHOENIX NFL research-first dossier — IDs, evidence and pregame gates.
 * No roster is a confirmed starter, no missing stat is zero, no synthetic odds.
 */
import {getFeed,hasSportsPermission,type MarketOutcome} from './sports.ts'
import {collectDirectEspnStats,type DirectTeam} from './sports-direct-stats.ts'
import {discoverEditorialResearch} from './sports-editorial-discovery.ts'
type Row=Record<string,unknown>
const obj=(v:unknown):Row=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const str=(v:unknown,max=120)=>typeof v==='string'||typeof v==='number'?
  String(v).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const id=(v:unknown)=>/^\d{1,18}$/u.test(String(v??''))?String(v):''
const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const num=(v:unknown):number|null=>{
  if(v===null||v===undefined||v==='')return null
  if(typeof v!=='string'&&typeof v!=='number')return null
  const x=Number(v);return Number.isFinite(x)?x:null
}
export const validNflDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(v)&&
  Number.isFinite(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export type NflSource={url:string;checkedAt:string;status:'observed'|'missing'|'error';reason?:string}
export type NflGame={eventId:string;scheduledAt:string;state:'pre'|'in'|'post'|'unknown';
  venue:string;season:string;phase:string;
  home:{id:string;name:string;record:string|null};away:{id:string;name:string;record:string|null}}
export type NflPlayer={id:string;name:string;teamId:string;position:string;
  role:'quarterback'|'receiver'|'running-back'|'offensive-line'|'defense'|'special-teams'|'other';
  confirmedOffense:boolean;confirmedDefense:boolean;
  statistics:Array<{name:string;value:string}>;lastGames:Array<{name:string;value:string}>;
  status:'verified'|'partial'|'unavailable'}
type Result={date:string;opponent:string;pts:number;allowed:number;homeAway:'home'|'away'}
export type NflSide={id:string;name:string;record:string|null;roster:NflPlayer[];
  recent:Result[];wins:number;losses:number;restHours:number|null;
  offenseConfirmed:number;defenseConfirmed:number;
  teamStats:Array<{name:string;value:string}>;sourceCoverage:DirectTeam['coverage']}
export type NflMatchup={attacker:string;attackerId:string;against:string;
  candidates:Array<{id:string;name:string;role:string}>;
  limitations:string[]}
export type NflMarket={bookmaker:string;market:string;selection:string;
  line:number|null;price:number;updatedAt:string;
  contradiction:string;eligibleForTicket:false}
export type NflDossier={
  event:NflGame;checkedAt:string;teams:{home:NflSide;away:NflSide};
  injuries:Array<{teamId:string;name:string;playerId:string;status:string}>;
  matchups:NflMatchup[];news:Array<{title:string;published:string;source:string}>;
  editorial:Array<{title:string;publisher:string;verifiedPick:false}>;
  referee:string|null;weather:{temperatureC:number|null;windKmh:number|null;
    precipitationChance:number|null;timestamp:string}|null;
  markets:NflMarket[];scenarios:string[];missingEvidence:string[];sources:NflSource[];
  coverage:{level:'A'|'B'|'C'|'D';confirmedOffense:number;confirmedDefense:number;
    verifiedPlayers:number;formGames:number;quotedMarkets:number};
  opportunity:{version:1;sport:'football';league:'nfl';eventId:string;
    decision:'investigate'|'abstain';eligibleForTicket:false;calibratedProbability:false;
    forFacts:string[];againstFacts:string[];missingEvidence:string[]};
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{
    view:'event';title:string;subtitle:string;source:string;checkedAt:string;
    sections:Array<{heading:string;kind:'list';items:Array<{label:string;
      value:string;detail?:string}>}>;note:string}}
}
async function read<T>(url:string,fetcher:typeof fetch,sources:NflSource[],now:number):Promise<T|null>{
  try{const v=await getFeed<T>(url,fetcher)
    sources.push({url,checkedAt:new Date(now).toISOString(),status:v==null?'missing':'observed'})
    return v
  }catch(e){sources.push({url,checkedAt:new Date(now).toISOString(),status:'error',
    reason:(e instanceof Error?e.message:'Fuente fallida').slice(0,140)});return null}
}
function parseGame(raw:unknown):NflGame|null{
  const v=obj(raw),comp=obj(arr(v.competitions)[0]),parts=arr(comp.competitors).map(obj)
  const side=(kind:'home'|'away')=>{
    const r=parts.find(p=>p.homeAway===kind),t=obj(r?.team)
    const teamId=id(t.id??r?.id),name=str(t.displayName??t.name,100)
    const record=arr(r?.records).map(x=>str(obj(x).summary,30))
      .find(s=>/^\d+-\d+(?:-\d+)?$/u.test(s))??null
    return teamId&&name?{id:teamId,name,record}:null
  }
  const home=side('home'),away=side('away'),eventId=id(v.id)
  const at=str(v.date??comp.date,45),state=str(obj(obj(v.status).type).state,20)
  if(!home||!away||!eventId||!Number.isFinite(Date.parse(at)))return null
  const season=obj(v.season),venue=obj(comp.venue)
  return{eventId,scheduledAt:at,state:state==='pre'?'pre':state==='in'?'in':
    state==='post'?'post':'unknown',
    venue:str(venue.fullName??venue.name)||'Sede no confirmada',
    season:str(season.year,12)||'Desconocida',
    phase:str(season.type,20)||'Fase no confirmada',home,away}
}
export async function nflSlate(date:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env):
  Promise<{date:string;games:NflGame[];sources:NflSource[];noGamesReported:boolean}>{
  if(!validNflDate(date))throw Error('Fecha NFL inválida')
  if(!hasSportsPermission('espn',env))throw Error('Fuente ESPN deshabilitada')
  const sources:NflSource[]=[]
  const data=await read<{events?:unknown[]}>('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+
    date.replaceAll('-',''),fetcher,sources,now)
  const found=arr(data?.events).flatMap(x=>{const g=parseGame(x);return g?[g]:[]})
  const unique=new Map(found.map(x=>[x.eventId,x]))
  return{date,games:[...unique.values()].sort((x,y)=>x.scheduledAt.localeCompare(y.scheduledAt)),
    sources,noGamesReported:!!data&&!found.length}
}
function positionRole(position:string):NflPlayer['role']{
  const p=position.toUpperCase()
  if(p==='QB')return'quarterback'
  if(['WR','TE'].includes(p))return'receiver'
  if(['RB','HB','FB'].includes(p))return'running-back'
  if(['C','G','OG','OT','T','LT','LG','RG','RT'].includes(p))return'offensive-line'
  if(['DE','DT','NT','DL','LB','OLB','ILB','MLB','CB','S','FS','SS','DB','EDGE'].includes(p))return'defense'
  if(['K','P','LS','KR','PR'].includes(p))return'special-teams'
  return'other'
}
function recentResults(raw:unknown,teamId:string,kickoff:number):Result[]{
  return arr(obj(raw).events).flatMap(ev=>{
    const e=obj(ev),at=Date.parse(str(e.date)),st=obj(obj(e.status).type)
    if(!Number.isFinite(at)||at>=kickoff||(st.state!=='post'&&st.completed!==true))return []
    const ps=arr(obj(arr(e.competitions)[0]).competitors).map(obj)
    const me=ps.find(x=>id(obj(x.team).id)===teamId)
    const opp=ps.find(x=>id(obj(x.team).id)!==teamId)
    const pts=num(me?.score),against=num(opp?.score)
    if(!me||!opp||pts===null||against===null||!['home','away'].includes(str(me.homeAway)))return []
    return[{date:str(e.date,45),opponent:str(obj(opp.team).displayName),
      pts,allowed:against,homeAway:me.homeAway as 'home'|'away'}]
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8)
}
function verifiedRoster(raw:unknown,teamId:string):NflPlayer[]{
  const listed=arr(obj(raw).athletes).flatMap(group=>{
    const r=obj(group),items=arr(r.items)
    return items.length?items:[group]
  })
  const found=new Map<string,NflPlayer>()
  for(const entry of listed){
    const e=obj(entry),p=obj(e.athlete)
    const person=Object.keys(p).length?p:e
    const playerId=id(person.id??e.id)
    const name=str(person.displayName??person.fullName??person.name,110)
    const position=str(obj(person.position).abbreviation??
      obj(person.position).displayName??person.position,36)
    const club=id(obj(e.team).id??e.teamId)
    if(!playerId||!name||(club&&club!==teamId))continue
    found.set(playerId,{id:playerId,name,teamId,position,role:positionRole(position),
      confirmedOffense:false,confirmedDefense:false,statistics:[],lastGames:[],
      status:'unavailable'})
  }
  return[...found.values()].slice(0,70)
}
function confirmStarters(summary:unknown,teamId:string,athletes:NflPlayer[]){
  // Only explicitly labeled offense / defense flags with matched player IDs.
  // A depthchart, position, stats or last game's starter NEVER suffice.
  const root=obj(summary),box=obj(root.boxscore)
  const groups=[...arr(root.rosters),...arr(root.lineups),...arr(box.players)]
  const group=groups.map(obj).find(x=>id(obj(x.team).id)===teamId)
  if(!group)return
  const offense=new Set<string>(),defense=new Set<string>()
  for(const raw of arr(group.roster??group.players??group.athletes)){
    const p=obj(raw),unit=str(p.unit??p.sideOfBall).toLowerCase()
    if(p.starter!==true&&p.isStarter!==true&&p.starting!==true)continue
    const pid=id(obj(p.athlete).id??p.id)
    if(unit==='offense')offense.add(pid)
    else if(unit==='defense')defense.add(pid)
  }
  if(offense.size===11&&athletes.filter(x=>offense.has(x.id)).length===11)
    athletes.forEach(p=>{if(offense.has(p.id))p.confirmedOffense=true})
  if(defense.size===11&&athletes.filter(x=>defense.has(x.id)).length===11)
    athletes.forEach(p=>{if(defense.has(p.id))p.confirmedDefense=true})
}
function potentialMatchups(attack:NflSide,defend:NflSide):NflMatchup[]{
  const defenders=defend.roster.filter(p=>p.role==='defense')
  const offense=attack.roster.filter(p=>
    ['quarterback','receiver','running-back','offensive-line'].includes(p.role))
  return offense.slice(0,24).map(p=>{
    const candidate=defenders.filter(d=>
      p.role==='receiver'?/^(CB|DB|S|FS|SS|LB)$/iu.test(d.position):
      p.role==='quarterback'||p.role==='offensive-line'?
        /^(DL|DE|DT|NT|LB|OLB|EDGE)$/iu.test(d.position):
        /^(DL|DE|DT|NT|LB|ILB|MLB|OLB)$/iu.test(d.position))
    return{attacker:p.name,attackerId:p.id,against:defend.name,
      candidates:candidate.slice(0,12).map(d=>({id:d.id,name:d.name,role:d.position})),
      limitations:['Roster y posición NO confirman starter ni asignación defensiva',
        'Rutas, cobertura y snaps directos requieren fuentes de tracking o gamebook']}
  })
}
function reviewMarkets(game:NflGame,quotes:MarketOutcome[],now:number):NflMarket[]{
  return quotes.filter(q=>{
    const at=Date.parse(q.timeIso??q.time),update=Date.parse(q.updatedAt)
    return q.sportKey==='americanfootball_nfl'&&
      normalize(q.home)===normalize(game.home.name)&&
      normalize(q.away)===normalize(game.away.name)&&
      Number.isFinite(at)&&Math.abs(at-Date.parse(game.scheduledAt))<=3_600_000&&
      Number.isFinite(update)&&update<=now&&now-update<=3_600_000&&
      Number.isFinite(q.price)&&q.price>1&&!!q.bookmaker.trim()
  }).slice(0,30).map(q=>({bookmaker:q.bookmaker,market:q.market,selection:q.selection,
    line:q.point??null,price:q.price,updatedAt:q.updatedAt,
    contradiction:'No hay ventaja calibrada; confirmar QB titular, lesiones, reglas OT/void y cuotas vigentes',
    eligibleForTicket:false as const}))
}
function panel(d:Omit<NflDossier,'uiBlock'>):NflDossier['uiBlock']{
  const sections:NflDossier['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,25)})
  }
  add('Forma y descanso',(['home','away'] as const).map(side=>{
    const team=d.teams[side]
    return{label:team.name,value:team.record??'Récord no verificado',
      detail:team.wins+' V '+team.losses+' D · últimos '+team.recent.length+
        ' · descanso '+(team.restHours===null?'no disponible':team.restHours.toFixed(1)+' horas')}
  }))
  add('QB, corredores y receptores',(['home','away'] as const).flatMap(side=>
    d.teams[side].roster.filter(p=>['quarterback','receiver','running-back'].includes(p.role))
      .slice(0,14).map(p=>({label:d.teams[side].name+' · '+p.name,
        value:p.position+(p.confirmedOffense?' · titular confirmado':' · roster, no confirmado'),
        detail:p.statistics.slice(0,4).map(s=>s.name+': '+s.value).join(' · ')}))))
  add('Defensores y línea ofensiva',(['home','away'] as const).flatMap(side=>
    d.teams[side].roster.filter(p=>['defense','offensive-line'].includes(p.role))
      .slice(0,12).map(p=>({label:p.name,value:p.position+
        (p.confirmedDefense||p.confirmedOffense?' · titular confirmado':' · sin titularidad confirmada'),
        detail:d.teams[side].name}))))
  add('Enfrentamientos por posición',d.matchups.slice(0,20).map(m=>({
    label:m.attacker+' vs '+m.against,value:m.candidates.length+' posibles defensores',
    detail:m.candidates.slice(0,5).map(x=>x.name).join(', ')})))
  add('Lesiones verificadas por roster',d.injuries.map(x=>({
    label:x.name,value:x.status,detail:x.teamId})))
  add('Noticias y expertos',[
    ...d.news.map(x=>({label:x.title,value:x.source,detail:x.published})),
    ...d.editorial.map(x=>({label:x.title,value:x.publisher,
      detail:'Titular indexado, no pick validado'}))])
  add('Clima y sede',[{label:d.event.venue,value:d.weather?
    'Viento '+String(d.weather.windKmh??'—')+' km/h':'Clima no verificado',
    detail:d.weather?'Temperatura '+String(d.weather.temperatureC??'—')+' °C':
      'No atribuir efectos meteorológicos sin datos de estadio'}])
  add('Escenarios',d.scenarios.map((x,i)=>({label:'Escenario '+(i+1),value:x})))
  add('Mercados reales encontrados',d.markets.map(m=>({label:m.bookmaker+
    ' · '+m.market+' '+m.selection,value:m.price.toFixed(2)+
    (m.line===null?'':' · '+m.line),detail:m.contradiction})))
  add('Información faltante',d.missingEvidence.map(x=>({label:x,value:'Pendiente'})))
  return{component:'sports_espn_dashboard',version:1,props:{
    view:'event',title:'PHOENIX NFL · '+d.event.away.name+' vs '+d.event.home.name,
    subtitle:'Protocolo de 32 etapas · cobertura observada '+d.coverage.level,
    source:'ESPN público · fuentes secundarias atribuidas',checkedAt:d.checkedAt,
    sections,note:'Los rosters no confirman QB titular ni 11 titulares por unidad. '+
      'Los datos, cuotas y picks ausentes no se inventan; este informe no es una predicción calibrada.'}}
}
export async function investigateNfl(date:string,eventId:string,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,quotes:MarketOutcome[]=[],
  maxPlayers=20):Promise<NflDossier>{
  if(!id(eventId)||!Number.isInteger(maxPlayers)||maxPlayers<1||maxPlayers>20)
    throw Error('ID o presupuesto NFL inválidos')
  const board=await nflSlate(date,fetcher,now,env)
  const event=board.games.find(x=>x.eventId===eventId)
  if(!event)throw Error('Partido NFL fuera de cartelera verificada')
  if(event.state!=='pre'||Date.parse(event.scheduledAt)<=now)
    throw Error('Un expediente NFL pregame necesita partido futuro y no comenzado')
  const root='https://site.api.espn.com/apis/site/v2/sports/football/nfl/'
  const sources=board.sources
  const date0=Date.parse(date+'T12:00:00Z')
  const past=(d:number)=>new Date(date0-d*86_400_000).toISOString().slice(0,10)
    .replaceAll('-','')
  const [summary,history,injuryData,newsData,rosterHome,rosterAway,people]=await Promise.all([
    read<unknown>(root+'summary?event='+eventId,fetcher,sources,now),
    read<unknown>(root+'scoreboard?dates='+past(85)+'-'+past(1)+'&limit=250',
      fetcher,sources,now),
    read<unknown>(root+'injuries',fetcher,sources,now),
    read<unknown>(root+'news?limit=30',fetcher,sources,now),
    read<unknown>(root+'teams/'+event.home.id+'/roster',fetcher,sources,now),
    read<unknown>(root+'teams/'+event.away.id+'/roster',fetcher,sources,now),
    collectDirectEspnStats('football','nfl',
      [{id:event.home.id,name:event.home.name},{id:event.away.id,name:event.away.name}],
      fetcher,now,maxPlayers),
  ])
  const make=(side:'home'|'away'):NflSide=>{
    const meta=event[side],e=people.teams.find(x=>x.id===meta.id)
    const full=verifiedRoster(side==='home'?rosterHome:rosterAway,meta.id)
    const observations=new Map((e?.athletes??[]).map(p=>[p.id,p]))
    const roster:NflPlayer[]=(full.length?full:(e?.athletes??[]).map(p=>({
      id:p.id,name:p.name,teamId:meta.id,position:p.position,role:positionRole(p.position),
      confirmedOffense:false,confirmedDefense:false,statistics:[],lastGames:[],
      status:'unavailable' as const}))).map(p=>{
        const evidence=observations.get(p.id)
        return{...p,statistics:evidence?.stats??[],lastGames:evidence?.lastGames??[],
          status:evidence?.status??'unavailable'}
      })
    confirmStarters(summary,meta.id,roster)
    const recent=recentResults(history,meta.id,Date.parse(event.scheduledAt))
    const last=recent[0]
    return{id:meta.id,name:meta.name,record:meta.record,roster,recent,
      wins:recent.filter(x=>x.pts>x.allowed).length,
      losses:recent.filter(x=>x.pts<x.allowed).length,
      restHours:last?Math.max(0,(Date.parse(event.scheduledAt)-Date.parse(last.date))/3_600_000):null,
      offenseConfirmed:roster.filter(p=>p.confirmedOffense).length,
      defenseConfirmed:roster.filter(p=>p.confirmedDefense).length,
      teamStats:e?.stats??[],sourceCoverage:e?.coverage??[]}
  }
  const teams={home:make('home'),away:make('away')}
  const injuries=arr(obj(injuryData).injuries).flatMap(v=>{
    const r=obj(v),tid=id(obj(r.team).id??r.id)
    const matched=tid===teams.home.id?teams.home:tid===teams.away.id?teams.away:null
    if(!matched)return []
    return arr(r.injuries??r.items).flatMap(x=>{
      const item=obj(x),playerId=id(obj(item.athlete).id??item.athleteId)
      const person=matched.roster.find(p=>p.id===playerId),status=str(item.status??item.description)
      return person&&status?[{teamId:tid,name:person.name,playerId,status}]:[]
    })
  }).slice(0,40)
  const news=arr(obj(newsData).articles).flatMap(raw=>{
    const v=obj(raw),title=str(v.headline,180),desc=str(v.description,300)
    if(!title||![teams.home.name,teams.away.name].some(x=>
      normalize(title+' '+desc).includes(normalize(x))))return []
    return[{title,published:str(v.published,50),source:'ESPN News'}]
  }).slice(0,15)
  const editorial=await discoverEditorialResearch(event.home.name+' '+event.away.name,
    ['covers','vegasinsider'],fetcher,now)
  const context=obj(obj(summary).gameInfo),referee=str(obj(arr(context.officials)[0]).displayName)||null
  const comp=obj(arr(obj(obj(summary).header).competitions)[0])
  const venue=obj(comp.venue),address=obj(venue.address)
  const lat=num(venue.latitude??address.latitude),lon=num(venue.longitude??address.longitude)
  let weather:NflDossier['weather']=null
  if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
    const url='https://api.open-meteo.com/v1/forecast?latitude='+lat+
      '&longitude='+lon+'&hourly=temperature_2m,wind_speed_10m,precipitation_probability'+
      '&timezone=GMT&forecast_days=16'
    const data=await read<unknown>(url,fetcher,sources,now),hour=obj(obj(data).hourly)
    const target=Date.parse(event.scheduledAt)
    const nearest=arr(hour.time).map((v,i)=>({i,t:str(v,40)}))
      .map(x=>({...x,d:Math.abs(Date.parse(x.t.endsWith('Z')?x.t:x.t+'Z')-target)}))
      .filter(x=>Number.isFinite(x.d)).sort((a,b)=>a.d-b.d)[0]
    if(nearest&&nearest.d<=3_600_000){
      const val=(field:string)=>num(arr(hour[field])[nearest.i])
      weather={timestamp:nearest.t,temperatureC:val('temperature_2m'),
        windKmh:val('wind_speed_10m'),precipitationChance:val('precipitation_probability')}
    }
  }
  const matchups=[...potentialMatchups(teams.home,teams.away),
    ...potentialMatchups(teams.away,teams.home)]
  const markets=reviewMarkets(event,quotes,now)
  const missing=[
    ...(!teams.home.roster.length?['Roster local no disponible']:[]),
    ...(!teams.away.roster.length?['Roster visitante no disponible']:[]),
    ...(!teams.home.recent.length?['Forma reciente local sin verificar']:[]),
    ...(!teams.away.recent.length?['Forma reciente visitante sin verificar']:[]),
    ...(!weather?['Meteorología horaria no verificable']:[]),
    ...(!injuryData?['Reporte de lesiones no disponible']:[]),
    ...(!referee?['Crew arbitral pendiente']:[]),
    ...(['home','away'] as const).flatMap(side=>[
      ...(teams[side].offenseConfirmed!==11?
        ['Once ofensivo '+teams[side].name+' no confirmado']:[]),
      ...(teams[side].defenseConfirmed!==11?
        ['Once defensivo '+teams[side].name+' no confirmado']:[])]),
    'QB1 titular y lista oficial de inactivos antes de kickoff requieren confirmación independiente',
    'EPA/play, QB pressure, rutas, coberturas, snaps y asignación de CB requieren estadísticas/tracking licenciados',
    'Lesiones, clima, viaje y reglas exactas de sportsbook pueden cambiar el escenario',
    'No existe ventaja estadística calibrada ni EV auditado de estos mercados',
  ]
  const verifiedPlayers=teams.home.roster.length+teams.away.roster.length
  const starters=teams.home.offenseConfirmed+teams.home.defenseConfirmed+
    teams.away.offenseConfirmed+teams.away.defenseConfirmed
  const formGames=teams.home.recent.length+teams.away.recent.length
  const advancedObserved=(side:'home'|'away')=>
    teams[side].teamStats.some(stat=>/epa|expected points added/iu.test(stat.name))&&
    teams[side].teamStats.some(stat=>/third.down|success rate/iu.test(stat.name))
  const qbConfirmed=(side:'home'|'away')=>teams[side].roster.some(p=>
    p.role==='quarterback'&&p.confirmedOffense)
  const level:NflDossier['coverage']['level']=
    starters===44&&verifiedPlayers>=44&&formGames>=6&&markets.length>0&&
      qbConfirmed('home')&&qbConfirmed('away')&&
      advancedObserved('home')&&advancedObserved('away')?'A':
    verifiedPlayers>=30&&formGames>=4?'B':verifiedPlayers>0||formGames>0?'C':'D'
  const coverage={level,confirmedOffense:teams.home.offenseConfirmed+teams.away.offenseConfirmed,
    confirmedDefense:teams.home.defenseConfirmed+teams.away.defenseConfirmed,
    verifiedPlayers,formGames,quotedMarkets:markets.length}
  const scenarios=[
    'Q1: QB y OL contra pass rush, blitz y coberturas; contrastar inactivos y estilos de apertura.',
    'Q2: terceros downs, red zone, 2-minute drill y cambios de play calling por marcador.',
    'Q3: ajustes de coordinadores, rotaciones defensivas, volumen de carrera vs pases.',
    'Q4: reloj y tempo, field position, pérdidas y riesgo de OT bajo reglas vigentes de NFL/casa.',
  ]
  const forFacts=[
    ...(teams.home.recent.length?['Local '+teams.home.wins+'V-'+teams.home.losses+'D en '+
      teams.home.recent.length+' observados']:[]),
    ...(teams.away.recent.length?['Visitante '+teams.away.wins+'V-'+teams.away.losses+'D en '+
      teams.away.recent.length+' observados']:[]),
  ]
  const report:Omit<NflDossier,'uiBlock'>={event,checkedAt:new Date(now).toISOString(),
    teams,injuries,matchups,news,
    editorial:editorial.hits.map(h=>({title:h.headline,publisher:h.publisher,
      verifiedPick:false as const})),referee,weather,markets,scenarios,missingEvidence:missing,
    sources,coverage,opportunity:{version:1,sport:'football',league:'nfl',eventId:event.eventId,
      decision:level==='A'||level==='B'?'investigate':'abstain',eligibleForTicket:false,
      calibratedProbability:false,forFacts,againstFacts:[
        'La forma reciente no garantiza victoria, spread ni prop acertada',
        'QB/inactivos/coberturas podrían cambiar las conclusiones al acercarse kickoff'],
      missingEvidence:missing}}
  return{...report,uiBlock:panel(report)}
}
