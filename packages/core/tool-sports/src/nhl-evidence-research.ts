/** Evidence-first NHL specialist. Official rosters are never confirmed lines/goalies.
 * Odds do not imply a calibrated forecast or a bet approved for a ticket.
 */
import {getFeed,type MarketOutcome} from './sports.ts'
import {recoverEspnRoster} from './espn-public-roster.ts'
import {parseNhlSeasonGameLog,type NhlGameHistory,type NhlGameSplits} from './nhl-player-game-history.ts'
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
  stats:Record<string,string>;last5:Array<{date:string;summary:string}>;
  starterConfirmed:false;idProvider?:'NHL'|'ESPN';
  /** NHL athlete ID only, never ESPN ID: up to 20 regular-season games. */
  last20?:NhlGameHistory[];homeRoadSplits?:NhlGameSplits}
export type HockeyEvidenceSource={url:string;status:'verified'|'missing'|'error';checkedAt:string;
  error?:string}
export type HockeyMarket={bookmaker:string;market:string;selection:string;point:number|null;
  odds:number;updatedAt:string;verifiedEvent:true;approved:false;reason:string}
export type HockeyTeamForm={games:number;wins:number;losses:number;
  homeGames:number;awayGames:number;restHours:number|null;
  last10:Array<{date:string;opponent:string;goalsFor:number;goalsAgainst:number}>}
export type NhlSpecialTeamsSide={powerPlayPct:number|null;penaltyKillPct:number|null}
export type NhlSpecialTeams={
  home:NhlSpecialTeamsSide;away:NhlSpecialTeamsSide
  complete:boolean;source:'NHL Stats REST';checkedAt:string
}
export type HockeyDossier={fixture:HockeyFixture;checkedAt:string;sources:HockeyEvidenceSource[];
  specialTeams:NhlSpecialTeams;
  players:{home:HockeyPlayer[];away:HockeyPlayer[]};
  goalieCandidates:{home:HockeyPlayer[];away:HockeyPlayer[]};
  possibleMatchups:Array<{attackerId:string;attacker:string;againstGoalies:string[];source:'roster-only'}>;
  standings:{home:string;away:string};form:{home:HockeyTeamForm|null;away:HockeyTeamForm|null};markets:HockeyMarket[];
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
/** Only league-reported percentages count; shots, roster entries and goals
 * do NOT substitute for PP/PK or for private 5v5 xG / GSAx.
 */
export function parseNhlSpecialTeams(
  fixture:Pick<HockeyFixture,'home'|'away'>,
  powerplay:unknown,penaltykill:unknown,now=Date.now(),
):NhlSpecialTeams{
  const metric=(payload:unknown,teamId:string,names:readonly string[]):number|null=>{
    const record=arr(o(payload).data).map(o).find(item=>id(item.teamId)===teamId)
    if(!record)return null
    for(const name of names){
      const value=record[name]
      if(typeof value!=='string'&&typeof value!=='number')continue
      const numeric=Number(value)
      if(!Number.isFinite(numeric)||numeric<0||numeric>100)continue
      return Number((numeric<=1?numeric*100:numeric).toFixed(2))
    }
    return null
  }
  const side=(teamId:string):NhlSpecialTeamsSide=>({
    powerPlayPct:metric(powerplay,teamId,['powerPlayPct','ppPct']),
    penaltyKillPct:metric(penaltykill,teamId,['penaltyKillPct','pkPct']),
  })
  const home=side(fixture.home.id),away=side(fixture.away.id)
  return{home,away,complete:[
    home.powerPlayPct,home.penaltyKillPct,
    away.powerPlayPct,away.penaltyKillPct,
  ].every(value=>value!==null),source:'NHL Stats REST',
    checkedAt:new Date(now).toISOString()}
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
      players.set(playerId,{id:playerId,team,name,role,stats:{},last5:[],starterConfirmed:false,idProvider:'NHL'})
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

function formFromSchedule(data:unknown,game:HockeyFixture,teamAbbr:string):HockeyTeamForm|null{
  if(!data)return null
  const cutoff=Date.parse(game.date)
  const found=arr(o(data).games).flatMap(v=>{
    const r=o(v),date=txt(r.startTimeUTC??r.gameDate,45)
    const timestamp=Date.parse(date.length===10?date+'T12:00:00Z':date)
    if(!Number.isFinite(timestamp)||timestamp>=cutoff||
      !['OFF','FINAL'].includes(txt(r.gameState,15)))return []
    const home=o(r.homeTeam),away=o(r.awayTeam)
    const isHome=abbr(home.abbrev)===teamAbbr
    const isAway=abbr(away.abbrev)===teamAbbr
    if(!isHome&&!isAway)return []
    const scored=Number(isHome?home.score:away.score)
    const conceded=Number(isHome?away.score:home.score)
    if(!Number.isSafeInteger(scored)||!Number.isSafeInteger(conceded))return []
    return[{date,stamp:timestamp,isHome,
      opponent:isHome?abbr(away.abbrev):abbr(home.abbrev),
      goalsFor:scored,goalsAgainst:conceded}]
  }).sort((a,b)=>b.stamp-a.stamp).slice(0,10)
  if(!found.length)return null
  const last=found[0]
  return{games:found.length,wins:found.filter(x=>x.goalsFor>x.goalsAgainst).length,
    losses:found.filter(x=>x.goalsFor<x.goalsAgainst).length,
    homeGames:found.filter(x=>x.isHome).length,
    awayGames:found.filter(x=>!x.isHome).length,
    restHours:last?Math.max(0,(cutoff-last.stamp)/3_600_000):null,
    last10:found.map(x=>({date:x.date,opponent:x.opponent,
      goalsFor:x.goalsFor,goalsAgainst:x.goalsAgainst}))}
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
        'Estadísticas no disponibles'+(p.last5.length?' · reciente: '+p.last5[0]?.summary:'')+
        (p.last20?.length?' · historial oficial '+p.last20.length+' partidos':'')+
        (p.homeRoadSplits?.home?' · local '+p.homeRoadSplits.home.games+' encuentros':'')+
        (p.homeRoadSplits?.away?' · visita '+p.homeRoadSplits.away.games+' encuentros':'')})))
  add('Unidades especiales · estadísticas oficiales NHL',
    (['home','away'] as const).map(side=>{
      const team=d.fixture[side],v=d.specialTeams[side]
      return{label:team.name,value:
        'PP '+(v.powerPlayPct===null?'no verificado':v.powerPlayPct+'%')+
        ' · PK '+(v.penaltyKillPct===null?'no verificado':v.penaltyKillPct+'%'),
        detail:'NHL Stats REST · temporada de este encuentro; no es xG ni predicción'}
    }))
  add('Tabla NHL',[{label:d.fixture.home.name,value:d.standings.home},
    {label:d.fixture.away.name,value:d.standings.away}])
  add('Últimos partidos y descanso',(['home','away'] as const).map(side=>{
    const form=d.form[side],name=d.fixture[side].name
    return{label:name,value:form?form.wins+'V '+form.losses+'D en '+form.games+' juegos':
      'Historial sin verificar',detail:form?'Local '+form.homeGames+' · Visitante '+
      form.awayGames+' · descanso '+(form.restHours===null?'sin datos':
        form.restHours.toFixed(1)+' horas'):'Calendario del club no disponible'}
  }))
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
  const season=/^\d{8}$/u.test(fixture.season)?fixture.season:null
  const statsQuery=season?'?cayenneExp='+encodeURIComponent(
    'seasonId='+season+' and gameTypeId=2')+'&limit=100':null
  const stats='https://api.nhle.com/stats/rest/en/team/'
  const [h,a,standings,homeSchedule,awaySchedule,pp,pk]=await Promise.all([
    source<unknown>(base+'roster/'+fixture.home.abbrev+'/current',fetcher,sources,now),
    source<unknown>(base+'roster/'+fixture.away.abbrev+'/current',fetcher,sources,now),
    source<unknown>(base+'standings/'+date,fetcher,sources,now),
    source<unknown>(base+'club-schedule-season/'+fixture.home.abbrev+'/now',fetcher,sources,now),
    source<unknown>(base+'club-schedule-season/'+fixture.away.abbrev+'/now',fetcher,sources,now),
    statsQuery?source<unknown>(stats+'powerplay'+statsQuery,fetcher,sources,now):Promise.resolve(null),
    statsQuery?source<unknown>(stats+'penaltykill'+statsQuery,fetcher,sources,now):Promise.resolve(null),
  ])
  const specialTeams=parseNhlSpecialTeams(fixture,pp,pk,now)
  const players={home:teamRoster(h,fixture.home.abbrev),
    away:teamRoster(a,fixture.away.abbrev)}
  // An unavailable NHL Web API roster does not mean there are no players.
  // Match BOTH sides and kickoff against the ESPN day scoreboard before
  // resolving the corresponding ESPN team IDs. Never reuse NHL IDs as ESPN IDs.
  if(!players.home.length||!players.away.length){
    const day=validHockeyDate(date)?date.replaceAll('-',''):''
    const espnBoard=await source<unknown>(
      'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates='+day,
      fetcher,sources,now)
    const same=(a:string,b:string)=>normalize(a)===normalize(b)
    const candidates=arr(o(espnBoard).events).map(o).filter(event=>{
      const gameTime=Date.parse(txt(event.date,55))
      const competition=o(arr(event.competitions)[0])
      const teams=arr(competition.competitors).map(o)
      const home=teams.find(x=>x.homeAway==='home')
      const away=teams.find(x=>x.homeAway==='away')
      const hName=txt(o(home?.team).displayName??o(home?.team).name)
      const aName=txt(o(away?.team).displayName??o(away?.team).name)
      return id(event.id)&&Number.isFinite(gameTime)&&
        Math.abs(gameTime-Date.parse(fixture.date))<=90*60_000&&
        same(hName,fixture.home.name)&&same(aName,fixture.away.name)
    })
    if(candidates.length===1){
      const competitors=arr(o(arr(candidates[0]!.competitions)[0]).competitors).map(o)
      for(const side of ['home','away'] as const){
        if(players[side].length)continue
        const row=competitors.find(x=>x.homeAway===side)
        const team=o(row?.team),teamId=id(team.id)
        if(!teamId)continue
        const recovered=await recoverEspnRoster('hockey','nhl',
          {id:teamId,name:fixture[side].name},
          url=>source<unknown>(url,fetcher,sources,now))
        players[side]=recovered.people.map(p=>({
          id:p.id,name:p.name,team:fixture[side].abbrev,
          role:/^g$/iu.test(p.position)?'goalie' as const:
            /^d$/iu.test(p.position)?'defense' as const:'forward' as const,
          stats:{},last5:[],starterConfirmed:false as const,idProvider:'ESPN' as const,
        }))
      }
    }
  }
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
      // ESPN and NHL player IDs belong to different namespaces.
      if(p.idProvider==='ESPN')continue
      const [data,history]=await Promise.all([
        source<unknown>(base+'player/'+p.id+'/landing',fetcher,sources,now),
        // NHL Web is the supported source for game logs; the ESPN NHL
        // Common-v3 /gamelog often returns HTTP 404.
        season?source<unknown>(
          base+'player/'+p.id+'/game-log/'+season+'/2',fetcher,sources,now):
          Promise.resolve(null),
      ])
      p.stats=observedStats(data)
      const official=parseNhlSeasonGameLog(history,Math.min(now,Date.parse(fixture.date)),20)
      p.last20=official.games
      p.homeRoadSplits=official.splits
      // Preserve a full official game history if present. Landing's last5 is
      // a truthful fallback when season-level game logs are empty/blocked.
      p.last5=official.games.length?official.games.slice(0,5).map(x=>({
        date:x.date,summary:x.summary,
      })):arr(o(data).last5Games).slice(0,5).map(v=>{
        const r=o(v),goalie=p.role==='goalie'
        const fields=goalie?['shotsAgainst','saves','savePctg','goalsAgainst','decision']:
          ['goals','assists','shots','timeOnIce']
        return{date:txt(r.gameDate,20),summary:fields.map(key=>key+': '+txt(r[key],15))
          .filter(text=>!text.endsWith(': ')).join(' · ')}
      })
      if(season&&history&&!official.games.length){
        sources.push({url:base+'player/'+p.id+'/game-log/'+season+'/2',
          status:'missing',checkedAt:new Date(now).toISOString(),
          error:'La respuesta no contiene partidos individuales verificables'})
      }
    }
  }))
  const goalies={home:players.home.filter(p=>p.role==='goalie'),
    away:players.away.filter(p=>p.role==='goalie')}
  const rows=arr(o(standings).standings).map(o)
  const find=(code:string)=>rows.find(x=>localized(x.teamAbbrev)===code)
  const viewStandings={home:standingRecord(find(fixture.home.abbrev)),
    away:standingRecord(find(fixture.away.abbrev))}
  const form={home:formFromSchedule(homeSchedule,fixture,fixture.home.abbrev),
    away:formFromSchedule(awaySchedule,fixture,fixture.away.abbrev)}
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
    ...(!specialTeams.complete?[
      'Power play y penalty kill oficiales: faltan porcentajes PP/PK de uno o ambos equipos',
    ]:[]),
    'Lesiones, scratches y suspensiones sin reporte oficial reciente',
    'Fatiga individual de porteros, desplazamientos y carga de turnos sin fuente completa',
    'Liquidación 60 min, OT y shootout depende de las reglas de cada casa',
    ...(!players.home.length||!players.away.length?['Uno o ambos rosters NHL/ESPN no disponibles']:[]),
    ...(players.home.some(p=>p.idProvider==='ESPN')||players.away.some(p=>p.idProvider==='ESPN')?
      ['Rosters recuperados de ESPN: membresía observada, pero IDs ESPN no son IDs NHL y no acreditan líneas/porteros titulares']:[])]
  const scenarios=[
    'P1: contrastar portero confirmado, tiros 5v5, forecheck y ritmo de cambios.',
    'P2: analizar unidades reales PP/PK, tiros de alto peligro y fatiga defensiva.',
    'P3: empty-net, goalie pulled, empate a 60, OT y shootout según torneo y casa.']
  const markets=quotedMarkets(fixture,quotes,now)
  const ready=players.home.length>=10&&players.away.length>=10&&
    goalies.home.length>0&&goalies.away.length>0
  const dossier:Omit<HockeyDossier,'uiBlock'>={fixture,checkedAt:new Date(now).toISOString(),
    sources,players,goalieCandidates:goalies,possibleMatchups,standings:viewStandings,form,
    specialTeams,markets,scenarios,missingEvidence,
    opportunity:{sport:'hockey',league:'nhl',eventId:fixture.id,
      decision:ready?'investigate':'abstain',eligibleForTicket:false,
      calibratedProbability:false}}
  return{...dossier,uiBlock:dashboard(dossier)}
}
