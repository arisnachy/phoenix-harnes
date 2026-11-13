/** ESPN-derived pregame predictor and play-by-play win probability.
 * Never present these model estimates as bookmaker odds or PHOENIX certainty.
 */
import { useEffect,useState,type ReactNode } from 'react'
import { espnLiveSummaryUrl,type PhoenixLiveGame } from './SportsLive.tsx'
import css from './SportsWinProbability.module.css'

type Row=Record<string,unknown>
const obj=(x:unknown):Row=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Row:{}
const list=(x:unknown):Row[]=>Array.isArray(x)?x.filter(v=>v!==null&&typeof v==='object'&&!Array.isArray(v)) as Row[]:[]
const number=(x:unknown):number|null=>{
  if(typeof x!=='number'&&typeof x!=='string')return null
  if(typeof x==='string'&&!x.trim())return null
  const n=Number(x)
  return Number.isFinite(n)?n:null
}
const fraction=(x:unknown):number|null=>{
  const n=number(x)
  return n!==null&&n>=0&&n<=1?n:null
}
const percentage=(x:unknown):number|null=>{
  const n=number(x)
  return n!==null&&n>=0&&n<=100?n:null
}
const round=(x:number)=>Math.round(x*10)/10
export type WinSnapshot={home:number;away:number;draw:number|null}
export type WinSeries={snapshot:WinSnapshot;history:number[];playId?:string}

/** Summary winprobability is in fractions, not 0..100 percentages. */
export function parseEspnWinProbability(payload:unknown):WinSeries|null{
  const root=obj(payload)
  const entries=list(root.winprobability??root.items)
  const history:number[]=[]
  let snapshot:WinSnapshot|null=null,playId:string|undefined
  for(const item of entries.slice(-1500)){
    const h=fraction(item.homeWinPercentage)
    if(h===null)continue
    const tie=fraction(item.tiePercentage)
    const away=fraction(item.awayWinPercentage)
    const a=away??(1-h-(tie??0))
    if(a<0||a>1||h+a+(tie??0)>1.005)continue
    snapshot={home:round(h*100),away:round(a*100),draw:tie===null?null:round(tie*100)}
    history.push(round(h*100))
    playId=typeof item.playId==='string'?item.playId:playId
  }
  return snapshot?{snapshot,history:history.slice(-50),...(playId?{playId}:{})}:null
}

/** gameProjection is reported by ESPN in 0..100 percentages. */
export function parseEspnPregamePredictor(payload:unknown,sport?:string):WinSnapshot|null{
  const root=obj(payload),prediction=Object.keys(obj(root.predictor)).length?obj(root.predictor):root
  const home=obj(prediction.homeTeam),away=obj(prediction.awayTeam)
  const h=percentage(home.gameProjection??home.winProbability)
    ??(fraction(prediction.homeWinPercentage)===null?null:round(fraction(prediction.homeWinPercentage)!*100))
  const explicitAway=percentage(away.gameProjection??away.winProbability)
    ??percentage(home.teamChanceLoss)
    ??(fraction(prediction.awayWinPercentage)===null?null:round(fraction(prediction.awayWinPercentage)!*100))
  const draw=percentage(home.teamChanceTie??prediction.tiePercentage)
  if(h===null)return null
  // Soccer and other draw-capable contests cannot silently assign the missing
  // probability to the away team.
  const a=explicitAway??(sport==='basketball'||sport==='baseball'||sport==='hockey'
    ?100-h:null)
  if(a===null||h+a+(draw??0)>100.5||h+a+(draw??0)<99.0)return null
  return {home:round(h),away:round(a),draw:draw===null?null:round(draw)}
}

/** Pin Core URLs to the verified ESPN game identity and league slug. */
export function espnWinCoreUrl(sport?:string,league?:string,eventId?:string,
  competitionId?:string,mode:'predictor'|'probabilities'='predictor'):string|null{
  const summary=espnLiveSummaryUrl(sport,league,eventId)
  const comp=competitionId??eventId
  if(!summary||!comp||!/^\\d{1,18}$/u.test(comp))return null
  const url=new URL(summary)
  const match=url.pathname.match(/^\/apis\/site\/v2\/sports\/([a-z-]+)\/([a-z0-9._-]+)\/summary$/u)
  if(!match)return null
  return 'https://sports.core.api.espn.com/v2/sports/'+match[1]+'/leagues/'+match[2]
    +'/events/'+eventId+'/competitions/'+comp+'/'+mode
    +(mode==='probabilities'?'?limit=200':'')
}
async function json(url:string,signal:AbortSignal):Promise<unknown>{
  const controller=new AbortController()
  const abort=()=>controller.abort()
  signal.addEventListener('abort',abort,{once:true})
  const timer=setTimeout(abort,8500)
  try{
    const response=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'},cache:'no-store'})
    if(!response.ok)throw Error('ESPN '+String(response.status))
    if(Number(response.headers.get('content-length')??0)>3_000_000)throw Error('ESPN response too large')
    return await response.json() as unknown
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
}
/** Core often returns $ref records. Resolve only the last record from a pinned ESPN URL. */
async function coreWinFallback(url:string,signal:AbortSignal):Promise<WinSeries|null>{
  let payload=obj(await json(url,signal))
  const pages=number(obj(payload.pageCount).valueOf?.()??payload.pageCount)
  if(pages!==null&&Number.isInteger(pages)&&pages>1&&pages<=500){
    const pageUrl=new URL(url)
    pageUrl.searchParams.set('page',String(pages))
    payload=obj(await json(pageUrl.toString(),signal))
  }
  const items=list(payload.items)
  const last=items.at(-1)
  if(!last)return null
  if(typeof last.$ref==='string'){
    try{
      const ref=new URL(last.$ref)
      const expected=new URL(url)
      if(!['sports.core.api.espn.com','sports.core.api.espn.pvt'].includes(ref.hostname)
        ||!['https:','http:'].includes(ref.protocol)||ref.username||ref.password||ref.port
        ||!ref.pathname.startsWith(expected.pathname+'/'))return null
      ref.hostname='sports.core.api.espn.com';ref.protocol='https:'
      return parseEspnWinProbability({items:[await json(ref.toString(),signal)]})
    }catch{return null}
  }
  return parseEspnWinProbability({items})
}
const display=(n:number)=>n.toFixed(1).replace('.',',')+' %'
function ProbabilityPair({value,home,away}:{value:WinSnapshot;home:string;away:string}):ReactNode{
  return <div className={css.pair}>
    <div><small>{home}</small><strong className={css.home}>{display(value.home)}</strong></div>
    <div><small>{away}</small><strong className={css.away}>{display(value.away)}</strong></div>
    <div className={css.bar} aria-label={'Local '+display(value.home)+', visitante '+display(value.away)}>
      <span style={{width:value.home+'%'}}/>
      <i style={{width:value.away+'%'}}/>
    </div>
    {value.draw!==null&&value.draw>0&&<small className={css.draw}>Empate: {display(value.draw)}</small>}
  </div>
}
function Trend({history}:{history:number[]}):ReactNode{
  if(history.length<2)return null
  const width=230,height=54
  const points=history.map((p,i)=>[
    Number((i/(history.length-1)*width).toFixed(2)),
    Number(((1-p/100)*height).toFixed(2))
  ].join(',')).join(' ')
  return <svg className={css.trend} viewBox="0 0 230 54" role="img"
    aria-label="Evolución de la probabilidad de victoria local publicada por ESPN">
    <line x1="0" x2="230" y1="27" y2="27" stroke="currentColor" strokeOpacity=".16" strokeDasharray="3 4"/>
    <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
}
type FeedState={key:string;predictor:WinSnapshot|null;live:WinSeries|null;at:number;error:boolean}
const empty:FeedState={key:'',predictor:null,live:null,at:0,error:false}

/** Data only: pregame forecasts are frozen model outputs, not updated live odds. */
export function SportsWinProbability({sport,league,eventId,competitionId,phase,game}:{
  sport?:string;league?:string;eventId?:string;competitionId?:string
  phase?:'pre'|'in'|'post';game?:PhoenixLiveGame
}):ReactNode{
  const verifiedId=game?.id??(sport==='baseball'?undefined:eventId)
  const verifiedCompetition=game?.competitionId??competitionId??verifiedId
  const summaryUrl=espnLiveSummaryUrl(sport,league,verifiedId)
  const predictorUrl=espnWinCoreUrl(sport,league,verifiedId,verifiedCompetition,'predictor')
  const probabilityUrl=espnWinCoreUrl(sport,league,verifiedId,verifiedCompetition,'probabilities')
  const currentPhase=game?.phase??phase??'pre'
  const key=[summaryUrl,predictorUrl,currentPhase].join('|')
  const [state,setState]=useState<FeedState>(empty)
  useEffect(()=>{
    if(!summaryUrl||!predictorUrl||!probabilityUrl)return
    let active=true,busy=false,predictorDone=false,lastFetch=0
    const controller=new AbortController()
    const update=async()=>{
      if(!active||busy||typeof document!=='undefined'&&document.visibilityState==='hidden'
        ||typeof navigator!=='undefined'&&!navigator.onLine)return
      if(lastFetch&&Date.now()-lastFetch<(currentPhase==='in'?25_000:600_000))return
      lastFetch=Date.now();busy=true
      const record=(patch:Partial<FeedState>)=>{
        if(active&&!controller.signal.aborted)setState(old=>({...old.key===key?old:{...empty,key},...patch}))
      }
      try{
        // For running games request the single-call summary first; other phases
        // need only a predictor lookup.
        let payload:unknown
        if(currentPhase==='in'){
          payload=await json(summaryUrl,controller.signal)
          let live=parseEspnWinProbability(payload)
          if(!live){
            try{live=await coreWinFallback(probabilityUrl,controller.signal)}catch{/* Optional fallback. */}
          }
          record({live,at:Date.now(),error:false})
        }
        if(!predictorDone){
          predictorDone=true
          let pre=parseEspnPregamePredictor(payload,sport)
          if(!pre){
            try{pre=parseEspnPregamePredictor(await json(predictorUrl,controller.signal),sport)}
            catch{/* The predictor is not published for every event and league. */}
          }
          if(!pre&&currentPhase==='pre'){
            try{pre=parseEspnPregamePredictor(await json(summaryUrl,controller.signal),sport)}
            catch{/* ESPN summary predictor is optional. */}
          }
          record({predictor:pre})
        }
        if(currentPhase!=='in')record({at:Date.now(),error:false})
      }catch{record({error:true})}
      finally{busy=false}
    }
    void update()
    const interval=currentPhase==='in'?setInterval(()=>{void update()},10_000):undefined
    const visible=()=>{if(document.visibilityState==='visible'){lastFetch=0;void update()}}
    document.addEventListener('visibilitychange',visible)
    return()=>{active=false;controller.abort();if(interval)clearInterval(interval);
      document.removeEventListener('visibilitychange',visible)}
  },[key,summaryUrl,predictorUrl,probabilityUrl,currentPhase,sport])
  if(!summaryUrl)return null
  const valid=state.key===key
  const predictor=valid?state.predictor:null,live=valid?state.live:null
  const home=game?.home??'Local',away=game?.away??'Visitante'
  const stale=!valid||!state.at||Date.now()-state.at>90_000||state.error
  return <section className={css.wrap} aria-label="Probabilidades deportivas de ESPN">
    {predictor?<div className={css.panel}>
      <div className={css.heading}><span>◉ Predictor prepartido</span><small>ESPN · antes del inicio</small></div>
      <ProbabilityPair value={predictor} home={home} away={away}/>
    </div>:<div className={css.unavailable}>Predictor prepartido · {valid&&state.at?'No disponible en ESPN':'Consultando ESPN…'}</div>}
    {currentPhase==='in'&&(live?<div className={css.panel}>
      <div className={css.heading}><span>● Probabilidad de ganar en vivo</span>
        <small>{stale?'Última estimación recibida':'ESPN · por jugada'}</small></div>
      <ProbabilityPair value={live.snapshot} home={home} away={away}/>
      <Trend history={live.history}/>
    </div>:<div className={css.unavailable}>Probabilidad en vivo · {valid&&state.at?'ESPN no publicó datos para este juego':'Consultando ESPN…'}</div>)}
    {valid&&state.at>0&&<small className={css.note}>ESPN · consulta {new Date(state.at).toLocaleTimeString('es-DO',{hour:'2-digit',minute:'2-digit'})} · Probabilidades del modelo; no son cuotas ni garantizan resultados.</small>}
  </section>
}
