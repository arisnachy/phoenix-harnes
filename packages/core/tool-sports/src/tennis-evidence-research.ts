/** PHOENIX ATP/WTA pre-match evidence: exact player IDs and match competition,
 * source status, surface-aware research questions; never synthetic odds or Elo.
 */
import {getFeed,hasSportsPermission,type MarketOutcome} from './sports.ts'
type Obj=Record<string,unknown>
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const text=(v:unknown,n=130):string=>typeof v==='string'||typeof v==='number'?
  String(v).replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,n):''
const digits=(v:unknown)=>/^\d{1,18}$/u.test(String(v??''))?String(v):''
const key=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export type TennisTour='atp'|'wta'
export type TennisSource={url:string;status:'observed'|'missing'|'error';checkedAt:string;error?:string}
export type TennisPlayer={id:string;name:string;seed:string|null;ranking:number|null}
export type TennisMatch={tour:TennisTour;eventId:string;matchId:string;start:string;
  tournament:string;round:string;surface:string|null;bestOf:3|5|null;
  state:'pre'|'in'|'post'|'unknown';format:'singles'|'doubles'|'unknown';
  players:[TennisPlayer,TennisPlayer]}
export type TennisMetric={name:string;value:string}
export type TennisAthleteResearch={player:TennisPlayer;profileAvailable:boolean;
  statistics:TennisMetric[];lastMatches:Array<{date:string;result:string;opponent:string}>;
  verifiedAt:string}
export type TennisMarket={bookmaker:string;market:string;selection:string;
  point:number|null;price:number;updatedAt:string;eligibleForTicket:false;
  concerns:string[]}
export type TennisDossier={match:TennisMatch;checkedAt:string;sources:TennisSource[];
  players:[TennisAthleteResearch,TennisAthleteResearch];markets:TennisMarket[];
  tacticalQuestions:string[];missingEvidence:string[];
  coverage:{level:'A'|'B'|'C'|'D';surfaceObserved:boolean;
    rankCount:number;advancedStatsPlayers:number;markets:number};
  opportunity:{sport:'tennis';tour:TennisTour;eventId:string;matchId:string;
    decision:'investigate'|'abstain';eligibleForTicket:false;
    calibratedProbability:false;positiveFacts:string[];contraryFacts:string[]};
  uiBlock:{component:'sports_espn_dashboard';version:1;props:{
    view:'event';title:string;subtitle:string;source:string;checkedAt:string;
    sections:Array<{heading:string;kind:'list';items:Array<{label:string;value:string;
      detail?:string}>}>;note:string}}
}
const rawDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/u.test(v)&&
  Number.isFinite(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export const validTennisDate=rawDate
async function read<T>(url:string,fetcher:typeof fetch,sources:TennisSource[],
  now:number):Promise<T|null>{
  try{const v=await getFeed<T>(url,fetcher)
    sources.push({url,status:v==null?'missing':'observed',
      checkedAt:new Date(now).toISOString()})
    return v}
  catch(e){sources.push({url,status:'error',
    checkedAt:new Date(now).toISOString(),
    error:(e instanceof Error?e.message:'Fuente no disponible').slice(0,160)})
    return null}
}
function parsePlayer(raw:unknown):TennisPlayer|null{
  const c=obj(raw),p=obj(c.athlete)
  const athlete=Object.keys(p).length?p:obj(c.player)
  const person=Object.keys(athlete).length?athlete:c
  const playerId=digits(person.id??c.id)
  const name=text(person.displayName??person.fullName??person.name??c.displayName,110)
  if(!playerId||!name)return null
  const seed=text(c.seed??person.seed,12)||null
  const rankValue=person.rank??c.rank
  const rank=Number(rankValue)
  const ranking=rankValue!==null&&rankValue!==undefined&&
    Number.isSafeInteger(rank)&&rank>0?rank:null
  return{id:playerId,name,seed,ranking}
}
function surfaceText(raw:unknown):string|null{
  const r=obj(raw),v=r.name??r.displayName??r.type??r.description??
    r.surface??raw
  if(typeof v!=='string')return null
  const s=text(v,35)
  // Only use explicit names; never infer surface from event or city.
  return /^(hard|clay|grass|carpet|indoor hard|outdoor hard|red clay|green clay|synthetic)$/iu.test(s)?
    s:null
}
function parseMatch(event:unknown,comp:unknown,tour:TennisTour,
  multiple:boolean):TennisMatch|null{
  const e=obj(event),c=obj(comp),participants=arr(c.competitors).map(parsePlayer)
  if(participants.length!==2||!participants[0]||!participants[1]||
    participants[0].id===participants[1].id)return null
  const matchId=digits(c.id??(multiple?null:e.id)),eventId=digits(e.id)
  // On a tournament scoreboard, event.date may be the tournament start,
  // not the match start. Require match-level clock for nested competitions.
  const scheduled=text(c.date??(multiple?null:e.date),46)
  if(!matchId||!eventId||!Number.isFinite(Date.parse(scheduled)))return null
  const cs=text(obj(obj(c.status).type).state,20)
  const es=text(obj(obj(e.status).type).state,20)
  const state=cs||es
  const competitionType=obj(c.type)
  const round=text(c.round??competitionType.text??competitionType.abbreviation??
    obj(c.notes).headline,90)||'Ronda no verificada'
  const surface=surfaceText(c.surface)||surfaceText(e.surface)||
    surfaceText(obj(e.venue).surface)
  const rawBest=c.bestOf??obj(c.format).bestOf??null
  const bestOf=rawBest===3||rawBest===5?rawBest:null
  const names=[participants[0].name,participants[1].name]
  const format: TennisMatch['format']=
    c.typeOfMatch==='doubles'||names.some(v=>v.includes('/'))?'doubles':
      c.typeOfMatch==='singles'?'singles':'unknown'
  const tournament=text(e.name??e.displayName??obj(e.tournament).displayName,110)||
    'Torneo sin identificar'
  return{tour,eventId,matchId,start:scheduled,tournament,round,surface,
    bestOf,state:state==='pre'?'pre':state==='in'?'in':state==='post'?'post':'unknown',
    format,players:[participants[0],participants[1]]}
}
export async function tennisSlate(tour:TennisTour,date:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env):
  Promise<{tour:TennisTour;date:string;matches:TennisMatch[];sources:TennisSource[];
    missingMatchClocks:number}>{
  if(tour!=='atp'&&tour!=='wta')throw Error('Circuito de tenis inválido')
  if(!rawDate(date))throw Error('Fecha de tenis inválida')
  if(!hasSportsPermission('espn',env))throw Error('Fuente deportiva ESPN deshabilitada')
  const sources:TennisSource[]=[]
  const url='https://site.api.espn.com/apis/site/v2/sports/tennis/'+tour+
    '/scoreboard?dates='+date.replaceAll('-','')
  const data=await read<unknown>(url,fetcher,sources,now)
  const matches:TennisMatch[]=[],seen=new Set<string>()
  let missingMatchClocks=0
  for(const raw of arr(obj(data).events)){
    const event=obj(raw),competitions=arr(event.competitions)
    for(const comp of competitions){
      const match=parseMatch(raw,comp,tour,competitions.length>1)
      if(!match){
        if(arr(obj(comp).competitors).length===2)missingMatchClocks++
        continue
      }
      const identity=match.eventId+':'+match.matchId
      if(!seen.has(identity)){seen.add(identity);matches.push(match)}
    }
  }
  return{tour,date,matches:matches.sort((a,b)=>a.start.localeCompare(b.start)),
    sources,missingMatchClocks}
}
const ACCEPTED=new Set(['aces','doubleFaults','firstServePercentage',
  'firstServePct','firstServePointsWon','secondServePointsWon',
  'breakPointsSaved','breakPointsConverted','serviceGamesWon',
  'returnPointsWon','wins','losses','titles','matchesPlayed',
  'rankingPoints','points','serveRating','returnRating',
  'tiebreaksWon','tiebreaksPlayed','firstServesIn',
  'breakPointsWon','breakPointsFaced'])
function metrics(raw:unknown):TennisMetric[]{
  const found=new Map<string,string>()
  const queue:Array<{v:unknown;depth:number}>=[{v:raw,depth:0}]
  let scanned=0
  while(queue.length&&scanned++<115&&found.size<28){
    const x=queue.shift()!,r=obj(x.v)
    if(x.depth>5)continue
    for(const [k,v] of Object.entries(r)){
      if(ACCEPTED.has(k)&&(typeof v==='number'||typeof v==='string')){
        const value=text(v,30)
        if(value)found.set(k,value)
      }
      if(v&&typeof v==='object'&&x.depth<5&&
        !['athlete','headshot','team','teams','events','competitions'].includes(k)){
        for(const nested of Array.isArray(v)?v.slice(0,8):[v])
          queue.push({v:nested,depth:x.depth+1})
      }
    }
  }
  return[...found].map(([name,value])=>({name,value}))
}
function pastMatches(raw:unknown,playerId:string,start:number){
  return arr(obj(raw).events).flatMap(v=>{
    const e=obj(v),when=Date.parse(text(e.date,45))
    const st=obj(obj(e.status).type)
    if(!Number.isFinite(when)||when>=start||
      (st.state!=='post'&&st.completed!==true))return []
    const players=arr(obj(arr(e.competitions)[0]).competitors).map(obj)
    const me=players.find(c=>digits(obj(c.athlete).id??c.id)===playerId)
    const against=players.find(c=>digits(obj(c.athlete).id??c.id)!==playerId)
    if(!me||!against)return []
    const won=me.winner===true?'W':me.winner===false?'L':'No verificado'
    const opponent=text(obj(against.athlete).displayName??against.displayName,110)
    return[{date:text(e.date,40),result:won,opponent}]
  }).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10)
}
function reviewedQuotes(match:TennisMatch,quotes:MarketOutcome[],now:number):TennisMarket[]{
  const expected=new Set(match.players.map(x=>key(x.name)))
  return quotes.filter(q=>{
    const start=Date.parse(q.timeIso??q.time),updated=Date.parse(q.updatedAt)
    const sides=new Set([key(q.home),key(q.away)])
    // Tennis quote orientation is arbitrary, but both players must match.
    return q.sportKey==='tennis_'+match.tour&&expected.size===2&&
      expected.size===sides.size&&[...expected].every(x=>sides.has(x))&&
      Number.isFinite(start)&&Math.abs(start-Date.parse(match.start))<=3_600_000&&
      Number.isFinite(updated)&&updated<=now&&now-updated<=3_600_000&&
      Number.isFinite(q.price)&&q.price>1&&!!q.bookmaker.trim()
  }).slice(0,35).map(q=>({
    bookmaker:q.bookmaker,market:q.market,selection:q.selection,
    point:q.point??null,price:q.price,updatedAt:q.updatedAt,
    eligibleForTicket:false as const,
    concerns:['La cuota no demuestra ventaja sobre la línea',
      'Superficie, formato, lesión/retiro y reglas de abandono requieren confirmación',
      'No intercambiar mercados ATP/WTA, sets, juegos y ganador'] }))
}
function dashboard(d:Omit<TennisDossier,'uiBlock'>):TennisDossier['uiBlock']{
  const sections:TennisDossier['uiBlock']['props']['sections']=[]
  const add=(heading:string,items:Array<{label:string;value:string;detail?:string}>)=>{
    if(items.length)sections.push({heading,kind:'list',items:items.slice(0,24)})}
  add('Partido y superficie',[{label:d.match.tournament,value:d.match.round,
    detail:'Superficie: '+(d.match.surface??'no verificada')+
      ' · formato: '+(d.match.bestOf?'mejor de '+d.match.bestOf:'sin verificar')}])
  add('Jugadores',d.players.map(x=>({label:x.player.name,
    value:x.player.ranking?'Ranking observado: '+x.player.ranking:'Ranking sin verificar',
    detail:'ID '+x.player.id+(x.player.seed?' · sembrado '+x.player.seed:'')+
      ' · métricas: '+x.statistics.length})))
  add('Servicio, devolución y forma',d.players.flatMap(x=>[
    ...x.statistics.slice(0,9).map(m=>({label:x.player.name+' · '+m.name,value:m.value})),
    ...x.lastMatches.slice(0,5).map(m=>({label:x.player.name+' · '+m.opponent,
      value:m.result,detail:m.date}))]))
  add('Investigación del enfrentamiento',d.tacticalQuestions.map((x,i)=>({
    label:'Cuestión '+(i+1),value:x})))
  add('Cuotas encontradas',d.markets.map(q=>({
    label:q.bookmaker+' · '+q.market+' '+q.selection,
    value:q.price.toFixed(2)+(q.point===null?'':' · línea '+q.point),
    detail:q.concerns[0]??'Requiere revisión'})))
  add('Datos pendientes',d.missingEvidence.map(s=>({label:s,value:'Por verificar'})))
  return{component:'sports_espn_dashboard',version:1,props:{
    view:'event',title:'PHOENIX Tennis · '+d.match.tour.toUpperCase()+' · '+
      d.match.players[0].name+' vs '+d.match.players[1].name,
    subtitle:d.match.tournament+' · '+d.match.round,
    source:'ESPN público',checkedAt:d.checkedAt,sections,
    note:'El ranking, superficie, H2H y cuotas se muestran solo cuando están observados. '+
      'La ficha no proporciona probabilidad calibrada ni apuesta aprobada.'}}
}
export async function investigateTennis(tour:TennisTour,date:string,matchId:string,
  fetcher:typeof fetch=fetch,now=Date.now(),env:NodeJS.ProcessEnv=process.env,
  quotes:MarketOutcome[]=[]):Promise<TennisDossier>{
  if(!digits(matchId))throw Error('ID de partido de tenis inválido')
  const slate=await tennisSlate(tour,date,fetcher,now,env)
  const match=slate.matches.find(x=>x.matchId===matchId)
  if(!match)throw Error('Partido no aparece en la cartelera ATP/WTA verificada')
  if(match.state!=='pre'||Date.parse(match.start)<=now)
    throw Error('Análisis prepartido exige un encuentro futuro no iniciado')
  const sources=slate.sources
  const site='https://site.api.espn.com/apis/site/v2/sports/tennis/'+tour+'/'
  const profiles=await Promise.all(match.players.map(async player=>{
    const root=site+'athletes/'+player.id
    const [profile,stats,eventlog]=await Promise.all([
      read<unknown>(root,fetcher,sources,now),
      read<unknown>(root+'/statistics',fetcher,sources,now),
      read<unknown>(root+'/eventlog',fetcher,sources,now),
    ])
    const playerStats=metrics(stats??profile)
    const form=pastMatches(eventlog,player.id,Date.parse(match.start))
    const athlete=obj(obj(profile).athlete)
    const rankingRaw=athlete.rank??obj(profile).rank
    const rank=Number(rankingRaw)
    return{player:{...player,ranking:player.ranking??(
      rankingRaw!==undefined&&rankingRaw!==null&&Number.isSafeInteger(rank)&&rank>0?rank:null)},
      profileAvailable:!!profile,statistics:playerStats,lastMatches:form,
      verifiedAt:new Date(now).toISOString()}
  }))
  const players=[profiles[0]!,profiles[1]!] as [TennisAthleteResearch,TennisAthleteResearch]
  const markets=reviewedQuotes(match,quotes,now)
  const rankCount=players.filter(x=>x.player.ranking!==null).length
  const advancedStatsPlayers=players.filter(x=>x.statistics.some(y=>
    /serve|break|return|aces|doublefault/iu.test(y.name))).length
  const missingEvidence=[
    ...(!match.surface?['Superficie del torneo no verificada']:[]),
    ...(!match.bestOf?['Formato y reglas de sets/tiebreak sin verificar']:[]),
    ...(!match.format||match.format==='unknown'?['Singles/doubles no verificados']:[]),
    ...(!players[0].profileAvailable?['Perfil del primer jugador no disponible']:[]),
    ...(!players[1].profileAvailable?['Perfil del segundo jugador no disponible']:[]),
    ...(!players[0].lastMatches.length||!players[1].lastMatches.length?
      ['Forma reciente y calidad de oponentes sin historial consistente']:[]),
    ...(!rankCount?['Rankings verificables ausentes']:[]),
    ...(!markets.length?['Sin cuotas actuales coincidentes del mercado ATP/WTA']:[]),
    'H2H real por superficie y condiciones indoor/outdoor sin fuente suficiente',
    'Lesiones, horas de juego recientes, viajes y climatología del court no confirmados',
    'Puntos de servicio/devolución por superficie y break points requieren datos oficiales comparables',
    'Ruleset de retiro/walkover, doubles match-tiebreak y liquidación de casa pendientes',
    'Sin modelo predictivo calibrado fuera de muestra ni evidencia de valor de mercado',
  ]
  const level:TennisDossier['coverage']['level']=
    rankCount===2&&advancedStatsPlayers===2&&!!match.surface&&
      markets.length>0&&players.every(x=>x.lastMatches.length>=3)?'B':
    players.some(x=>x.statistics.length>0||x.profileAvailable)?'C':'D'
  const tacticalQuestions=[
    '¿El primer y segundo servicio del jugador A resisten la devolución del jugador B en esta superficie?',
    '¿El servicio B permite opciones de break al restador A? Verificar punto por punto y muestra.',
    '¿Cómo afectaron superficie, últimos minutos en pista y rivales recientes a ambos jugadores?',
    '¿Qué cambian viento, indoor/outdoor, formato y lesiones? No confundir partidos a 3 y 5 sets.',
    '¿La línea del bookmaker compensa la incertidumbre o conviene abstenerse?',
  ]
  const report:Omit<TennisDossier,'uiBlock'>={match,checkedAt:new Date(now).toISOString(),
    sources,players,markets,tacticalQuestions,missingEvidence,
    coverage:{level,surfaceObserved:!!match.surface,rankCount,
      advancedStatsPlayers,markets:markets.length},
    opportunity:{sport:'tennis',tour,eventId:match.eventId,matchId:match.matchId,
      decision:level==='B'?'investigate':'abstain',eligibleForTicket:false,
      calibratedProbability:false,
      positiveFacts:['Identidades de ambos jugadores y horario verificados en un evento del tour'],
      contraryFacts:['Sin H2H y condiciones específicas suficientes no se declara favorito rentable',
        'Reglas de retiros, superficies y mercados pueden cambiar la conclusión']}}
  return{...report,uiBlock:dashboard(report)}
}
