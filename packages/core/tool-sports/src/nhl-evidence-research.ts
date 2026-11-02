/** Evidence-first NHL specialist. Official rosters are never confirmed lines/goalies.
 * Odds do not imply a calibrated forecast or a bet approved for a ticket.
 */
import {getFeed,type MarketOutcome} from './sports.ts'
type R=Record<string,unknown>
const o=(x:unknown):R=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as R:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const txt=(x:unknown,n=120):string=>typeof x==='string'||typeof x==='number'?
  String(x).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
const id=(x:unknown)=>/^\d{1,18}$/u.test(String(x??''))?String(x):''
const abbr=(x:unknown)=>/^[A-Z]{2,4}$/u.test(String(x??''))?String(x):''
const localized=(x:unknown)=>txt(o(x).default??o(x).en??x)
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export const validHockeyDate=(s:string):boolean=>/^\d{4}-\d{2}-\d{2}$/u.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&
  new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
export type HockeyFixture={id:string;date:string;state:string;season:string;
  home:{id:string;abbrev:string;name:string};away:{id:string;abbrev:string;name:string};
  venue:string}
export type HockeyPlayer={id:string;team:string;name:string;role:'forward'|'defense'|'goalie';
  stats:Record<string,string>;last5:Array<{date:string;goals:string;assists:string;shots:string}>;
  starterConfirmed:false}
export type HockeyEvidenceSource={url:string;status:'verified'|'missing'|'error';checkedAt:string;
  error?:string}
export type HockeyMarket={bookmaker:string;market:string;selection:string;point:number|null;
  odds:number;updatedAt:string;verifiedEvent:true;approved:false;reason:string}
export type HockeyDossier={fixture:HockeyFixture;checkedAt:string;sources:HockeyEvidenceSource[];
  players:{home:HockeyPlayer[];away:HockeyPlayer[]};
  goalieCandidates:{home:HockeyPlayer[];away:HockeyPlayer[]};
  possibleMatchups:Array<{attackerId:string;attacker:string;againstGoalies:string[];source:'roster-only'}>;
  standings:{home:string;away:string};markets:HockeyMarket[];
  scenarios:string[];missingEvidence:string[];
  opportunity:{sport:'hockey';league:'nhl';eventId:string;
    decision:'investigate'|'abstain';eligibleForTicket:false;calibratedProbability:false};
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{view:'event';title:string;
    subtitle:string;source:string;checkedAt:string;sections:Array<{heading:string;
    kind:'list';items:Array<{label:string;value:string;detail?:string}>}>;note:string}}
}
async function source<T>(url:string,fetcher:typeof fetch,log:HockeyEvidenceSource[],
  now:number):Promise<T|null>{
  try{
    const data=await getFeed<T>(url,fetcher)
    log.push({url,status:data==null?'missing':'verified',checkedAt:new Date(now).toISOString()})
    return data
  }catch(e){
    log.push({url,status:'error',checkedAt:new Date(now).toISOString(),
      error:e instanceof Error?e.message.slice(0,160):'Error desconocido'})
    return null
  }
}
function parseTeam(v:unknown){
  const x=o(v),teamAbbrev=abbr(x.abbrev)
  const full=[localized(x.placeName),localized(x.commonName)].filter(Boolean).join(' ')
  return{id:id(x.id),abbrev:teamAbbrev,name:localized(x.name)||full||teamAbbrev}
}
function parseGame(v:unknown):HockeyFixture|null{
  const g=o(v),home=parseTeam(g.homeTeam),away=parseTeam(g.awayTeam)
  const gameId=id(g.id),date=txt(g.startTimeUTC,45)
  if(!gameId||!home.id||!away.id||!home.abbrev||!away.abbrev||
    !Number.isFinite(Date.parse(date)))return null
  return{id:gameId,date,state:txt(g.gameState,18),season:txt(g.season,12),
    home,away,venue:localized(g.venue)||'Estadio no verificado'}
}
export async function nhlSlate(date:string,fetcher:typeof fetch=fetch,now=Date.now()):
  Promise<{date:string;games:HockeyFixture[];sources:HockeyEvidenceSource[];globalCoverage:false}>{
  if(!validHockeyDate(date))throw Error('Fecha NHL inválida')
  const sources:HockeyEvidenceSource[]=[]
  const result=await source<unknown>('https://api-web.nhle.com/v1/score/'+date,fetcher,sources,now)
  const games=arr(o(result).games).flatMap(v=>{const g=parseGame(v);return g?[g]:[]})
  const unique=new Map(games.map(g=>[g.id,g]))
  return{date,games:[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date)),
    sources,globalCoverage:false}
}
function teamRoster(v:unknown,team:string):HockeyPlayer[]{
  const players=new Map<string,HockeyPlayer>()
  for(const [field,role] of [
    ['forwards','forward'],['defensemen','defense'],['goalies','goalie']
  ] as const){
    for(const item of arr(o(v)[field])){
      const p=o(item),playerId=id(p.id)
      const name=[localized(p.firstName),localized(p.lastName)].filter(Boolean).join(' ')
      if(!playerId||!name)continue
      players.set(playerId,{id:playerId,team,name,role,stats:{},last5:[],starterConfirmed:false})
    }
  }
  return[...players.values()]
}
function observedStats(v:unknown):Record<string,string>{
  const fields=['gamesPlayed','goals','assists','points','shots','shootingPctg','savePctg',
    'goalsAgainstAvg','wins','losses','timeOnIcePerGame','powerPlayGoals',
    'powerPlayPoints','blockedShotAttempts','plusMinus']
  const result:Record<string,string>={}
  const queue=[v],limit=90
  for(let i=0;i<queue.length&&i<limit;i++){
    const item=o(queue[i])
    for(const field of fields)if(item[field]!==undefined&&result[field]===undefined){
      const x=item[field]
      if(typeof x==='number'||typeof x==='string')result[field]=txt(x,24)
    }
    for(const field of ['featuredStats','regularSeason','subSeason','seasonTotals',
      'summary','stats','stat','skaterStats','goalieStats']){
      const x=item[field]
      if(x&&typeof x==='object'&&queue.length<limit)queue.push(x)
    }
  }
  return result
}
const standingRecord=(x:unknown)=>{
  const p=o(x),w=p.wins,l=p.losses,ot=p.otLosses
  return typeof w==='number'&&typeof l==='number'?
    String(w)+' V · '+String(l)+' D · '+String(ot??'—')+' OT':'Sin verificar'
}
function quotedMarkets(game:HockeyFixture,quotes:MarketOutcome[],now:number):HockeyMarket[]{
  return quotes.filter(q=>{
    const dt=Date.parse(q.timeIso??q.time),updated=Date.parse(q.updatedAt)
    return q.sportKey==='icehockey_nhl'&&
      normalize(q.home)===normalize(game.home.name)&&
      normalize(q.away)===normalize(game.away.name)&&
      Number.isFinite(dt)&&Math.abs(dt-Date.parse(game.date))<=3_600_000&&
      Number.isFinite(updated)&&updated<=now&&now-updated<=3_600_000&&
      q.price>1&&Number.isFinite(q.price)&&!!q.bookmaker.trim()
  }).slice(0,30).map(q=>({bookmaker:q.bookmaker,market:q.market,
    selection:q.selection,point:q.point??null,odds:q.price,updatedAt:q.updatedAt,
    verifiedEvent:true as const,approved:false as const,
    reason:'Portero titular, reglas 60min/OT/SO y ventaja sobre cuota pendientes'}))
}
function dashboard(d:Omit<HockeyDossier,'uiBlock'>):HockeyDossier['uiBlock']{
  const sections:HockeyDossier['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,24)})
  }
  add('Porteros · titulares no confirmados',[
    ...d.goalieCandidates.home,...d.goalieCandidates.away].map(p=>({
      label:p.team+' · '+p.name,value:'Candidato en roster (no confirmado)',
      detail:Object.entries(p.stats).map(([k,v])=>k+': '+v).slice(0,6).join(' · ')||
        'Estadísticas no disponibles'})))
  add('Tabla NHL',[{label:d.fixture.home.name,value:d.standings.home},
    {label:d.fixture.away.name,value:d.standings.away}])
  add('Skaters y rendimiento',[
    ...d.players.home.filter(p=>p.role!=='goalie').slice(0,11),
    ...d.players.away.filter(p=>p.role!=='goalie').slice(0,11)].map(p=>({
      label:p.team+' · '+p.name,value:p.role,
      detail:Object.entries(p.stats).map(([k,v])=>k+': '+v).slice(0,6).join(' · ')||
        'Estadísticas sin verificar'})))
  add('Posibles duelos contra porteros',d.possibleMatchups.slice(0,20).map(m=>({
    label:m.attacker,value:m.againstGoalies.join(', ')||'Portero sin verificar',
    detail:'Candidatos, no matchup o líneas confirmadas'})))
  add('Escenarios por períodos',d.scenarios.map((v,i)=>({
    label:'Período '+(i+1),value:v})))
  add('Cuotas verificadas por evento',d.markets.map(m=>({
    label:m.bookmaker+' · '+m.market+' '+m.selection,
    value:String(m.odds)+(m.point===null?'':' · '+m.point),detail:m.reason})))
  add('Datos aún pendientes',d.missingEvidence.map(v=>({label:v,value:'Sin confirmar'})))
  return{component:'sports_espn_dashboard',version:1,props:{
    view:'event',title:'PHOENIX NHL · '+d.fixture.away.name+' vs '+d.fixture.home.name,
    subtitle:'3 × 20 minutos · porteros NO confirmados',
    source:'NHL Web API público',checkedAt:d.checkedAt,sections,
    note:'Investigación descriptiva; no predicción calibrada ni ticket aprobado. '+
      'Moneyline puede incluir OT/SO, pero 3-way regulation se liquida a los 60 minutos.'}}
}
/** Investigate only a future NHL game ID appearing in official same-day slate. */
export async function investigateNhl(date:string,gameId:string,fetcher:typeof fetch=fetch,
  now=Date.now(),quotes:MarketOutcome[]=[],maxSkaters=8):Promise<HockeyDossier>{
  if(!id(gameId)||!Number.isSafeInteger(maxSkaters)||maxSkaters<1||maxSkaters>15)
    throw Error('Juego o límite de jugadores inválido')
  const slate=await nhlSlate(date,fetcher,now),fixture=slate.games.find(g=>g.id===gameId)
  if(!fixture)throw Error('NHL gameId no aparece en la cartelera real de la fecha')
  if(!['FUT','PRE'].includes(fixture.state)||Date.parse(fixture.date)<=now)
    throw Error('El expediente pregame necesita juego futuro sin iniciar')
  const sources=slate.sources,base='https://api-web.nhle.com/v1/'
  const [h,a,standings]=await Promise.all([
    source<unknown>(base+'roster/'+fixture.home.abbrev+'/current',fetcher,sources,now),
    source<unknown>(base+'roster/'+fixture.away.abbrev+'/current',fetcher,sources,now),
    source<unknown>(base+'standings/'+date,fetcher,sources,now),
  ])
  const players={home:teamRoster(h,fixture.home.abbrev),
    away:teamRoster(a,fixture.away.abbrev)}
  const selected=[...(['home','away'] as const).flatMap(side=>{
    const team=players[side]
    return[...team.filter(p=>p.role==='goalie').slice(0,3),
      ...team.filter(p=>p.role==='forward').slice(0,maxSkaters),
      ...team.filter(p=>p.role==='defense').slice(0,4)]
  })]
  let next=0
  await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
    while(next<selected.length){
      const p=selected[next++]!
      const data=await source<unknown>(base+'player/'+p.id+'/landing',fetcher,sources,now)
      p.stats=observedStats(data)
      p.last5=arr(o(data).last5Games).slice(0,5).map(v=>({
        date:txt(o(v).gameDate,20),goals:txt(o(v).goals,8),
        assists:txt(o(v).assists,8),shots:txt(o(v).shots,8)}))
    }
  }))
  const goalies={home:players.home.filter(p=>p.role==='goalie'),
    away:players.away.filter(p=>p.role==='goalie')}
  const rows=arr(o(standings).standings).map(o)
  const find=(code:string)=>rows.find(x=>localized(x.teamAbbrev)===code)
  const viewStandings={home:standingRecord(find(fixture.home.abbrev)),
    away:standingRecord(find(fixture.away.abbrev))}
  const possibleMatchups=[
    ...players.home.filter(p=>p.role==='forward').slice(0,10).map(p=>({
      attackerId:p.id,attacker:p.name,againstGoalies:goalies.away.map(x=>x.name),
      source:'roster-only' as const})),
    ...players.away.filter(p=>p.role==='forward').slice(0,10).map(p=>({
      attackerId:p.id,attacker:p.name,againstGoalies:goalies.home.map(x=>x.name),
      source:'roster-only' as const}))]
  const missingEvidence=[
    'Ningún portero confirmado por una fuente de alineación o morning skate',
    'Líneas 1–4 y parejas defensivas sin evidencia de shifts',
    '5v5 xG, calidad de tiros, GSAx y cara a cara reales sin fuente autorizada',
    'Power play y penalty kill por unidad no verificados',
    'Lesiones, scratches y suspensiones sin reporte oficial reciente',
    'Fatiga de cada portero, viajes y descansos sin historial de cargas completo',
    'Liquidación 60 min, OT y shootout depende de las reglas de cada casa',
    ...(!h||!a?['Uno o ambos rosters oficiales no disponibles']:[])]
  const scenarios=[
    'P1: contrastar portero confirmado, tiros 5v5, forecheck y ritmo de cambios.',
    'P2: analizar unidades reales PP/PK, tiros de alto peligro y fatiga defensiva.',
    'P3: empty-net, goalie pulled, empate a 60, OT y shootout según torneo y casa.']
  const markets=quotedMarkets(fixture,quotes,now)
  const ready=players.home.length>=10&&players.away.length>=10&&
    goalies.home.length>0&&goalies.away.length>0
  const dossier:Omit<HockeyDossier,'uiBlock'>={fixture,checkedAt:new Date(now).toISOString(),
    sources,players,goalieCandidates:goalies,possibleMatchups,standings:viewStandings,
    markets,scenarios,missingEvidence,
    opportunity:{sport:'hockey',league:'nhl',eventId:fixture.id,
      decision:ready?'investigate':'abstain',eligibleForTicket:false,
      calibratedProbability:false}}
  return{...dossier,uiBlock:dashboard(dossier)}
}
