/** Research-first NBA/WNBA dossiers: evidence, athletes, lineups, rotations, opponents and prices.
 * No fabricated scores, probabilities, athlete participation or betting recommendations.
 */
import {type MarketOutcome} from './sports.ts'
import {collectDirectEspnStats,type DirectTeam} from './sports-direct-stats.ts'
import {readHistoricalScoreboard} from './sports-historical-scoreboard.ts'
import {discoverEditorialResearch} from './sports-editorial-discovery.ts'
import {basketballSlate,basketballRead,record,values,label,id,teamKey,regulationMinutes,
  type BasketballFixture,type BasketballLeague,type BasketballSource} from './basketball-research-core.ts'
export type BasketballEvidence={key:string;value:string;source:string;observedAt:string}
export type BasketballAthlete={id:string;name:string;teamId:string;position:string;
  status:'verified'|'partial'|'unavailable';confirmedStarter:boolean;
  stats:Array<{name:string;value:string}>;
  lastGames:Array<{name:string;value:string}>;
  splits:Array<{name:string;value:string}>}
export type BasketballDuel={attackerId:string;attacker:string;teamId:string;
  opponents:Array<{id:string;name:string;position:string}>;
  note:string;missing:string[]}
export type BasketballMarket={bookmaker:string;market:string;selection:string;line:number|null;
  odds:number;updatedAt:string;argumentsFor:string[];argumentsAgainst:string[];
  unknowns:string[];settlementQuestions:string[];status:'research-only'}
export type BasketballCase={
  fixture:BasketballFixture;checkedAt:string;league:BasketballLeague;regulationMinutes:40|48;
  teams:Record<'home'|'away',{id:string;name:string;record:string|null;
    lastGames:Array<{eventId:string;date:string;opponent:string;
      pts:number;allowed:number;location:'home'|'away'}>;
    wins:number;losses:number;homeRecord:string;awayRecord:string;
    roster:BasketballAthlete[];teamStats:Array<{name:string;value:string}>;
    quintetConfirmed:boolean;sourceCoverage:DirectTeam['coverage']}>;
  matchups:BasketballDuel[];injuries:Array<{teamId:string;name:string;playerId:string;
    status:string;source:string}>;
  context:{h2h:{games:number;homeWins:number;awayWins:number};
    restHours:{home:number|null;away:number|null};
    shortRestUnder48h:{home:boolean|null;away:boolean|null}};
  referee:string|null;venue:string;news:Array<{headline:string;published:string;
    source:string}>;editorial:Array<{headline:string;publisher:string;date:string|null;
    verifiedPick:false}>;
  scenarios:string[];markets:BasketballMarket[];missingEvidence:string[];
  sources:BasketballSource[];
  coverage:{level:'A'|'B'|'C'|'D';notes:string[];players:number;
    starters:number;formGames:number;quotes:number;advancedMetrics:boolean};
  opportunity:{version:1;sport:'basketball';league:BasketballLeague;
    eventId:string;scheduledAt:string;decision:'investigate'|'abstain';
    eligibleForTicket:false;probabilitiesCalculated:false;argumentsFor:string[];
    argumentsAgainst:string[];missingEvidence:string[]};
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{
    view:'event';title:string;subtitle:string;source:string;checkedAt:string;
    sections:Array<{heading:string;kind:'list'|'metrics'|'articles';
      items:Array<{label:string;value:string;detail?:string}>}>;note:string}}
}
const amount=(v:unknown):number|null=>{
  if(v===null||v===undefined||v==='')return null
  if(typeof v!=='string'&&typeof v!=='number')return null
  const n=Number(v);return Number.isFinite(n)?n:null
}
function recentGames(raw:unknown,fixture:BasketballFixture,teamId:string){
  const cutoff=Date.parse(fixture.start)
  const out:Array<{eventId:string;date:string;opponent:string;pts:number;
    allowed:number;location:'home'|'away'}>=[]
  for(const x of values(record(raw).events)){
    const e=record(x),d=Date.parse(label(e.date))
    const status=record(record(e.status).type)
    if(!Number.isFinite(d)||d>=cutoff||(status.state!=='post'&&status.completed!==true))continue
    const participants=values(record(values(e.competitions)[0]).competitors).map(record)
    const me=participants.find(t=>id(record(t.team).id)===teamId)
    const other=participants.find(t=>id(record(t.team).id)!==teamId)
    if(!me||!other||!['home','away'].includes(label(me.homeAway)))continue
    const pts=amount(me.score),allowed=amount(other.score)
    if(pts===null||allowed===null||pts<0||allowed<0)continue
    out.push({eventId:id(e.id),date:label(e.date,45),
      opponent:label(record(other.team).displayName),pts,allowed,
      location:me.homeAway as 'home'|'away'})
  }
  return out.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20)
}
function confirmedStarters(summary:unknown,teamId:string,roster:BasketballAthlete[]){
  const root=record(summary),box=record(root.boxscore)
  const groups=[...values(root.rosters),...values(root.lineups),...values(box.players)]
  const group=groups.map(record).find(g=>id(record(g.team).id)===teamId)
  if(!group)return false
  // An athlete with minutes in a boxscore was not necessarily a starter.
  const marked=values(group.roster??group.players??group.athletes).map(record)
    .filter(x=>x.starter===true||x.starting===true||x.isStarter===true)
    .map(x=>id(record(x.athlete).id??x.id)).filter(Boolean)
  const ids=new Set(marked)
  if(ids.size!==5||roster.filter(p=>ids.has(p.id)).length!==5)return false
  for(const p of roster)if(ids.has(p.id))p.confirmedStarter=true
  return true
}
function resolvePlayers(team:DirectTeam):BasketballAthlete[]{
  return team.athletes.map(x=>({id:x.id,name:x.name,teamId:team.id,
    position:x.position,status:x.status,confirmedStarter:false,
    stats:x.stats,lastGames:x.lastGames,splits:x.splits}))
}
const category=(position:string)=>{
  const p=position.toUpperCase()
  if(/^(PG|SG|G|GUARD)$/u.test(p))return'guard'
  if(/^(SF|PF|F|FORWARD)$/u.test(p))return'wing'
  if(/^(C|CENTER)$/u.test(p))return'center'
  return'unknown'
}
function matchup(a:BasketballAthlete[],b:BasketballAthlete[]):BasketballDuel[]{
  return a.filter(x=>x.confirmedStarter).length===5?
    a.filter(x=>x.confirmedStarter).map(attacker=>{
      const same=b.filter(p=>category(p.position)===category(attacker.position))
      const opponents=(same.length?same:b).slice(0,10)
      return{attackerId:attacker.id,attacker:attacker.name,teamId:attacker.teamId,
        opponents:opponents.map(x=>({id:x.id,name:x.name,position:x.position})),
        note:'Hipótesis de duelo por rol; cambios, switches y segunda unidad alteran el defensor.',
        missing:['Asignación defensiva directa no confirmada',
          'Quintetos y minutos de esta rotación requieren seguimiento de juego',
          'On/off y posesiones 5-on-5 avanzadas no verificadas en este módulo'] }
    }):[]
}
function verifyOdds(event:BasketballFixture,quotes:MarketOutcome[],now:number,
  facts:string[],missing:string[]):BasketballMarket[]{
  return quotes.filter(q=>{
    const kickoff=Date.parse(q.timeIso??q.time),update=Date.parse(q.updatedAt)
    return teamKey(q.home)===teamKey(event.home.name)&&
      teamKey(q.away)===teamKey(event.away.name)&&
      Number.isFinite(kickoff)&&Math.abs(kickoff-Date.parse(event.start))<3_600_000&&
      Number.isFinite(update)&&update<=now&&now-update<=3_600_000&&
      Number.isFinite(q.price)&&q.price>1&&q.bookmaker.trim().length>0
  }).slice(0,40).map(q=>{
    const full=(q.market+' '+q.selection).toLowerCase()
    const playerProp=/player|points|rebounds|assists|threes|pra|blocks|steals/u.test(full)
    const period=/q1|q2|q3|q4|1h|2h|quarter|half/u.test(full)
    const integer=(q.point!==null&&q.point!==undefined&&Number.isInteger(q.point))
    return{bookmaker:q.bookmaker,market:q.market,selection:q.selection,line:q.point??null,
      odds:q.price,updatedAt:q.updatedAt,argumentsFor:facts.slice(0,8),
      argumentsAgainst:['La forma reciente y el quinteto no garantizan superar esta línea',
        'Ritmo, faltas, blowout y cambios de minutos pueden invalidar la tesis'],
      unknowns:[...missing.slice(0,6),'Reglas exactas de esta casa no verificadas',
        ...(playerProp?['ID del jugador del prop y disponibilidad requieren cotejo']:[])],
      settlementQuestions:[
        period?'¿Se liquida exclusivamente el cuarto/mitad anunciado?':
          '¿El mercado de partido incluye puntos anotados en prórroga?',
        ...(integer?['¿Marcador igual a línea entera genera devolución/push en este mercado?']:[]),
        ...(playerProp?['¿DNP o participación mínima generan void según la casa?']:[]),
      ],status:'research-only' as const}
  })
}
function panel(d:Omit<BasketballCase,'uiBlock'>):BasketballCase['uiBlock']{
  const sections:BasketballCase['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,30)})}
  add('Equipos y forma',(['home','away'] as const).map(s=>{
    const t=d.teams[s]
    return{label:t.name,value:t.record??'Récord no verificado',
      detail:'Últimos '+t.lastGames.length+': '+t.wins+' V · '+t.losses+' D'+
        ' · local '+t.homeRecord+' · visitante '+t.awayRecord}
  }))
  add('Quintetos y roster verificado',(['home','away'] as const).flatMap(s=>
    d.teams[s].roster.map(p=>({label:d.teams[s].name+' · '+p.name,
      value:p.confirmedStarter?'Titular oficial verificado':'Roster (no titular confirmado)',
      detail:p.position+' · '+p.stats.slice(0,3).map(f=>f.name+': '+f.value).join(' · ')+
        ' · recientes: '+p.lastGames.slice(0,2).map(f=>f.name+': '+f.value).join(' · ')}))))
  add('Descanso y enfrentamientos',[
    {label:'Descanso local',value:d.context.restHours.home===null?'No verificado':
      d.context.restHours.home.toFixed(1)+' horas',
      detail:'Intervalo inferior a 48h: '+(d.context.shortRestUnder48h.home===null?'sin datos':
        d.context.shortRestUnder48h.home?'sí':'no')},
    {label:'Descanso visitante',value:d.context.restHours.away===null?'No verificado':
      d.context.restHours.away.toFixed(1)+' horas',
      detail:'Intervalo inferior a 48h: '+(d.context.shortRestUnder48h.away===null?'sin datos':
        d.context.shortRestUnder48h.away?'sí':'no')},
    {label:'Enfrentamientos recientes',value:d.context.h2h.games+' juegos',
      detail:d.context.h2h.homeWins+' victorias locales y '+
        d.context.h2h.awayWins+' visitantes en la muestra observada'},
  ])
  add('Estadísticas de equipo',(['home','away'] as const).flatMap(side=>
    d.teams[side].teamStats.slice(0,10).map(x=>({
      label:d.teams[side].name+' · '+x.name,value:x.value,
      detail:'Estadística publicada por ESPN; verificar temporada, escala y posesiones'}))))
  add('Enfrentamientos de titulares',d.matchups.map(m=>({label:m.attacker,
    value:m.opponents.length+' posibles defensores '+m.note,
    detail:m.opponents.slice(0,5).map(x=>x.name).join(', ')})))
  add('Lesiones registradas',d.injuries.map(v=>({label:v.name,value:v.status,
    detail:v.source+' · '+v.teamId})))
  add('Noticias y voces externas',[
    ...d.news.map(v=>({label:v.headline,value:v.source,detail:v.published})),
    ...d.editorial.map(v=>({label:v.headline,value:v.publisher,
      detail:'Titular indexado; no pronóstico confirmado'}))])
  add('Escenarios del partido',d.scenarios.map((v,i)=>({
    label:['Q1','Q2 y segunda unidad','Q3-Q4 y clutch','Riesgos de rotación'][i]??'Otro',
    value:v})))
  add('Mercados observados',d.markets.slice(0,10).map(q=>({
    label:q.bookmaker+' · '+q.market+' '+q.selection,
    value:q.odds.toFixed(2)+(q.line===null?'':' · línea '+q.line),
    detail:q.argumentsAgainst[0]??'Requiere revisión'})))
  add('Pendientes de evidencia',d.missingEvidence.slice(0,18).map(x=>({label:x,value:'Pendiente'})))
  return{component:'sports_espn_dashboard',version:1,props:{
    view:'event',title:'PHOENIX · '+d.league.toUpperCase()+' Intelligence · '+
      d.fixture.away.name+' vs '+d.fixture.home.name,
    subtitle:d.regulationMinutes+' minutos · cobertura '+d.coverage.level,
    source:'ESPN público · fuentes secundarias identificadas',
    checkedAt:d.checkedAt,sections,
    note:'Expediente descriptivo y verificable. No asegura quintetos, lesiones o cuotas cuando faltan. '+
      'No representa predicción calibrada ni recomendación de apuesta.'}}
}
export async function researchBasketballCase(league:BasketballLeague,date:string,eventId:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[],maxPlayers=15):Promise<BasketballCase>{
  if(!id(eventId))throw Error('ID de partido no verificable')
  if(!Number.isInteger(maxPlayers)||maxPlayers<1||maxPlayers>20)
    throw Error('Límite de jugadores inválido')
  const board=await basketballSlate(league,date,fetcher,now,env)
  const fixture=board.games.find(x=>x.eventId===eventId)
  if(!fixture)throw Error('Partido NBA/WNBA no identificado en cartelera oficial')
  if(fixture.status!=='pre'||Date.parse(fixture.start)<=now)
    throw Error('No se admite expediente prepartido para encuentro comenzado o de estado incierto')
  const root='https://site.api.espn.com/apis/site/v2/sports/basketball/'+league+'/'
  const sources=board.sources
  const day0=Date.parse(date+'T12:00:00Z')
  const [summary,historyReport,injuriesData,newsData,players]=await Promise.all([
    basketballRead<unknown>(root+'summary?event='+eventId,fetcher,sources,now),
    readHistoricalScoreboard(root,new Date(day0-42*86_400_000).toISOString().slice(0,10),
      new Date(day0-86_400_000).toISOString().slice(0,10),
      url=>basketballRead<{events?:unknown[]}>(url,fetcher,sources,now),
      [fixture.home.id,fixture.away.id]),
    basketballRead<unknown>(root+'injuries',fetcher,sources,now),
    basketballRead<unknown>(root+'news?limit=30',fetcher,sources,now),
    collectDirectEspnStats('basketball',league,[
      {id:fixture.home.id,name:fixture.home.name},{id:fixture.away.id,name:fixture.away.name}
    ],fetcher,now,maxPlayers),
  ])
  const history={events:historyReport.events}
  const build=(side:'home'|'away')=>{
    const team=fixture[side],raw=players.teams.find(t=>t.id===team.id)
    const roster=raw?resolvePlayers(raw):[]
    const games=recentGames(history,fixture,team.id)
    const win=games.filter(g=>g.pts>g.allowed).length
    const lose=games.filter(g=>g.pts<g.allowed).length
    const home=games.filter(g=>g.location==='home'),away=games.filter(g=>g.location==='away')
    const fmt=(g:typeof games)=>g.filter(x=>x.pts>x.allowed).length+'-'+
      g.filter(x=>x.pts<x.allowed).length
    return{id:team.id,name:team.name,record:team.record,lastGames:games,
      wins:win,losses:lose,homeRecord:fmt(home),awayRecord:fmt(away),
      roster,teamStats:raw?.stats??[],quintetConfirmed:confirmedStarters(summary,team.id,roster),
      sourceCoverage:raw?.coverage??[]}
  }
  const teams={home:build('home'),away:build('away')}
  const injuryGroups=values(record(injuriesData).injuries)
  const injuries=injuryGroups.flatMap(x=>{
    const group=record(x),tid=id(record(group.team).id??group.id)
    const side=tid===fixture.home.id?teams.home:tid===fixture.away.id?teams.away:null
    if(!side)return []
    return values(group.injuries??group.items).flatMap(y=>{
      const entry=record(y),pid=id(record(entry.athlete).id??entry.athleteId)
      const athlete=side.roster.find(p=>p.id===pid)
      const status=label(entry.status??entry.description)
      return athlete&&status?[{teamId:side.id,name:athlete.name,playerId:pid,
        status,source:'ESPN injury feed · no confirma último reporte oficial'}]:[]
    })
  }).slice(0,30)
  const news=values(record(newsData).articles).flatMap(raw=>{
    const n=record(raw),headline=label(n.headline,180),description=label(n.description,280)
    if(!headline||![teams.home.name,teams.away.name].some(name=>
      teamKey(headline+' '+description).includes(teamKey(name))))return []
    return[{headline,published:label(n.published,60),source:'ESPN News · titular público'}]
  }).slice(0,16)
  const editorial=await discoverEditorialResearch(fixture.home.name+' '+
    fixture.away.name,['covers','vegasinsider'],fetcher,now)
  const headings=editorial.hits.map(x=>({headline:x.headline,publisher:x.publisher,
    date:x.publishedAt,verifiedPick:false as const}))
  const rest=(side:'home'|'away')=>{
    const games=teams[side].lastGames
    const mostRecent=games[0]
    return mostRecent?Math.max(0,(Date.parse(fixture.start)-Date.parse(mostRecent.date))/3_600_000):null
  }
  const restHours={home:rest('home'),away:rest('away')}
  const headToHead=teams.home.lastGames.filter(g=>
    teamKey(g.opponent)===teamKey(teams.away.name))
  const context={restHours,
    shortRestUnder48h:{home:restHours.home===null?null:restHours.home<48,
      away:restHours.away===null?null:restHours.away<48},
    h2h:{games:headToHead.length,homeWins:headToHead.filter(g=>g.pts>g.allowed).length,
      awayWins:headToHead.filter(g=>g.pts<g.allowed).length}}
  const matchups=[...matchup(teams.home.roster,teams.away.roster),
    ...matchup(teams.away.roster,teams.home.roster)]
  const summaryInfo=record(record(summary).gameInfo)
  const referee=label(record(values(summaryInfo.officials)[0]).displayName)||null
  const missing=[
    ...(!teams.home.quintetConfirmed?['Quinteto titular local no confirmado']:[]),
    ...(!teams.away.quintetConfirmed?['Quinteto titular visitante no confirmado']:[]),
    ...(!teams.home.roster.length?['Roster y estadísticas locales no accesibles']:[]),
    ...(!teams.away.roster.length?['Roster y estadísticas visitantes no accesibles']:[]),
    ...(historyReport.status!=='verified'?['Cobertura ESPN histórica parcial: '+historyReport.explanation]:[]),
    ...(!teams.home.lastGames.length?['Historial reciente local no verificado']:[]),
    ...(!teams.away.lastGames.length?['Historial reciente visitante no verificado']:[]),
    ...(!injuriesData?['Estado de lesionados sin fuente verificable']:[]),
    ...(!referee?['Crew arbitral no verificado']:[]),
    'Quintetos 5-on-5, on/off, Four Factors y tracking de posesiones no verificados en este expediente',
    'Minutos/restricciones, reporte médico oficial y matchups defensivos reales necesitan contraste',
    'Precio no demuestra ventaja: falta validación probabilística fuera de muestra',
    'Reglas exactas del sportsbook, DNP, prórroga y liquidación no verificadas',
  ]
  const facts=[
    ...(teams.home.lastGames.length?['Forma de '+teams.home.name+': '+teams.home.wins+
      'V y '+teams.home.losses+'D en '+teams.home.lastGames.length+' partidos']:[]),
    ...(teams.away.lastGames.length?['Forma de '+teams.away.name+': '+teams.away.wins+
      'V y '+teams.away.losses+'D en '+teams.away.lastGames.length+' partidos']:[]),
    ...(teams.home.quintetConfirmed&&teams.away.quintetConfirmed?
      ['Quintetos de ambos equipos confirmados con IDs verificados']:[]),
    ...(context.restHours.home!==null&&context.restHours.away!==null?
      ['Descanso observado: local '+context.restHours.home.toFixed(1)+' h, visitante '+
        context.restHours.away.toFixed(1)+' h']:[]),
  ]
  const markets=verifyOdds(fixture,quotes,now,facts,missing)
  const count=teams.home.roster.length+teams.away.roster.length
  const starters=[...teams.home.roster,...teams.away.roster].filter(p=>p.confirmedStarter).length
  const formGames=teams.home.lastGames.length+teams.away.lastGames.length
  const hasAdvanced=(stats:Array<{name:string;value:string}>)=>{
    const names=stats.map(x=>x.name.toLowerCase())
    return names.some(x=>/offensive.*rating|offrtg/u.test(x))&&
      names.some(x=>/defensive.*rating|defrtg/u.test(x))&&
      names.some(x=>/pace|possessions/u.test(x))
  }
  const advancedMetrics=hasAdvanced(teams.home.teamStats)&&hasAdvanced(teams.away.teamStats)
  const coverageLevel:BasketballCase['coverage']['level']=
    count>=20&&starters===10&&formGames>=6&&markets.length>0&&
      advancedMetrics?'A':
    count>=14&&formGames>=4?'B':count>0||formGames>0?'C':'D'
  const coverage={level:coverageLevel,notes:[
    'Calidad de cobertura, no precisión de predicción',
    'La fuente de lesiones ESPN puede estar desactualizada frente al reporte oficial',
    'Estadísticas por 100 posesiones solo cuando proveedor las entrega con definición'],
    players:count,starters,formGames,quotes:markets.length,
    advancedMetrics}
  const scenarios=[
    'Q1: comparar titulares, ritmo real por '+regulationMinutes(league)+' minutos y ataques contra coberturas rivales.',
    'Q2: estudiar creación y rebote cuando descansan estrellas; no asumir minutos sin rotación verificada.',
    'Q3-Q4: considerar cambios tácticos, faltas, clutch y blowout; OT solo en mercados que lo incluyan.',
    'Un reporte médico nuevo, cinco titulares distintos o una cuota caducada invalida la lectura original.',
  ]
  const opportunity={version:1 as const,sport:'basketball' as const,league,eventId,scheduledAt:fixture.start,
    decision:coverageLevel==='A'||coverageLevel==='B'?'investigate' as const:'abstain' as const,
    eligibleForTicket:false as const,probabilitiesCalculated:false as const,
    argumentsFor:facts,argumentsAgainst:[
      'Forma previa no garantiza victoria ni cobertura del spread',
      'Rotaciones/lesiones pueden alterar significativamente posesiones y minutos',
    ],missingEvidence:missing}
  const result:Omit<BasketballCase,'uiBlock'>={fixture,checkedAt:new Date(now).toISOString(),
    league,regulationMinutes:regulationMinutes(league) as 40|48,
    teams,context,matchups,injuries,referee,venue:fixture.venue,news,editorial:headings,
    scenarios,markets,missingEvidence:missing,sources,coverage,opportunity}
  return{...result,uiBlock:panel(result)}
}
