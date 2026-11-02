/** Evidence-first soccer dossier. No fabricated scores, probabilities, players or lineups. */
import {hasSportsPermission,type MarketOutcome} from './sports.ts'
import {discoverEditorialResearch} from './sports-editorial-discovery.ts'
import {array,clean,digits,normalize,row,soccerDailySlate,soccerDate,soccerSlug,
  sourceRead,type SoccerFixture,type SoccerSource} from './soccer-worldwide-scout.ts'

type Fact={label:string;value:string}
export type SoccerAthlete={id:string;name:string;teamId:string;position:string;jersey:string;
  confirmedStarter:boolean;facts:Fact[]}
type Result={date:string;homeAway:'home'|'away';opponent:string;scored:number;allowed:number}
export type SoccerTeam={id:string;name:string;roster:SoccerAthlete[];recent:Result[];
  record:string[];form:{wins:number;draws:number;losses:number;homeWdl:string;awayWdl:string}|null}
export type SoccerDuel={playerId:string;attacker:string;againstTeam:string;
  opponents:Array<{id:string;name:string;position:string}>;limitations:string[]}
export type SoccerMarketReview={bookmaker:string;market:string;selection:string;
  point:number|null;decimalOdds:number;updatedAt:string;positiveFacts:string[];
  contradictoryFacts:string[];missingEvidence:string[];questions:string[];
  approved:false}
export type SoccerDossier={fixture:SoccerFixture;checkedAt:string;
  teams:{home:SoccerTeam;away:SoccerTeam};sourceReport:SoccerSource[];
  lineupConfirmed:{home:boolean;away:boolean};
  teamStatistics:Fact[];injuries:Array<{team:string;playerId:string;name:string;status:string}>;
  headlines:Array<{title:string;published:string;source:string}>;
  editorial:Array<{title:string;published:string|null;publisher:string;verifiedPick:false}>;
  referee:string|null;stadium:string;weather:{temperatureC:number|null;windKmh:number|null;
    rainChance:number|null;time:string}|null;
  duels:SoccerDuel[];scenarios:string[];markets:SoccerMarketReview[];
  missingEvidence:string[];
  coverage:{level:'A'|'B'|'C'|'D';players:number;lineups:boolean;recentGames:number;quotes:number};
  opportunity:{version:1;sport:'soccer';eventId:string;league:string;scheduledAt:string;
    recommendation:'investigate'|'abstain';eligibleForTicket:false;
    probabilitiesEstimated:false;positiveFacts:string[];contradictions:string[];
    missingEvidence:string[];reason:string};
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{view:'event';
    title:string;subtitle:string;source:string;checkedAt:string;
    sections:Array<{heading:string;kind:'list'|'metrics'|'articles';
      items:Array<{label:string;value:string;detail?:string}>}>;note:string}}}
const number=(v:unknown):number|null=>{
  if(v===undefined||v===null||v==='')return null
  if(typeof v!=='number'&&typeof v!=='string')return null
  const n=Number(v);return Number.isFinite(n)?n:null
}
function facts(raw:unknown,max=12):Fact[]{
  const out:Fact[]=[],used=new Set<string>()
  const insert=(k:unknown,v:unknown)=>{
    const label=clean(k,60),value=clean(v,70)
    if(label&&value&&!used.has(label)&&out.length<max){used.add(label);out.push({label,value})}
  }
  const queue:Array<{v:unknown;depth:number}>=[{v:raw,depth:0}]
  let count=0
  while(queue.length&&count++<80&&out.length<max){
    const x=queue.shift()!,o=row(x.v),labels=array(o.labels),values=array(o.stats)
    if(labels.length===values.length)labels.forEach((k,i)=>insert(k,values[i]))
    if(o.displayName!==undefined&&o.displayValue!==undefined)insert(o.displayName,o.displayValue)
    if(x.depth>=3)continue
    for(const key of ['statistics','stats','categories','items','totals'])
      for(const v of array(o[key]).slice(0,15))queue.push({v,depth:x.depth+1})
  }
  return out
}
function players(raw:unknown,teamId:string):SoccerAthlete[]{
  const athletes=array(row(raw).athletes).flatMap(g=>{
    const entries=array(row(g).items);return entries.length?entries:[g]})
  const found=new Map<string,SoccerAthlete>()
  for(const a of athletes){
    const e=row(a),person=row(e.athlete),p=Object.keys(person).length?person:e
    const id=digits(p.id),name=clean(p.displayName??p.fullName)
    const actualTeam=digits(row(e.team).id??e.teamId)
    if(!id||!name||(actualTeam&&actualTeam!==teamId))continue
    found.set(id,{id,teamId,name,
      position:clean(row(p.position).abbreviation??row(e.position).abbreviation,24),
      jersey:clean(p.jersey,8),confirmedStarter:false,facts:facts(e,8)})
  }
  return[...found.values()].slice(0,45)
}
function verifyStartingXI(summary:unknown,teamId:string,roster:SoccerAthlete[]):boolean{
  const root=row(summary),list=[...array(root.rosters),...array(root.lineups)]
  const group=list.map(row).find(g=>digits(row(g.team).id)===teamId)
  if(!group)return false
  const ids=new Set(array(group.roster??group.players??group.athletes).map(row)
    .filter(p=>p.starter===true||p.starting===true||p.isStarter===true)
    .map(p=>digits(row(p.athlete).id??p.id)).filter(Boolean))
  if(ids.size!==11||roster.filter(p=>ids.has(p.id)).length!==11)return false
  for(const p of roster)if(ids.has(p.id))p.confirmedStarter=true
  return true
}
function recent(events:unknown[],teamId:string,cutoff:number):Result[]{
  return events.flatMap(v=>{
    const e=row(v),when=Date.parse(clean(e.date)),comp=row(array(e.competitions)[0])
    const st=row(row(e.status).type)
    if(!Number.isFinite(when)||when>=cutoff||(st.state!=='post'&&st.completed!==true))return []
    const teams=array(comp.competitors).map(row)
    const me=teams.find(x=>digits(row(x.team).id)===teamId)
    const other=teams.find(x=>digits(row(x.team).id)!==teamId)
    const scored=number(me?.score),allowed=number(other?.score)
    if(!me||!other||scored===null||allowed===null||!['home','away'].includes(clean(me.homeAway)))return []
    return[{date:clean(e.date,45),homeAway:me.homeAway as 'home'|'away',
      opponent:clean(row(other.team).displayName),scored,allowed}]
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)
}
function form(g:Result[]):SoccerTeam['form']{
  if(!g.length)return null
  const w=(a:Result[])=>a.filter(x=>x.scored>x.allowed).length
  const d=(a:Result[])=>a.filter(x=>x.scored===x.allowed).length
  const l=(a:Result[])=>a.filter(x=>x.scored<x.allowed).length
  const fmt=(a:Result[])=>[w(a),d(a),l(a)].join('-')
  return{wins:w(g),draws:d(g),losses:l(g),homeWdl:fmt(g.filter(x=>x.homeAway==='home')),
    awayWdl:fmt(g.filter(x=>x.homeAway==='away'))}
}
const role=(p:SoccerAthlete)=>{
  const code=p.position.toUpperCase()
  if(/^(F|FW|ST|CF|LW|RW|LF|RF)$/u.test(code))return'attack'
  if(/^(D|DF|DEF|CB|LB|RB|LWB|RWB)$/u.test(code))return'defense'
  if(/^(G|GK|GKP)$/u.test(code))return'goalkeeper'
  return'unknown'
}
function duels(a:SoccerTeam,b:SoccerTeam):SoccerDuel[]{
  const defensives=b.roster.filter(p=>['defense','goalkeeper'].includes(role(p)))
  return a.roster.filter(p=>role(p)==='attack').slice(0,14).map(p=>({
    playerId:p.id,attacker:p.name,againstTeam:b.name,
    opponents:defensives.slice(0,14).map(x=>({id:x.id,name:x.name,position:x.position})),
    limitations:['Rostering no confirma enfrentamiento directo ni titularidad',
      'Faltan xG/tiros por 90, táctica y minutos contra estos rivales']}))
}
function compareQuotes(g:SoccerFixture,quotes:MarketOutcome[],now:number,
  evidence:string[],missing:string[]):SoccerMarketReview[]{
  return quotes.filter(q=>{
    const t=Date.parse(q.timeIso??q.time),at=Date.parse(q.updatedAt)
    return normalize(q.home)===normalize(g.home.name)&&
      normalize(q.away)===normalize(g.away.name)&&
      Number.isFinite(t)&&Math.abs(t-Date.parse(g.scheduledAt))<3600000&&
      Number.isFinite(at)&&at<=now&&now-at<=3600000&&
      !!q.bookmaker.trim()&&Number.isFinite(q.price)&&q.price>1
  }).slice(0,30).map(q=>{
    const m=(q.market+' '+q.selection).toLowerCase()
    return{bookmaker:q.bookmaker,market:q.market,selection:q.selection,
      point:q.point??null,decimalOdds:q.price,updatedAt:q.updatedAt,
      positiveFacts:evidence.slice(0,6),
      contradictoryFacts:['Sin evidencia de probabilidad calibrada no puede inferirse valor esperado',
        'Lesiones, alineaciones, táctica y árbitro pueden alterar el partido'],
      missingEvidence:[...missing.slice(0,6),'Reglas reales de la casa para este mercado'],
      questions:[...(/1x2|h2h|winner/u.test(m)?
        ['¿Se liquida en 90 minutos más añadido con empate o incluye clasificación?']:[]),
        ...(/total|over|under/u.test(m)?
        ['¿La línea es entera, media o asiática de cuarto? ¿Push o media pérdida?']:[]),
        '¿El mercado y las cuotas siguen vigentes en esta casa?'],
      approved:false as const}
  })
}
function view(d:Omit<SoccerDossier,'uiBlock'>):SoccerDossier['uiBlock']{
  const sections:SoccerDossier['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,22)})
  }
  add('Forma y localía',(['home','away'] as const).map(side=>{
    const t=d.teams[side],f=t.form
    return{label:t.name,value:f?[f.wins+'V',f.draws+'E',f.losses+'D'].join(' '):'Datos no disponibles',
      detail:f?'Local '+f.homeWdl+' · Visitante '+f.awayWdl+' · últimos '+t.recent.length:
        'Resultados previos sin verificar'}
  }))
  add('Once y plantilla',(['home','away'] as const).flatMap(side=>d.teams[side].roster
    .slice(0,15).map(p=>({label:p.name,value:p.confirmedStarter?'Titular confirmado':
      'Roster, titularidad pendiente',detail:d.teams[side].name+' · '+p.position+
      ' · '+p.facts.slice(0,2).map(f=>f.label+': '+f.value).join(' · ')}))))
  add('Duelos ofensivos y defensivos',d.duels.slice(0,16).map(m=>({
    label:m.attacker+' vs '+m.againstTeam,
    value:m.opponents.length+' rivales defensivos identificados',
    detail:'Posible matchup, no duelo confirmado; necesita contexto táctico'})))
  add('Lesiones',d.injuries.map(i=>({label:i.name,value:i.status,detail:i.team+' · ID comprobado'})))
  add('Noticias y analistas',[
    ...d.headlines.map(n=>({label:n.title,value:n.source,detail:n.published})),
    ...d.editorial.map(n=>({label:n.title,value:n.publisher,
      detail:'Titular indexado: no representa pick verificado'}))])
  add('Sede, árbitro y clima',[{label:d.stadium,value:d.referee??'Árbitro pendiente',
    detail:d.weather?'Viento '+String(d.weather.windKmh??'—')+' km/h · '+
      String(d.weather.temperatureC??'—')+' °C, sin orientación del campo':
      'Pronóstico horario no confirmado'}])
  add('Escenarios',d.scenarios.map((s,i)=>({label:['Primer tiempo','Segundo tiempo',
    'Cambios e imprevistos'][i]??'Contexto',value:s})))
  add('Cuotas y sus riesgos',d.markets.slice(0,12).map(q=>({
    label:q.bookmaker+' · '+q.market+' '+q.selection,
    value:q.decimalOdds.toFixed(2)+(q.point===null?'':' · línea '+q.point),
    detail:q.contradictoryFacts[0]})))
  add('Información pendiente',d.missingEvidence.slice(0,16).map(s=>({label:s,value:'Sin verificar'})))
  return{component:'sports_espn_dashboard',version:1,props:{view:'event',
    title:'PHOENIX Soccer · '+d.fixture.away.name+' vs '+d.fixture.home.name,
    subtitle:d.fixture.league+' · Cobertura '+d.coverage.level+' · '+d.fixture.status,
    source:'ESPN público · fuentes secundarias con atribución',
    checkedAt:d.checkedAt,sections,
    note:'Investigación descriptiva; NO predicción calibrada. Ni roster ni titulares de noticias '+
      'certifican alineaciones o pronósticos externos. Cuotas solo observadas.'}}
}
/** Exact ESPN event ID from verified date and competition; future pregame only. */
export async function investigateSoccer(date:string,league:string,eventId:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[]):Promise<SoccerDossier>{
  if(!soccerDate(date)||!soccerSlug(league)||!digits(eventId))throw Error('Parámetros de fútbol inválidos')
  if(!hasSportsPermission('espn',env))throw Error('ESPN deshabilitado')
  const slate=await soccerDailySlate(date,[league],fetcher,now,env)
  const fixture=slate.games.find(x=>x.eventId===eventId)
  if(!fixture)throw Error('Evento no aparece en calendario verificado de la liga')
  if(Date.parse(fixture.scheduledAt)<=now||fixture.state==='in'||fixture.state==='post')
    throw Error('El análisis prepartido requiere un encuentro futuro y no iniciado')
  const sources=slate.sources,root='https://site.api.espn.com/apis/site/v2/sports/soccer/'+league+'/'
  const start=new Date(Date.parse(date+'T12:00:00Z')-55*86400000).toISOString().slice(0,10)
  const end=new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10)
  const [summary,history,homeRoster,awayRoster,news,injuryFeed]=await Promise.all([
    sourceRead<unknown>(root+'summary?event='+eventId,fetcher,sources,now),
    sourceRead<{events?:unknown[]}>(root+'scoreboard?dates='+start.replaceAll('-','')+
      '-'+end.replaceAll('-','')+'&limit=200',fetcher,sources,now),
    sourceRead<unknown>(root+'teams/'+fixture.home.id+'/roster',fetcher,sources,now),
    sourceRead<unknown>(root+'teams/'+fixture.away.id+'/roster',fetcher,sources,now),
    sourceRead<unknown>(root+'news?limit=30',fetcher,sources,now),
    sourceRead<unknown>(root+'injuries',fetcher,sources,now),
  ])
  const homePlayers=players(homeRoster,fixture.home.id),awayPlayers=players(awayRoster,fixture.away.id)
  const hc=verifyStartingXI(summary,fixture.home.id,homePlayers)
  const ac=verifyStartingXI(summary,fixture.away.id,awayPlayers)
  const homeGames=recent(array(history?.events),fixture.home.id,Date.parse(fixture.scheduledAt))
  const awayGames=recent(array(history?.events),fixture.away.id,Date.parse(fixture.scheduledAt))
  const comp=row(array(row(row(summary).header).competitions)[0])
  const records=(tid:string)=>array(comp.competitors).map(row).filter(x=>
    digits(row(x.team).id)===tid).flatMap(x=>array(x.records).map(r=>
    clean(row(r).summary??row(r).displayValue,45)).filter(Boolean))
  const teams={home:{id:fixture.home.id,name:fixture.home.name,roster:homePlayers,
    recent:homeGames,record:records(fixture.home.id),form:form(homeGames)},
    away:{id:fixture.away.id,name:fixture.away.name,roster:awayPlayers,
    recent:awayGames,record:records(fixture.away.id),form:form(awayGames)}}
  const teamStatistics=array(row(row(summary).boxscore).teams).flatMap(v=>{
    const e=row(v),tid=digits(row(e.team).id)
    const name=tid===fixture.home.id?fixture.home.name:
      tid===fixture.away.id?fixture.away.name:null
    return name?facts(e.statistics,20).map(f=>({...f,label:name+' · '+f.label})):[]
  })
  const injuries=array(row(injuryFeed).injuries).flatMap(v=>{
    const e=row(v),tid=digits(row(e.team).id??e.id)
    const team=tid===fixture.home.id?teams.home:tid===fixture.away.id?teams.away:null
    if(!team)return []
    return array(e.injuries??e.items).flatMap(i=>{
      const e=row(i),id=digits(row(e.athlete).id??e.athleteId)
      const player=team.roster.find(p=>p.id===id),status=clean(e.status??e.description)
      return player&&status?[{team:team.name,playerId:id,name:player.name,status}]:[]
    })
  }).slice(0,20)
  const headlines=array(row(news).articles).flatMap(v=>{
    const e=row(v),title=clean(e.headline,190),desc=clean(e.description,250)
    const candidates=[normalize(fixture.home.name),normalize(fixture.away.name)]
    return title&&candidates.some(t=>t&&normalize(title+' '+desc).includes(t))?
      [{title,published:clean(e.published,45),source:'ESPN News'}]:[]
  }).slice(0,12)
  const articles=await discoverEditorialResearch(fixture.home.name+' '+fixture.away.name,
    ['covers','vegasinsider'],fetcher,now)
  const editorial=articles.hits.map(h=>({title:h.headline,published:h.publishedAt,
    publisher:h.publisher,verifiedPick:false as const}))
  const referee=clean(row(array(row(row(summary).gameInfo).officials)[0]).displayName)||null
  const venue=row(comp.venue),address=row(venue.address)
  const lat=number(address.latitude??venue.latitude),lon=number(address.longitude??venue.longitude)
  let weather:SoccerDossier['weather']=null
  if(lat!==null&&lon!==null&&Math.abs(lat)<=90&&Math.abs(lon)<=180){
    const url='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+
      '&hourly=temperature_2m,wind_speed_10m,precipitation_probability&timezone=GMT&forecast_days=16'
    const w=await sourceRead<unknown>(url,fetcher,sources,now),hour=row(row(w).hourly)
    const target=Date.parse(fixture.scheduledAt)
    const options=array(hour.time).map((v,i)=>({i,t:clean(v,35)}))
      .map(x=>({...x,d:Math.abs(Date.parse(x.t.endsWith('Z')?x.t:x.t+'Z')-target)}))
      .filter(x=>Number.isFinite(x.d)).sort((a,b)=>a.d-b.d)
    const first=options[0]
    if(first&&first.d<=3600000){
      const n=(key:string)=>number(array(hour[key])[first.i])
      weather={time:first.t,temperatureC:n('temperature_2m'),
        windKmh:n('wind_speed_10m'),rainChance:n('precipitation_probability')}
    }
  }
  const matchups=[...duels(teams.home,teams.away),...duels(teams.away,teams.home)]
  const missing=[
    ...(!hc?['Once local no confirmado']:[]),
    ...(!ac?['Once visitante no confirmado']:[]),
    ...(!homePlayers.length?['Roster local no disponible']:[]),
    ...(!awayPlayers.length?['Roster visitante no disponible']:[]),
    ...(!homeGames.length?['Resultados recientes local no disponibles']:[]),
    ...(!awayGames.length?['Resultados recientes visitante no disponibles']:[]),
    ...(!referee?['Árbitro/estadísticas de tarjetas sin verificación']:[]),
    ...(!weather?['Clima horario no disponible']:[]),
    'xG, mapas de tiros, calidad de ocasiones y estadística de jugadores por 90 no confirmados',
    'Alineación táctica, duelos directos, córners, sanciones y descanso requieren contrastar',
    'Titulares indexados de expertos NO acreditan picks ni probabilidades reales',
    'Reglas exactas del sportsbook, incluidos 90 minutos, empate y líneas asiáticas, no verificadas',
  ]
  const positive=[
    ...(homeGames.length?['Forma de '+teams.home.name+' '+form(homeGames)?.wins+'V '+
      form(homeGames)?.draws+'E '+form(homeGames)?.losses+'D']:[]),
    ...(awayGames.length?['Forma de '+teams.away.name+' '+form(awayGames)?.wins+'V '+
      form(awayGames)?.draws+'E '+form(awayGames)?.losses+'D']:[]),
    ...(hc&&ac?['Once de ambos clubes verificado por ESPN ID']:[]),
    ...(matchups.length?['Roles ofensivos y defensivos identificados para comparación']:[]),
  ]
  const contradictory=['La forma no certifica resultados futuros',
    ...(!hc||!ac?['Rotaciones y cambios de esquema pendientes']:[]),
    'La ausencia de información avanzada limita las comparaciones de ataque y defensa']
  const markets=compareQuotes(fixture,quotes,now,positive,missing)
  const advancedVerified=teamStatistics.some(x=>/^(?:.* · )?(?:xg|xga|expected goals|expectedgoals|expected goals against)$/iu.test(x.label))
  const level:SoccerDossier['coverage']['level']=
    homePlayers.length>=11&&awayPlayers.length>=11&&hc&&ac&&homeGames.length>0&&
      awayGames.length>0&&markets.length>0&&advancedVerified?'A':
    homePlayers.length>=11&&awayPlayers.length>=11&&homeGames.length>0&&awayGames.length>0?'B':
    homePlayers.length||awayPlayers.length||homeGames.length||awayGames.length?'C':'D'
  const coverage={level,players:homePlayers.length+awayPlayers.length,lineups:hc&&ac,
    recentGames:homeGames.length+awayGames.length,quotes:markets.length}
  const scenarios=[
    'Primer tiempo: estudiar táctica probable, ataque, defensa, presiones y ocasiones con la alineación real.',
    'Segundo tiempo: estudiar profundidad de banca, minutos, fatiga y escenarios cuando el marcador es empate o ventaja.',
    'Un gol temprano, lesión, expulsión o cambio de sistema puede invalidar la lectura; separar 90 minutos de clasificación.',
  ]
  const ready=level==='A'||level==='B'
  const opportunity={version:1 as const,sport:'soccer' as const,eventId:fixture.eventId,
    league,scheduledAt:fixture.scheduledAt,
    recommendation:ready?'investigate' as const:'abstain' as const,
    eligibleForTicket:false as const,probabilitiesEstimated:false as const,
    positiveFacts:positive,contradictions:contradictory,missingEvidence:missing,
    reason:ready?'Investigación descriptiva para revisión por Kira; no acredita edge':
      'Faltan evidencias críticas del fixture, no seleccionar apuesta'}
  const result:Omit<SoccerDossier,'uiBlock'>={
    fixture,checkedAt:new Date(now).toISOString(),teams,sourceReport:sources,
    lineupConfirmed:{home:hc,away:ac},teamStatistics,injuries,headlines,editorial,
    referee,stadium:fixture.venue,weather,duels:matchups,scenarios,markets,
    missingEvidence:missing,coverage,opportunity}
  return{...result,uiBlock:view(result)}
}
