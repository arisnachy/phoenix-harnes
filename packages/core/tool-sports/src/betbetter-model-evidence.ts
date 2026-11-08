/** Open Bet Better model predictions, NOT a sportsbook odds feed.
 * Official docs https://betbetter.world/api/; CC BY 4.0 attribution required.
 * Only free, unlocked, time-stamped probability estimates are admitted.
 */
export type ModelForecast={
  provider:'Bet Better';kind:'model-probability';sportKey:string;
  home:string;away:string;kickoff:string;selection:string;market:string;
  modelProbabilityPct:number;fairOdds:number;updatedAt:string;
  confidence:string;attribution:'Bet Better — https://betbetter.world'
}
const routes:Readonly<Record<string,string>>={
  americanfootball_nfl:'/nfl/picks',baseball_mlb:'/mlb/picks',
  basketball_nba:'/nba/picks',basketball_wnba:'/wnba/picks',
  icehockey_nhl:'/nhl/picks',soccer_epl:'/soccer/epl/picks',
  soccer_spain_la_liga:'/soccer/la-liga/picks',
  soccer_usa_mls:'/soccer/mls/picks',soccer_germany_bundesliga:'/soccer/bundesliga/picks',
  soccer_italy_serie_a:'/soccer/serie-a/picks',
  soccer_france_ligue_one:'/soccer/ligue-1/picks',
  tennis_wta:'/tennis/wta/picks',
}
const safe=(s:unknown,n=120)=>typeof s==='string'?s.trim().slice(0,n):''
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/gu,'')
  .toLowerCase().replace(/[^a-z0-9]/gu,'')
export const modelSports=Object.freeze(Object.keys(routes))
export function findModelOpinion(forecasts:readonly ModelForecast[],game:{
  home:string;away:string;kickoff:string;pick:'home'|'away';
}):{status:'support'|'contradiction'|'unavailable';prediction:ModelForecast|null}{
  const pick=forecasts.find(f=>norm(f.home)===norm(game.home)&&
    norm(f.away)===norm(game.away)&&
    Math.abs(Date.parse(f.kickoff)-Date.parse(game.kickoff))<3_600_000&&
    /^(?:head to head|moneyline|match winner|1x2)$/iu.test(f.market))
  if(!pick)return{status:'unavailable',prediction:null}
  const wanted=game.pick==='home'?game.home:game.away
  return{status:norm(pick.selection)===norm(wanted)?'support':'contradiction',
    prediction:pick}
}
const cache=new Map<string,{timestamp:number;forecasts:ModelForecast[]}>()
export async function fetchBetBetterModels(
  sportKey:string,fetcher:typeof fetch=fetch,now=Date.now(),
):Promise<ModelForecast[]>{
  if(!/^[a-z0-9_]{3,80}$/u.test(sportKey))throw Error('Liga inválida')
  const path=routes[sportKey]
  if(!path)return []
  const existing=fetcher===fetch?cache.get(sportKey):undefined
  if(existing&&now-existing.timestamp>=0&&now-existing.timestamp<900_000)
    return existing.forecasts
  const url='https://betbetter.world'+path+'?format=json&free=1'
  const response=await fetcher(url,{headers:{accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(10_000)})
  if(!response.ok)throw Error('Bet Better HTTP '+response.status)
  if(Number(response.headers.get('content-length')||0)>2_000_000)
    throw Error('Bet Better respuesta demasiado grande')
  const raw=await response.text()
  if(raw.length>2_000_000)throw Error('Bet Better respuesta demasiado grande')
  const json=JSON.parse(raw) as Record<string,unknown>
  if(!Array.isArray(json.picks))throw Error('Bet Better: respuesta sin picks')
  const updatedAt=safe(json.updatedUtc,80)
  if(!Number.isFinite(Date.parse(updatedAt))||Date.parse(updatedAt)>now||
    now-Date.parse(updatedAt)>48*3_600_000)return []
  const forecasts:ModelForecast[]=[]
  for(const entry of json.picks.slice(0,100)){
    if(!entry||typeof entry!=='object'||Array.isArray(entry))continue
    const row=entry as Record<string,unknown>
    if(row.locked!==false||row.leanOnly===true)continue
    const game=safe(row.game),parts=game.split(/\s+@\s+/u)
    if(parts.length!==2)continue
    const kickoff=safe(row.gameTimeUtc,80),selection=safe(row.selection)
    const market=safe(row.market,80),confidence=safe(row.confidence,40)
    const probability=Number(row.modelProbabilityPct),fairOdds=Number(row.fairOdds)
    if(!selection||!market||!Number.isFinite(Date.parse(kickoff))||
      Date.parse(kickoff)<=now||Date.parse(kickoff)>now+5*86_400_000||
      !Number.isFinite(probability)||probability<=0||probability>=100||
      !Number.isFinite(fairOdds)||fairOdds<=1||
      Math.abs(100/probability-fairOdds)>0.035)continue
    forecasts.push({provider:'Bet Better',kind:'model-probability',sportKey,
      away:parts[0]!,home:parts[1]!,kickoff,selection,market,
      modelProbabilityPct:probability,fairOdds,updatedAt,confidence,
      attribution:'Bet Better — https://betbetter.world'})
  }
  if(fetcher===fetch)cache.set(sportKey,{timestamp:now,forecasts})
  return forecasts
}
