/** ESPN live scoreboard adapter for Phoenix chat.
 * Public, read-only, keyless requests from the browser: zero LLM token usage.
 * Provider responses are never rendered as HTML and never authorize remote URLs.
 */
import {useEffect,useState,type ReactNode} from 'react'
import css from './SportsLive.module.css'

const SPORTS=new Set(['baseball','basketball','football','hockey','soccer','tennis','cricket','rugby','golf','mma','racing','lacrosse','volleyball','australian-football'])
const LEAGUE_NAMES:Record<string,string>={
  'MLB':'mlb','NBA':'nba','WNBA':'wnba','NHL':'nhl','NFL':'nfl','MLS':'usa.1',
  'Premier League':'eng.1','LaLiga':'esp.1','Liga MX':'mex.1','UEFA Champions League':'uefa.champions',
  'Copa Mundial':'fifa.world','Fútbol':'usa.1',
}
type Obj=Record<string,unknown>
const object=(value:unknown):Obj=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Obj:{}
const arr=(value:unknown):Obj[]=>Array.isArray(value)?value.filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)).slice(0,60) as Obj[]:[]
const str=(value:unknown,max=160):string=>typeof value==='string'?value.slice(0,max):typeof value==='number'&&Number.isFinite(value)?String(value):''
const num=(value:unknown):number|undefined=>typeof value==='number'&&Number.isFinite(value)?value:undefined
const normalized=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-zA-Z0-9]/gu,'').toLowerCase()
const score=(v:Obj)=>str(v.score,15)||undefined
const fullTeam=(v:Obj)=>str(object(v.team).displayName)||str(object(v.team).name)
export type PhoenixLiveGame={
  id:string;home:string;away:string;homeScore?:string;awayScore?:string;
  phase:'pre'|'in'|'post';status:string;clock?:string;period?:number;
  lastPlay?:string;outs?:number;balls?:number;strikes?:number;
  bases?:[boolean,boolean,boolean];down?:string;possession?:string;
  shots?:string;leaders?:string[];periods?:Array<{label:string;away:string;home:string}>;
}
export type PhoenixLiveLookup={eventId?:string;home:{label:string};away:{label:string}}
export type PhoenixLiveMeta={updatedAt:number;stale:boolean;error:boolean;enabled:boolean}

export function espnLiveUrl(sport?:string,league?:string,date?:string):string|null{
  if(!sport||!SPORTS.has(sport)||!league)return null
  const slug=LEAGUE_NAMES[league]??league
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(slug))return null
  if(!date||!/^\d{4}-\d{2}-\d{2}$/u.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))return null
  if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return null
  return 'https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+slug+'/scoreboard?dates='+date.replaceAll('-','')
}
function fieldText(data:Obj,...keys:string[]):string{
  for(const k of keys){const v=str(data[k]);if(v)return v}return ''
}
function playsFrom(value:Obj):string|undefined{
  const play=object(value.lastPlay)
  return fieldText(play,'text','description')||fieldText(value,'lastPlayText')||undefined
}
function stat(team:Obj,names:string[]):string|undefined{
  const result=arr(team.statistics).find(v=>names.includes(str(v.name))||names.includes(str(v.abbreviation)))
  return result?str(result.displayValue??result.value,25)||undefined:undefined
}
function leadersFrom(comp:Obj):string[]{
  const categories=arr(comp.leaders)
  return categories.slice(0,3).flatMap(c=>arr(c.leaders).slice(0,1).map(v=>{
    const athlete=object(v.athlete)
    const name=fieldText(athlete,'displayName','fullName')
    return name?name+' · '+str(v.displayValue,50):''
  })).filter(Boolean).slice(0,3)
}
/** Coerces only explicitly reported ESPN fields; unknown states stay unknown. */
export function parseEspnLiveScoreboard(payload:unknown):PhoenixLiveGame[]{
  const events=arr(object(payload).events)
  return events.slice(0,50).flatMap(event=>{
    const comp=arr(event.competitions)[0]
    if(!comp)return []
    const teams=arr(comp.competitors)
    const home=teams.find(x=>x.homeAway==='home'),away=teams.find(x=>x.homeAway==='away')
    if(!home||!away)return []
    const status=object(event.status),type=object(status.type)
    const phase=type.state==='in'?'in':type.state==='post'?'post':'pre'
    const situation=object(comp.situation)
    const first=Object.hasOwn(situation,'onFirst')?Boolean(situation.onFirst):false
    const second=Object.hasOwn(situation,'onSecond')?Boolean(situation.onSecond):false
    const third=Object.hasOwn(situation,'onThird')?Boolean(situation.onThird):false
    const awayShots=stat(away,['shotsOnGoal','shots','SOG']),homeShots=stat(home,['shotsOnGoal','shots','SOG'])
    const awayPeriods=arr(away.linescores),homePeriods=arr(home.linescores)
    const periods=awayPeriods.length>0&&awayPeriods.length===homePeriods.length
      ?awayPeriods.slice(0,12).map((v,i)=>({label:String(i+1),away:str(v.displayValue??v.value,25)||'—',
          home:str(homePeriods[i]?.displayValue??homePeriods[i]?.value,25)||'—'})):[]
    return [{
      id:str(event.id,50),home:fullTeam(home),away:fullTeam(away),
      ...(score(home)?{homeScore:score(home)}:{}),...(score(away)?{awayScore:score(away)}:{}),
      phase,status:fieldText(type,'shortDetail','description','detail')||str(status.displayClock)||'Sin estado',
      ...(str(status.displayClock)?{clock:str(status.displayClock,35)}:{}),
      ...(num(status.period)!==undefined?{period:num(status.period)}:{}),
      ...(playsFrom(situation)?{lastPlay:playsFrom(situation)}:{}),
      ...(num(situation.outs)!==undefined?{outs:num(situation.outs)}:{}),
      ...(num(situation.balls)!==undefined?{balls:num(situation.balls)}:{}),
      ...(num(situation.strikes)!==undefined?{strikes:num(situation.strikes)}:{}),
      ...(Object.hasOwn(situation,'onFirst')||Object.hasOwn(situation,'onSecond')||Object.hasOwn(situation,'onThird')
        ?{bases:[first,second,third] as [boolean,boolean,boolean]}:{}),
      ...(fieldText(situation,'downDistanceText','shortDownDistanceText')?{down:fieldText(situation,'downDistanceText','shortDownDistanceText')}:{}),
      ...(str(situation.possession)?{possession:str(situation.possession,80)}:{}),
      ...(awayShots&&homeShots?{shots:awayShots+' - '+homeShots}:{}),
      ...(leadersFrom(comp).length?{leaders:leadersFrom(comp)}:{}),
      ...(periods.length?{periods}:{}),
    } satisfies PhoenixLiveGame]
  })
}
export function matchEspnGame(games:readonly PhoenixLiveGame[],match:PhoenixLiveLookup):PhoenixLiveGame|undefined{
  const home=normalized(match.home.label),away=normalized(match.away.label)
  if(!home||!away)return undefined
  // MLB Stats API gamePk and ESPN event IDs are different: validate team identities even if IDs match.
  return games.find(g=>(!match.eventId||g.id===match.eventId)
      && normalized(g.home)===home&&normalized(g.away)===away)
    ??games.find(g=>normalized(g.home)===home&&normalized(g.away)===away)
}
function enrichSummary(item:PhoenixLiveGame,data:unknown):PhoenixLiveGame{
  const root=object(data),plays=arr(root.plays)
  const last=plays.at(-1),latest=last?fieldText(last,'text','description'):undefined
  const headerCompetition=arr(object(root.header).competitions)[0]
  const situation=object(headerCompetition?.situation)
  const leaders=leadersFrom(root)
  return {...item,
    ...(item.lastPlay?{}:latest?{lastPlay:latest.slice(0,190)}:{}),
    ...(item.outs===undefined&&num(situation.outs)!==undefined?{outs:num(situation.outs)}:{}),
    ...(item.balls===undefined&&num(situation.balls)!==undefined?{balls:num(situation.balls)}:{}),
    ...(item.strikes===undefined&&num(situation.strikes)!==undefined?{strikes:num(situation.strikes)}:{}),
    ...(item.bases===undefined&&(Object.hasOwn(situation,'onFirst')||Object.hasOwn(situation,'onSecond')||Object.hasOwn(situation,'onThird'))?
      {bases:[Boolean(situation.onFirst),Boolean(situation.onSecond),Boolean(situation.onThird)] as [boolean,boolean,boolean]}:{}),
    ...(item.leaders?.length?{}:leaders.length?{leaders}:{}),
  }
}
const memo=new Map<string,{at:number;value:PhoenixLiveGame[];pending?:Promise<PhoenixLiveGame[]>}>()
async function fetchJson(url:string):Promise<unknown>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try{
    const res=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'})
    if(!res.ok)throw new Error('ESPN '+res.status)
    const length=Number(res.headers.get('content-length')??0)
    if(length>3_000_000)throw Error('ESPN payload too large')
    return await res.json() as unknown
  }finally{clearTimeout(timer)}
}
async function liveFeed(url:string):Promise<PhoenixLiveGame[]>{
  const previous=memo.get(url)
  if(previous?.pending)return previous.pending
  if(previous&&Date.now()-previous.at<18_000)return previous.value
  const promise=(async()=>{
    const scores=parseEspnLiveScoreboard(await fetchJson(url))
    // Enrich at most four running games for last play/leaders. All other games keep live scores.
    let detailed=0
    const enriched=await Promise.all(scores.map(async game=>{
      if(game.phase!=='in'||game.lastPlay||detailed>=4)return game
      detailed++
      const endpoint=new URL(url),prefix=endpoint.pathname.replace('/scoreboard','')
      try{return enrichSummary(game,await fetchJson(endpoint.origin+prefix+'/summary?event='+encodeURIComponent(game.id)))}
      catch{return game}
    }))
    memo.set(url,{at:Date.now(),value:enriched});return enriched
  })()
  memo.set(url,{at:previous?.at??0,value:previous?.value??[],pending:promise})
  try{return await promise}catch(error){
    if(previous)memo.set(url,previous);else memo.delete(url)
    throw error
  }
}
/** Shared scoped polling for the entire slate, never once per row. */
export function SportsLiveProvider({sport,league,date,children}:{
  sport?:string;league?:string;date?:string;
  children:(get:(match:PhoenixLiveLookup)=>PhoenixLiveGame|undefined,meta:PhoenixLiveMeta)=>ReactNode
}):ReactNode{
  const url=espnLiveUrl(sport,league,date)
  const [state,setState]=useState<{url:string;games:PhoenixLiveGame[];at:number;error:boolean}>({url:'',games:[],at:0,error:false})
  useEffect(()=>{
    if(!url)return
    let active=true, busy=false,lastAttempt=0
    const update=async()=>{
      if(!active||busy||typeof document!=='undefined'&&document.visibilityState==='hidden')return
      if(typeof navigator!=='undefined'&&navigator.onLine===false)return
      const cached=memo.get(url)?.value??[]
      const running=cached.some(g=>g.phase==='in')
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
      // One archival lookup is enough; completed scoreboards must not poll indefinitely.
      if(lastAttempt>0&&!running&&(date!==undefined&&date<today||cached.length>0&&cached.every(g=>g.phase==='post')))return
      const interval=running?20_000:60_000
      if(Date.now()-lastAttempt<interval)return
      lastAttempt=Date.now();busy=true
      try{const result=await liveFeed(url);if(active)setState({url,games:result,at:Date.now(),error:false})}
      catch{if(active)setState(old=>({...old,error:true}))}
      finally{busy=false}
    }
    void update()
    const timer=setInterval(()=>{void update()},10_000)
    const visible=()=>{if(document.visibilityState==='visible'){lastAttempt=0;void update()}}
    document.addEventListener('visibilitychange',visible)
    window.addEventListener('online',visible)
    return ()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',visible)}
    // Only restart when the requested sport/league/date changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[url])
  const games=state.url===url?state.games:[]
  const get=(lookup:PhoenixLiveLookup)=>matchEspnGame(games,lookup)
  return children(get,{updatedAt:state.url===url?state.at:0,error:state.url===url&&state.error,
    enabled:Boolean(url),stale:state.url!==url||!state.at||Date.now()-state.at>95_000})
}
export function SportsLiveFacts({game,meta,sport}:{game?:PhoenixLiveGame;meta:PhoenixLiveMeta;sport?:string}):ReactNode{
  if(!game||game.phase!=='in')return null
  const baseball=sport==='baseball'
  return <div className={css.liveFacts} aria-label="Situación del partido en vivo">
    <div className={css.liveHeading}><span className={css.liveDot} aria-hidden="true"/> EN VIVO · {game.status}
      <small>{meta.error||meta.stale?'Último dato recibido':'ESPN · actualización automática'}</small></div>
    {baseball&&<div className={css.liveBaseball}>
      {game.bases?<div className={css.liveDiamond} aria-label="Corredores en las bases">
        <i className={game.bases?.[1]?css.occupied:''} title="Segunda base"/>
        <i className={game.bases?.[2]?css.occupied:''} title="Tercera base"/>
        <i className={game.bases[0]?css.occupied:''} title="Primera base"/>
      </div>:<span className={css.liveStamp}>Bases sin datos</span>}
      <div className={css.liveCounts}><strong>{game.outs===undefined?'—':game.outs} outs</strong>
        <span>B {game.balls===undefined?'—':game.balls} · S {game.strikes===undefined?'—':game.strikes}</span></div>
    </div>}
    {sport==='football'&&game.down&&<strong className={css.liveDetail}>{game.down}</strong>}
    {sport==='hockey'&&game.shots&&<strong className={css.liveDetail}>Tiros a puerta · visita {game.shots.split(' - ')[0]} / local {game.shots.split(' - ')[1]}</strong>}
    {sport==='basketball'&&game.clock&&<span className={css.liveDetail}>Período {game.period??'—'} · {game.clock} restantes</span>}
    {sport==='soccer'&&game.clock&&<span className={css.liveDetail}>Reloj · {game.clock}</span>}
    {game.lastPlay&&<p className={css.livePlay}><strong>Última jugada: </strong>{game.lastPlay}</p>}
    {game.leaders?.length?<div className={css.liveLeaders}>{game.leaders.map((leader,i)=><span key={i}>{leader}</span>)}</div>:null}
    {game.periods?.length?<details className={css.livePeriods}><summary>Marcador por período</summary>
      <div>{game.periods.map(x=><span key={x.label}>{x.label}: {x.away}–{x.home}</span>)}</div></details>:null}
  </div>
}
export function SportsLiveStamp({meta}:{meta:PhoenixLiveMeta}):ReactNode{
  if(!meta.enabled)return null
  if(!meta.updatedAt)return <small className={css.liveStamp}>ESPN · {meta.error?'sin datos en vivo disponibles':'consultando marcadores…'}</small>
  return <small className={css.liveStamp}>ESPN · {meta.error||meta.stale?'sin conexión reciente · ':''}
    {new Date(meta.updatedAt).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}
  </small>
}
