/**
 * Evidence-first MLB research dossier. This module gathers observed MLB facts,
 * preserves missing information, and never invents winners or probabilities.
 * The analyst (Kira) uses this structured dossier to reason about markets.
 */
import { getFeed,hasSportsPermission,type MarketOutcome } from './sports.ts'

type Obj=Record<string,unknown>
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const word=(v:unknown,n=130):string=>(typeof v==='string'||typeof v==='number'
  ?String(v).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):'')
const numeric=(v:unknown):number|null=>{
  if(typeof v!=='number'&&typeof v!=='string')return null
  const n=Number(v)
  return Number.isFinite(n)?n:null
}
const id=(v:unknown):number|null=>{
  const n=numeric(v)
  return n!==null&&Number.isSafeInteger(n)&&n>0&&n<100000000?n:null
}
const day=(s:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
const iso=(t:number)=>new Date(t).toISOString()
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
const trimNum=(n:number|null)=>n===null?'—':String(n)
const scoreOf=(team:Obj):number|null=>numeric(team.score)
const allowedMetric=(v:unknown)=>v===null||v===undefined||v===''?null:word(v,22)
export type MlbSource={endpoint:string;observedAt:string;status:'verified'|'empty'|'error';detail?:string}
export type MlbTeam={id:number;name:string;side:'home'|'away';score:number|null;probableStarter:{id:number;name:string}|null}
export type MlbFixture={gamePk:number;date:string;status:string;league:'mlb';home:MlbTeam;away:MlbTeam;venue:{id:number|null;name:string}}
export type MlbForm={games:number;wins:number;losses:number;runsFor:number;runsAgainst:number;
  home:{wins:number;losses:number};away:{wins:number;losses:number};
  lastResults:Array<{date:string;opponentId:number;scored:number;allowed:number;side:'home'|'away'}>}
export type MlbAthlete={id:number;name:string;teamId:number;role:'batter'|'pitcher';batSide:string;
  pitchHand:string;lineupOrder:number|null;lineupConfirmed:boolean;position:string;
  season:Record<string,string>;lastFive:Record<string,string>;
  reliefUsage72h:Array<{date:string;innings:string;pitches:string}>;
  evidence:'observed'|'partial'|'missing'}
export type MlbMatchup={batterId:number;batter:string;pitcherId:number;pitcher:string;
  pitcherRole:'probable-starter'|'active-bullpen';batterSide:string;pitcherHand:string;
  observations:string[];bvp:Record<string,string>|null;missing:string[];assessment:'requires-review'}
export type MlbWeather={time:string;temperatureC:number|null;humidityPercent:number|null;
  precipitationPercent:number|null;windSpeedKmh:number|null;windDirectionDegrees:number|null;
  rooftop:'unknown';windRelativeToField:'unknown'}
export type MlbOpportunity={eventId:string;sport:'baseball';league:'mlb';source:'MLB Stats API';
  matchup:string;state:'investigate'|'abstain';reason:string;
  evidenceCount:number;missingEvidence:string[];marketResearchReady:boolean;priced:false}
export type MlbCase={
  fixture:MlbFixture;checkedAt:string;season:number;
  sources:MlbSource[];teamForm:Record<'home'|'away',MlbForm|null>;
  rosters:Record<'home'|'away',MlbAthlete[]>;starters:Record<'home'|'away',MlbAthlete|null>;
  bullpen:Record<'home'|'away',MlbAthlete[]>;lineupStatus:Record<'home'|'away','confirmed'|'unconfirmed'>;
  matchups:MlbMatchup[];venue:{name:string;latitude:number|null;longitude:number|null;roof:'unknown'};
  weather:MlbWeather|null;injuries:Array<{team:string;name:string;status:'listed-in-injured-roster'}>;
  news:Array<{headline:string;published:string;source:string}>;
  odds:MarketOutcome[];scenarioAnalysis:string[];missingEvidence:string[];
  opportunity:MlbOpportunity;
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{
    view:'event';title:string;subtitle:string;source:string;checkedAt:string;
    sections:Array<{heading:string;kind:'list'|'metrics'|'articles';
      items:Array<{label:string;value:string;detail?:string}>}>;note:string}}
}
type RawStats={stats?:Array<{splits?:Array<{stat?:Obj;date?:string}>}>}
type GameFeed={dates?:Array<{games?:unknown[]}>}
const fields=(v:Obj,names:string[]):Record<string,string>=>Object.fromEntries(names.flatMap(k=>{
  const t=allowedMetric(v[k])
  return t===null?[]:[[k,t]]
}))
const battingFields=['gamesPlayed','plateAppearances','atBats','hits','doubles','triples',
  'homeRuns','baseOnBalls','strikeOuts','avg','obp','slg','ops','rbi','stolenBases']
const pitchingFields=['gamesPlayed','gamesStarted','wins','losses','era','whip','inningsPitched',
  'strikeOuts','baseOnBalls','hits','homeRuns','numberOfPitches','strikeoutsPer9Inn','walksPer9Inn']
function asFixture(raw:unknown):MlbFixture|null{
  const game=obj(raw),teams=obj(game.teams),venue=obj(game.venue)
  const home=obj(teams.home),away=obj(teams.away)
  const make=(row:Obj,side:'home'|'away'):MlbTeam|null=>{
    const team=obj(row.team),p=obj(row.probablePitcher),tid=id(team.id)
    if(tid===null||!word(team.name))return null
    const pid=id(p.id)
    return {id:tid,name:word(team.name),side,score:scoreOf(row),
      probableStarter:pid&&word(p.fullName)?{id:pid,name:word(p.fullName)}:null}
  }
  const h=make(home,'home'),a=make(away,'away'),gamePk=id(game.gamePk)
  if(!h||!a||!gamePk||!Number.isFinite(Date.parse(word(game.gameDate,60))))return null
  const status=obj(game.status)
  return {gamePk,date:word(game.gameDate,60),
    status:word(status.abstractGameState??status.detailedState,60),
    league:'mlb',home:h,away:a,
    venue:{id:id(venue.id),name:word(venue.name)||'Estadio no verificado'}}
}
function defaultDate(now:number):string{
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',
    year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
}
function lastDate(date:string,n:number):string{
  return new Date(Date.parse(date+'T12:00:00Z')-n*86_400_000).toISOString().slice(0,10)
}
async function measured<T>(endpoint:string,fetcher:typeof fetch,sources:MlbSource[],now:number)
  :Promise<T|null>{
  try{
    const data=await getFeed<T>(endpoint,fetcher)
    sources.push({endpoint,observedAt:iso(now),status:data==null?'empty':'verified'})
    return data
  }catch(error){
    sources.push({endpoint,observedAt:iso(now),status:'error',
      detail:error instanceof Error?error.message.slice(0,150):'Fuente no disponible'})
    return null
  }
}
async function boundedMap<T,R>(items:T[],concurrency:number,fn:(item:T)=>Promise<R>):Promise<R[]>{
  const out:Array<R>=Array(items.length)
  let cursor=0
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(cursor<items.length){const index=cursor++;out[index]=await fn(items[index]!)}
  }))
  return out
}
function form(games:unknown[],teamId:number,cutoff:number):MlbForm{
  const valid=games.flatMap(entry=>{
    const g=obj(entry),status=obj(g.status),t=obj(g.teams),h=obj(t.home),a=obj(t.away)
    const isHome=id(obj(h.team).id)===teamId
    const own=isHome?h:a,opponent=isHome?a:h
    const opponentId=id(obj(opponent.team).id)
    const d=Date.parse(word(g.gameDate))
    const scored=numeric(own.score),allowed=numeric(opponent.score)
    if(!opponentId||!Number.isFinite(d)||d>=cutoff||
      word(status.abstractGameState)!=='Final'||scored===null||allowed===null)return []
    return[{date:word(g.gameDate),opponentId,scored,allowed,side:isHome?'home' as const:'away' as const}]
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20)
  const slice=(side:'home'|'away')=>valid.filter(g=>g.side===side)
  return{games:valid.length,wins:valid.filter(g=>g.scored>g.allowed).length,
    losses:valid.filter(g=>g.scored<g.allowed).length,
    runsFor:valid.reduce((s,g)=>s+g.scored,0),runsAgainst:valid.reduce((s,g)=>s+g.allowed,0),
    home:{wins:slice('home').filter(g=>g.scored>g.allowed).length,
      losses:slice('home').filter(g=>g.scored<g.allowed).length},
    away:{wins:slice('away').filter(g=>g.scored>g.allowed).length,
      losses:slice('away').filter(g=>g.scored<g.allowed).length},
    lastResults:valid}
}
function gameRoster(response:unknown,teamId:number){
  return arr(obj(response).roster).flatMap(v=>{
    const x=obj(v),person=obj(x.person),p=obj(x.position),pid=id(person.id)
    if(!pid||!word(person.fullName))return []
    return [{id:pid,name:word(person.fullName),teamId,
      role:word(p.type)==='Pitcher'||word(p.abbreviation)==='P'?'pitcher' as const:'batter' as const,
      position:word(p.abbreviation)}]
  })
}
function boxOrder(box:unknown,side:'home'|'away'):number[]{
  const teams=obj(obj(box).teams),entry=obj(teams[side])
  return arr(entry.battingOrder).map(id).filter((x):x is number=>x!==null).slice(0,9)
}
const hitSummary=(s:Record<string,string>)=>[
  'AVG '+(s.avg??'—'),'OPS '+(s.ops??'—'),'H '+(s.hits??'—'),
  'HR '+(s.homeRuns??'—'),'K '+(s.strikeOuts??'—')].join(' · ')
const pitcherSummary=(s:Record<string,string>)=>[
  'ERA '+(s.era??'—'),'WHIP '+(s.whip??'—'),'IP '+(s.inningsPitched??'—'),
  'K '+(s.strikeOuts??'—'),'W-L '+(s.wins??'—')+'-'+(s.losses??'—')].join(' · ')
function rosterMatchups(batters:MlbAthlete[],starter:MlbAthlete|null,relief:MlbAthlete[],
  bvp:Map<string,Record<string,string>>):MlbMatchup[]{
  const pitchers=[...(starter?[starter]:[]),...relief]
  return batters.flatMap(b=>pitchers.map(p=>{
    const matchupStats=bvp.get(b.id+':'+p.id)??null
    const observations=[
      ...(matchupStats?['BvP registrado: AB '+(matchupStats.atBats??'—')+
        ', H '+(matchupStats.hits??'—')+', K '+(matchupStats.strikeOuts??'—')+
        ', HR '+(matchupStats.homeRuns??'—')]:[]),
      ...(b.season.ops?['Bateador OPS temporada '+b.season.ops]:[]),
      ...(b.season.strikeOuts?['Bateador K temporada '+b.season.strikeOuts]:[]),
      ...(p.season.era?['Pitcher ERA temporada '+p.season.era]:[]),
      ...(p.season.whip?['Pitcher WHIP temporada '+p.season.whip]:[]),
      ...(p.season.strikeOuts?['Pitcher K temporada '+p.season.strikeOuts]:[]),
    ]
    return{batterId:b.id,batter:b.name,pitcherId:p.id,pitcher:p.name,
      pitcherRole:starter?.id===p.id?'probable-starter':'active-bullpen',
      batterSide:b.batSide,pitcherHand:p.pitchHand,
      observations,bvp:matchupStats,missing:[
        ...(matchupStats?[]:['Enfrentamiento BvP específico no comprobado']),
        'Repertorio, tipos de pitcheo y splits vs mano no comprobados',
        ...(b.lineupConfirmed?[]:['Bateador no confirmado en alineación']),
        ...(starter?.id===p.id?[]:['Aparición del relevista no confirmada']),
      ],assessment:'requires-review' as const}
  }))
}
function weatherAt(v:unknown,kickoff:string):MlbWeather|null{
  const hourly=obj(obj(v).hourly),times=arr(hourly.time).map(x=>word(x,50))
  if(!times.length)return null
  const target=Date.parse(kickoff)
  const indices=times.map((s,i)=>({i,delta:Math.abs(Date.parse(s.endsWith('Z')?s:s+'Z')-target)}))
    .filter(x=>Number.isFinite(x.delta)).sort((a,b)=>a.delta-b.delta)
  const nearest=indices[0]
  if(!nearest||nearest.delta>3_600_000)return null
  const metric=(key:string)=>numeric(arr(hourly[key])[nearest.i])
  return{time:times[nearest.i]!,temperatureC:metric('temperature_2m'),
    humidityPercent:metric('relative_humidity_2m'),
    precipitationPercent:metric('precipitation_probability'),
    windSpeedKmh:metric('wind_speed_10m'),
    windDirectionDegrees:metric('wind_direction_10m'),
    rooftop:'unknown',windRelativeToField:'unknown'}
}
function verifiedOdds(fixture:MlbFixture,quotes:MarketOutcome[],now:number):MarketOutcome[]{
  const h=normalize(fixture.home.name),a=normalize(fixture.away.name)
  const target=Date.parse(fixture.date)
  return quotes.filter(q=>{
    const qdate=Date.parse(q.timeIso??q.time),observed=Date.parse(q.updatedAt)
    if(!Number.isFinite(qdate)||!Number.isFinite(observed)||observed>now||
      now-observed>3_600_000||Math.abs(qdate-target)>3_600_000)return false
    return normalize(q.home)===h&&normalize(q.away)===a&&
      q.bookmaker.trim().length>0&&q.price>1&&Number.isFinite(q.price)
  }).slice(0,40)
}
function makePanel(result:Omit<MlbCase,'uiBlock'>):MlbCase['uiBlock']{
  const sections:MlbCase['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,40)})
  }
  const home=result.fixture.home,away=result.fixture.away
  add('Forma y localía',(['away','home'] as const).map(side=>{
    const team=result.fixture[side],f=result.teamForm[side]
    return {label:team.name,value:f?f.wins+'V '+f.losses+'D · carreras '+f.runsFor+'-'+f.runsAgainst:'Sin historial verificado',
      detail:f?'Últimos '+f.games+' · local '+f.home.wins+'-'+f.home.losses+
        ' · visitante '+f.away.wins+'-'+f.away.losses:'Datos de resultados no disponibles'}
  }))
  add('Abridores y últimas actuaciones',(['away','home'] as const).map(side=>{
    const p=result.starters[side]
    return{label:result.fixture[side].name,value:p?p.name:'Abridor no verificado',
      detail:p?pitcherSummary(p.season)+' · últimos 5: '+pitcherSummary(p.lastFive):
        'No asumir pitcher por roster'}
  }))
  add('Rosters y alineaciones',(['away','home'] as const).flatMap(side=>
    result.rosters[side].filter(p=>p.role==='batter').slice(0,18).map(p=>({
      label:result.fixture[side].name+' · '+p.name,
      value:p.lineupOrder!==null?'Orden '+p.lineupOrder:'Roster activo (no titular confirmado)',
      detail:hitSummary(p.season)+' · últimos 5: '+hitSummary(p.lastFive)}))))
  add('Bullpen: disponibilidad por confirmar',(['away','home'] as const).flatMap(side=>
    result.bullpen[side].map(p=>({label:result.fixture[side].name+' · '+p.name,
      value:pitcherSummary(p.season),detail:p.reliefUsage72h.length?
        'Últimas 72h: '+p.reliefUsage72h.map(g=>g.date.slice(5)+' '+g.pitches+' pitcheos').join('; ')+
          ' · disponibilidad NO confirmada':
        'Sin apariciones verificables últimas 72h; disponibilidad NO confirmada'}))))
  add('Bajas registradas por MLB',result.injuries.map(p=>({
    label:p.team+' · '+p.name,value:'En roster de lesionados según MLB',
    detail:'Confirmar fecha, disponibilidad y posible activación antes del partido'})))
  add('Noticias relacionadas',result.news.map(p=>({
    label:p.headline,value:p.source,detail:p.published||'Fecha no publicada'})))
  add('Matriz roster contra abridores y bullpen',result.matchups.slice(0,30).map(m=>({
    label:m.batter+' vs '+m.pitcher,value:m.pitcherRole==='probable-starter'?'Abridor probable':'Bullpen posible',
    detail:[...m.observations.slice(0,3),...m.missing.slice(0,1)].join(' · ')})))
  add('Parque y clima',[{label:result.venue.name,
    value:result.weather?'Viento '+trimNum(result.weather.windSpeedKmh)+' km/h · '+
      'temperatura '+trimNum(result.weather.temperatureC)+' °C':'Meteorología no confirmada',
    detail:'Dirección relativa al campo, orientación y techo pendientes; no atribuir efecto de viento'}])
  add('Mercados de casas',result.odds.slice(0,12).map(q=>({
    label:q.bookmaker+' · '+q.market+' '+q.selection,
    value:q.price.toFixed(2)+(q.point===null||q.point===undefined?'':' · línea '+q.point),
    detail:q.updatedAt+' · '+(q.source??'Proveedor cotejado')})))
  add('Escenarios por entradas',result.scenarioAnalysis.map((value,i)=>({
    label:['Entradas 1-3','Entradas 4-5','Entradas 6-7','Entradas 8-9','Escenario alternativo'][i]??'Condiciones',
    value,detail:'Exploración razonada; no es una simulación estadística calibrada'})))
  add('Evidencia faltante',result.missingEvidence.slice(0,16).map(x=>({label:x,value:'Pendiente'})))
  return{component:'sports_espn_dashboard',version:1,props:{view:'event',
    title:'PHOENIX · Investigación MLB · '+away.name+' vs '+home.name,
    subtitle:'Expediente con fuentes, roster, cruces y escenarios · '+result.fixture.status,
    source:'MLB Stats API · cuotas independientes cuando verificadas',
    checkedAt:result.checkedAt,sections,
    note:'Investigación verificable, NO probabilidad calibrada ni apuesta garantizada. '+
      'Enfrentamientos directos BvP, últimas salidas, alineaciones y bullpen deben confirmarse por fuente; '+
      'el roster activo NO confirma participación.'}}
}
/** Bounded MLB slate from the official schedule, with genuine IDs. */
export async function discoverMlbDay(date:string,fetcher:typeof fetch=fetch,now=Date.now()):
  Promise<{date:string;fixtures:MlbFixture[];sources:MlbSource[]}>{
  if(!day(date))throw Error('Fecha MLB inválida')
  const sources:MlbSource[]=[]
  const url='https://statsapi.mlb.com/api/v1/schedule?sportId=1&date='+date+
    '&hydrate=probablePitcher,venue'
  const response=await measured<GameFeed>(url,fetcher,sources,now)
  const fixtures=arr(response?.dates).flatMap(x=>arr(obj(x).games))
    .flatMap(x=>{const result=asFixture(x);return result?[result]:[]})
  return{date,fixtures,sources}
}
/**
 * Investigate one MLB game; never infer starting lineups or player availability.
 * The user must request a real gamePk present in official schedule for that day.
 */
export async function researchMlbCase(
  date:string,gamePk:number,fetcher:typeof fetch=fetch,now=Date.now(),
  env:NodeJS.ProcessEnv=process.env,quotes:MarketOutcome[]=[],
):Promise<MlbCase>{
  if(!hasSportsPermission('mlb',env))throw Error('MLB deshabilitada')
  const slate=await discoverMlbDay(date,fetcher,now)
  const sources=slate.sources
  const fixture=slate.fixtures.find(x=>x.gamePk===gamePk)
  if(!fixture)throw Error('El juego MLB no aparece en la cartelera oficial para la fecha')
  if(Date.parse(fixture.date)<=now||!['Preview','Pre-Game','Scheduled'].includes(fixture.status))
    throw Error('Este expediente prepartido requiere un juego MLB futuro')
  const season=Number(fixture.date.slice(0,4))
  const teams=['home','away'] as const
  const [box,live,venueRaw,homeRoster,awayRoster,homeSchedule,awaySchedule]=await Promise.all([
    measured<unknown>('https://statsapi.mlb.com/api/v1/game/'+gamePk+'/boxscore',fetcher,sources,now),
    measured<unknown>('https://statsapi.mlb.com/api/v1/game/'+gamePk+'/feed/live',fetcher,sources,now),
    fixture.venue.id?measured<unknown>('https://statsapi.mlb.com/api/v1/venues?venueIds='+
      fixture.venue.id,fetcher,sources,now):Promise.resolve(null),
    measured<unknown>('https://statsapi.mlb.com/api/v1/teams/'+fixture.home.id+
      '/roster?rosterType=active',fetcher,sources,now),
    measured<unknown>('https://statsapi.mlb.com/api/v1/teams/'+fixture.away.id+
      '/roster?rosterType=active',fetcher,sources,now),
    measured<GameFeed>('https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId='+
      fixture.home.id+'&startDate='+lastDate(date,55)+'&endDate='+lastDate(date,1),
      fetcher,sources,now),
    measured<GameFeed>('https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId='+
      fixture.away.id+'&startDate='+lastDate(date,55)+'&endDate='+lastDate(date,1),
      fetcher,sources,now),
  ])
  const venue=obj(arr(obj(venueRaw).venues)[0]),location=obj(venue.location)
  const coordinates=obj(location.defaultCoordinates)
  const lat=numeric(coordinates.latitude),lon=numeric(coordinates.longitude)
  const safeGeo=lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180
  const site={name:word(venue.name)||fixture.venue.name,
    latitude:safeGeo?lat:null,longitude:safeGeo?lon:null,roof:'unknown' as const}
  let weather:MlbWeather|null=null
  if(site.latitude!==null&&site.longitude!==null){
    const url='https://api.open-meteo.com/v1/forecast?latitude='+site.latitude+
      '&longitude='+site.longitude+
      '&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m'+
      '&wind_speed_unit=kmh&timezone=GMT&forecast_days=16'
    const meteo=await measured<unknown>(url,fetcher,sources,now)
    weather=weatherAt(meteo,fixture.date)
  }
  const teamForm={home:homeSchedule?form(arr(obj(homeSchedule).dates).flatMap(x=>arr(obj(x).games)),
    fixture.home.id,Date.parse(fixture.date)):null,
    away:awaySchedule?form(arr(obj(awaySchedule).dates).flatMap(x=>arr(obj(x).games)),
      fixture.away.id,Date.parse(fixture.date)):null}
  const injuryFeeds=await Promise.all(teams.map(async side=>({side,
    data:await measured<unknown>('https://statsapi.mlb.com/api/v1/teams/'+
      fixture[side].id+'/roster?rosterType=injured',fetcher,sources,now)})))
  const injuries=injuryFeeds.flatMap(({side,data})=>gameRoster(data,fixture[side].id)
    .map(p=>({team:fixture[side].name,name:p.name,
      status:'listed-in-injured-roster' as const})))
  const liveBox=obj(obj(live).liveData).boxscore
  const lineupOrders={home:boxOrder(box,'home').length===9?boxOrder(box,'home'):
      boxOrder(liveBox,'home'),
    away:boxOrder(box,'away').length===9?boxOrder(box,'away'):
      boxOrder(liveBox,'away')}
  const lineupStatus={home:lineupOrders.home.length===9?'confirmed' as const:'unconfirmed' as const,
    away:lineupOrders.away.length===9?'confirmed' as const:'unconfirmed' as const}
  const rawRosters={home:gameRoster(homeRoster,fixture.home.id),
    away:gameRoster(awayRoster,fixture.away.id)}
  type Person={id:number;name:string;teamId:number;role:'batter'|'pitcher';position:string;
    lineupOrder:number|null;lineupConfirmed:boolean}
  const people:Person[]=teams.flatMap(side=>{
    const order=lineupOrders[side]
    const team=fixture[side],start=team.probableStarter
    const entries=rawRosters[side]
    // Include a genuine probable starter absent from active roster but flag it later.
    const merged=start&&!entries.some(p=>p.id===start.id)
      ?[...entries,{id:start.id,name:start.name,teamId:team.id,role:'pitcher' as const,position:'P'}]:entries
    return merged.map(p=>({...p,lineupOrder:order.indexOf(p.id)>=0?order.indexOf(p.id)+1:null,
      lineupConfirmed:lineupStatus[side]==='confirmed'&&order.includes(p.id)}))
  })
  // Batters in the official lineup first; all other active athletes remain in dossier.
  // MLB's people endpoint can resolve handedness by authoritative person ID.
  const personInfo=new Map<number,{bat:string;pitch:string}>()
  const distinct=[...new Set(people.map(p=>p.id))]
  const chunks:Array<number[]>=[]
  for(let i=0;i<distinct.length;i+=30)chunks.push(distinct.slice(i,i+30))
  const descriptions=await boundedMap(chunks,2,part=>measured<unknown>(
    'https://statsapi.mlb.com/api/v1/people?personIds='+part.join(','),
    fetcher,sources,now))
  for(const result of descriptions)for(const raw of arr(obj(result).people)){
    const person=obj(raw),pid=id(person.id)
    if(pid)personInfo.set(pid,{bat:word(obj(person.batSide).code)||'no verificado',
      pitch:word(obj(person.pitchHand).code)||'no verificado'})
  }
  const profiles=await boundedMap(people,7,async(p):Promise<MlbAthlete>=>{
    const group=p.role==='pitcher'?'pitching':'hitting'
    const urls=[
      'https://statsapi.mlb.com/api/v1/people/'+p.id+
        '/stats?stats=season&group='+group+'&season='+season,
      'https://statsapi.mlb.com/api/v1/people/'+p.id+
        '/stats?stats=lastXGames&group='+group+'&limit=5&season='+season,
    ]
    const [seasonResponse,recentResponse]=await Promise.all(urls.map(url=>
      measured<RawStats>(url,fetcher,sources,now)))
    // Report actual workload without declaring that an active reliever is ready.
    const gameLog=p.role==='pitcher'?await measured<RawStats>(
      'https://statsapi.mlb.com/api/v1/people/'+p.id+
        '/stats?stats=gameLog&group=pitching&season='+season,fetcher,sources,now):null
    const cutoff=Date.parse(fixture.date)-3*86_400_000
    const recentAppearances=arr(gameLog?.stats?.[0]?.splits)
      .flatMap(raw=>{
        const e=obj(raw),time=Date.parse(word(e.date)),st=obj(e.stat)
        if(!Number.isFinite(time)||time>=Date.parse(fixture.date)||time<cutoff)return []
        return[{date:word(e.date,20),innings:word(st.inningsPitched,20)||'—',
          pitches:word(st.numberOfPitches,20)||'—'}]
      }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5)
    const first=(r:RawStats|null|undefined)=>obj(r?.stats?.[0]?.splits?.[0]?.stat)
    const seasonStats=fields(first(seasonResponse),p.role==='pitcher'?pitchingFields:battingFields)
    const lastFive=fields(first(recentResponse),p.role==='pitcher'?pitchingFields:battingFields)
    return{id:p.id,name:p.name,teamId:p.teamId,role:p.role,position:p.position,
      batSide:personInfo.get(p.id)?.bat??'no verificado',
      pitchHand:personInfo.get(p.id)?.pitch??'no verificado',
      lineupOrder:p.lineupOrder,lineupConfirmed:p.lineupConfirmed,
      season:seasonStats,lastFive,reliefUsage72h:recentAppearances,
      evidence:Object.keys(seasonStats).length&&Object.keys(lastFive).length?'observed':
        Object.keys(seasonStats).length||Object.keys(lastFive).length?'partial':'missing'}
  })
  const rosterMap={home:profiles.filter(p=>p.teamId===fixture.home.id),
    away:profiles.filter(p=>p.teamId===fixture.away.id)}
  const getStarter=(side:'home'|'away')=>{
    const starter=fixture[side].probableStarter
    return starter?rosterMap[side].find(p=>p.id===starter.id)??null:null
  }
  const starters={home:getStarter('home'),away:getStarter('away')}
  const bullpen={home:rosterMap.home.filter(p=>p.role==='pitcher'&&p.id!==starters.home?.id),
    away:rosterMap.away.filter(p=>p.role==='pitcher'&&p.id!==starters.away?.id)}
  const batters=(side:'home'|'away')=>rosterMap[side].filter(p=>p.role==='batter')
    .sort((a,b)=>(a.lineupOrder??99)-(b.lineupOrder??99)||a.name.localeCompare(b.name))
    .slice(0,lineupStatus[side]==='confirmed'?9:18)
  // A single vsPlayer season query per selected hitter can expose BvP splits
  // against multiple opponents; never infer an opposition ID from the order.
  const bvp=new Map<string,Record<string,string>>()
  const focus=[...batters('home').slice(0,9),...batters('away').slice(0,9)]
  await boundedMap(focus,4,async batter=>{
    const data=await measured<RawStats>('https://statsapi.mlb.com/api/v1/people/'+
      batter.id+'/stats?stats=vsPlayer&group=hitting&season='+season,
      fetcher,sources,now)
    for(const raw of arr(data?.stats?.[0]?.splits)){
      const split=obj(raw)
      const opponentId=id(obj(split.player).id??obj(split.opponent).id)
      const knownPitcher=[...bullpen.home,...bullpen.away,starters.home,starters.away]
        .some(p=>p?.id===opponentId)
      if(!opponentId||!knownPitcher)continue
      const stats=fields(obj(split.stat),battingFields)
      if(!Object.keys(stats).length)continue
      bvp.set(batter.id+':'+opponentId,stats)
    }
  })
  const matchups=[...rosterMatchups(batters('home'),starters.away,bullpen.away,bvp),
    ...rosterMatchups(batters('away'),starters.home,bullpen.home,bvp)]
  // Public journalism is supplementary: news mentioning a club is NOT a
  // confirmed medical report, starting lineup, or expert pick.
  const newsFeed=await measured<unknown>(
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news?limit=40',
    fetcher,sources,now)
  const clubNames=[fixture.home.name,fixture.away.name]
    .flatMap(name=>[normalize(name),normalize(name.split(' ').slice(-1)[0]??'')])
    .filter(name=>name.length>=5)
  const news=arr(obj(newsFeed).articles).flatMap(raw=>{
    const a=obj(raw),headline=word(a.headline,200),description=word(a.description,320)
    if(!headline||!clubNames.some(name=>normalize(headline+' '+description).includes(name)))return []
    return[{headline,published:word(a.published,60),source:'ESPN MLB News · titular público, no lesión confirmada'}]
  }).slice(0,12)
  const missingEvidence=[
    ...(lineupStatus.home==='unconfirmed'?['Alineación local todavía no confirmada']:[]),
    ...(lineupStatus.away==='unconfirmed'?['Alineación visitante todavía no confirmada']:[]),
    ...(!starters.home?['Abridor local no verificado']:[]),
    ...(!starters.away?['Abridor visitante no verificado']:[]),
    ...(!weather?['Clima horario no disponible']:[]),
    'Orientación del terreno, techo abierto/cerrado y efecto del viento no verificados',
    'Fatiga y disponibilidad definitivas de relevistas requieren confirmación; las últimas 72h son contexto, no permiso de jugar',
    'Lesiones, estrellas, noticias y opiniones de expertos sin verificación específica',
    'Enfrentamientos BvP no publicados, splits de mano y repertorio siguen pendientes por jugador',
  ]
  if(!rawRosters.home.length||!rawRosters.away.length)
    missingEvidence.push('Rosters activos incompletos o no disponibles')
  if(!profiles.length)missingEvidence.push('Estadísticas individuales no disponibles')
  if(!news.length)missingEvidence.push('Noticias específicas de ambos equipos no verificadas')
  if(injuryFeeds.some(x=>x.data===null))missingEvidence.push('Parte de roster lesionado MLB incompleto')
  if(!quotes.length)missingEvidence.push('Cuotas reales no suministradas al expediente')
  const odds=verifiedOdds(fixture,quotes,now)
  if(quotes.length&&!odds.length)missingEvidence.push('Ninguna cuota coincide con ambos equipos, fecha y vigencia')
  const startersText=(side:'home'|'away')=>{const p=starters[side]
    return p?p.name+' ('+pitcherSummary(p.season)+')':'abridor sin confirmar'}
  const scenarios=[
    'Primeras tres entradas: '+fixture.away.name+' enfrenta a '+startersText('home')+
      '; '+fixture.home.name+' enfrenta a '+startersText('away')+
      '. Verificar top del lineup, splits y propensión a K antes de inferir carreras.',
    'Entradas cuatro y cinco: comprobar últimas cinco salidas de ambos abridores y riesgo de sustitución; '+
      'la evidencia disponible no prueba cuántas entradas completarán.',
    'Entradas seis y siete: bullpen local con '+bullpen.home.length+' pitchers activos identificados; '+
      'bullpen visitante con '+bullpen.away.length+
      '. Uso individual 72h documentado cuando existe, disponibilidad final sin confirmar.',
    'Entradas ocho y nueve: estudiar cerradores, emergentes, defensa y ventaja local; '+
      'si el local ya gana, puede no batear la baja de la novena.',
    'Escenario alternativo: '+(weather?'viento '+trimNum(weather.windSpeedKmh)+
      ' km/h y temperatura '+trimNum(weather.temperatureC)+' °C; ':
      'meteorología pendiente; ')+
      'orientación del viento/techo y noticias pueden invalidar la lectura inicial.',
  ]
  const matchup=fixture.away.name+' vs '+fixture.home.name
  const basicReady=Boolean(starters.home&&starters.away&&rawRosters.home.length&&
    rawRosters.away.length&&teamForm.home&&teamForm.away)
  const opportunity:MlbOpportunity={eventId:String(gamePk),sport:'baseball',league:'mlb',
    source:'MLB Stats API',matchup,
    state:basicReady?'investigate':'abstain',
    reason:basicReady?'Expediente inicial verificable para que Kira contraste mercados y contradicciones; NO constituye pronóstico calibrado ni apuesta aprobada.':
      'Investigación incompleta: faltan abridores, rosters o resultados previos; abstenerse de proponer una apuesta.',
    evidenceCount:profiles.filter(p=>p.evidence==='observed').length,
    missingEvidence,marketResearchReady:odds.length>0,priced:false}
  const dossier:Omit<MlbCase,'uiBlock'>={fixture,checkedAt:iso(now),season,sources,
    teamForm,rosters:rosterMap,starters,bullpen,lineupStatus,matchups,
    venue:site,weather,injuries,news,odds,scenarioAnalysis:scenarios,missingEvidence,opportunity}
  return{...dossier,uiBlock:makePanel(dossier)}
}
/** Date-scoped, no implicit future fixtures: return a verifiable board or exact-game dossier. */
export async function mlbResearch(
  date=defaultDate(Date.now()),gamePk?:number,fetcher:typeof fetch=fetch,
  now=Date.now(),env:NodeJS.ProcessEnv=process.env,quotes:MarketOutcome[]=[],
):Promise<{mode:'schedule';date:string;fixtures:MlbFixture[];sources:MlbSource[]}
  |({mode:'dossier'}&MlbCase)>{
  if(gamePk===undefined)return{mode:'schedule',...await discoverMlbDay(date,fetcher,now)}
  if(!id(gamePk))throw Error('ID de juego MLB inválido')
  return{mode:'dossier',...await researchMlbCase(date,gamePk,fetcher,now,env,quotes)}
}
