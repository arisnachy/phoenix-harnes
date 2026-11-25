/** Secret-free account quota projection. Native percentages are not token balances. */
export interface NativeQuotaWindow {usedPercent:number;windowDurationMins?:number;resetsAt?:number;observedAt?:number}
export interface NativeQuotaTelemetry {kind:string;provider:string;accountType?:string;primaryLimit?:NativeQuotaWindow;secondaryLimit?:NativeQuotaWindow}
const MINUTE=60000

/** A forecast describes percentage-point consumption, never exact tokens or guaranteed availability. */
export function forecastQuotaWindow(current:NativeQuotaWindow|undefined,previous:NativeQuotaWindow|undefined,minutes:number,now:number){
  const unknown={basis:'unknown' as const,observedPercentPerHour:null,windowAveragePercentPerHour:null,planningPercentPerHour:null,estimatedHoursToReserve:null,estimatedHoursToExhaustion:null,reserveAtRisk:null}
  if(!current||!Number.isFinite(now)||current.windowDurationMins!==minutes)return unknown
  const {usedPercent:used,resetsAt:reset,observedAt:observed}=current
  if(typeof used!=='number'||!Number.isFinite(used)||used<0||used>100||typeof reset!=='number'||!Number.isFinite(reset)||typeof observed!=='number'||!Number.isFinite(observed)||observed>now||now-observed>120000)return unknown
  const resetMs=reset*1000,start=resetMs-minutes*MINUTE
  if(resetMs<=now||observed<start||resetMs-now>minutes*MINUTE)return unknown
  const remainingHours=(resetMs-now)/3600000
  const elapsedHours=(observed-start)/3600000
  const reserve=minutes===300?5:10
  // At least fifteen minutes of exposure avoids extreme forecasts from startup noise.
  const average=elapsedHours>=0.25&&used>0?used/elapsedHours:null
  const prevAt=previous?.observedAt,prevUsed=previous?.usedPercent
  const interval=typeof prevAt==='number'?(observed-prevAt)/3600000:0
  const comparable=previous?.windowDurationMins===minutes&&previous.resetsAt===reset&&typeof prevAt==='number'&&prevAt>=start&&interval>=0.25&&typeof prevUsed==='number'&&Number.isFinite(prevUsed)&&prevUsed>=0&&prevUsed<=used
  // Quota drops, account changes and resets cannot produce a valid measured burn rate.
  const measured=comparable?(used-prevUsed!)/interval:null
  const rate=Math.max(average??0,measured??0)
  const round=(n:number)=>Math.round(n*1000)/1000
  const available=Math.max(0,100-used-reserve)
  // Include sample age conservatively when projecting from now.
  const ageHours=(now-observed)/3600000
  const reserveHours=available===0?0:rate>0?Math.max(0,available/rate-ageHours):null
  const exhaustionHours=used===100?0:rate>0?Math.max(0,(100-used)/rate-ageHours):null
  return {
    basis:measured!==null?'same-window-observations' as const:average!==null?'window-average' as const:'insufficient-data' as const,
    observedPercentPerHour:measured===null?null:round(measured),
    windowAveragePercentPerHour:average===null?null:round(average),
    planningPercentPerHour:rate>0?round(rate):null,
    estimatedHoursToReserve:reserveHours===null?null:round(reserveHours),
    estimatedHoursToExhaustion:exhaustionHours===null?null:round(exhaustionHours),
    reserveAtRisk:reserveHours===null?null:reserveHours<remainingHours,
  }
}
export function projectCodexQuota(telemetry:NativeQuotaTelemetry|undefined,now=Date.now(),previous?:NativeQuotaTelemetry){
  const isCodex=telemetry?.kind==='account'&&telemetry.provider.toLowerCase()==='codex'&&telemetry.accountType?.toLowerCase()==='chatgpt'
  const windows=isCodex?[telemetry?.primaryLimit,telemetry?.secondaryLimit]:[]
  const previousWindows=previous?.kind==='account'&&previous.provider.toLowerCase()==='codex'&&previous.accountType?.toLowerCase()==='chatgpt'?[previous.primaryLimit,previous.secondaryLimit]:[]
  const project=(minutes:number)=>{
    // Match provider duration, not primary/secondary position; no guessed window.
    const candidates=windows.filter(w=>w?.windowDurationMins===minutes)
    const w=candidates.length===1?candidates[0]:undefined
    const older=previousWindows.filter(x=>x?.windowDurationMins===minutes)
    const forecast=forecastQuotaWindow(w,older.length===1?older[0]:undefined,minutes,now)
    const used=w?.usedPercent
    if(!w||typeof used!=='number'||!Number.isFinite(used)||used<0||used>100)return {status:'unknown' as const,durationMinutes:minutes,usedPercent:null,remainingPercent:null,resetAt:null,remainingSeconds:null,observedAt:null,pace:'unknown' as const,sustainablePercentPerHour:null,forecast}
    const reset=typeof w.resetsAt==='number'&&Number.isFinite(w.resetsAt)&&w.resetsAt>0&&w.resetsAt<=8.64e12?w.resetsAt*1000:null
    const observed=typeof w.observedAt==='number'&&Number.isFinite(w.observedAt)&&w.observedAt<=now?w.observedAt:null
    const seconds=reset===null?null:Math.max(0,Math.ceil((reset-now)/1000))
    const remaining=100-used
    const fresh=observed!==null&&now-observed<=120000&&reset!==null&&reset>now&&reset-now<=minutes*MINUTE
    const reserve=minutes===300?5:10
    const elapsed=reset===null?0:Math.max(0,Math.min(1,1-(reset-now)/(minutes*MINUTE)))
    const allowance=Math.min(90,10+elapsed*85)
    return {status:fresh?'fresh' as const:reset!==null&&reset<=now?'awaiting-refresh' as const:'stale' as const,durationMinutes:minutes,usedPercent:used,remainingPercent:remaining,resetAt:reset===null?null:new Date(reset).toISOString(),remainingSeconds:seconds,observedAt:observed,pace:!fresh?'unknown' as const:remaining<=reserve?'reserve' as const:used>allowance?'conserve' as const:'on-pace' as const,forecast,sustainablePercentPerHour:fresh&&seconds!==null&&seconds>0?Math.round(Math.max(0,remaining-reserve)/(seconds/3600)*1000)/1000:null}
  }
  const fiveHours=project(300),sevenDays=project(10080)
  const ready=fiveHours.status==='fresh'&&sevenDays.status==='fresh'
  const policy=!ready?'unknown':fiveHours.pace==='reserve'||sevenDays.pace==='reserve'?'protect-reserve':fiveHours.pace==='conserve'||sevenDays.pace==='conserve'?'conserve':'balanced'
  const forecastRecommendation=!ready?'unknown':policy==='protect-reserve'?'protect-reserve':fiveHours.forecast.reserveAtRisk===true||sevenDays.forecast.reserveAtRisk===true?'reduce-burn':policy==='conserve'?'conserve':'maintain'
  return {forecastRecommendation,schema:'phoenix.codex-quota.v1',source:'native-codex-account',fiveHours,sevenDays,policy,exactRemainingTokens:null,quotaIsTokenCount:false,automaticProviderSwitchAuthorized:false}
}
interface QuotaAuthorization {
  list():readonly {key:string;label:string}[]
  inspect(key:string,signal?:AbortSignal):Promise<NativeQuotaTelemetry|undefined>
}
// Bounded process-local observations, scoped to the actual authorization service and account.
// No account identity, prompts, or history are returned or written to disk.
const observations=new WeakMap<QuotaAuthorization,{identity:string;baseline:NativeQuotaTelemetry;latest:NativeQuotaTelemetry}>()
function sampleTime(t:NativeQuotaTelemetry){return Math.max(t.primaryLimit?.observedAt??-1,t.secondaryLimit?.observedAt??-1)}
export async function inspectCodexQuota(auth:QuotaAuthorization|undefined,signal?:AbortSignal){
  try{
    const entry=auth?.list().find(x=>x.key==='subagent-codex/account')
    if(!auth||!entry)return projectCodexQuota(undefined)
    const timeout=AbortSignal.timeout(2500)
    const telemetry=await auth.inspect(entry.key,signal===undefined?timeout:AbortSignal.any([signal,timeout]))
    if(signal?.aborted||timeout.aborted)return projectCodexQuota(undefined)
    const now=Date.now()
    const email=(telemetry as (NativeQuotaTelemetry&{email?:unknown})|undefined)?.email
    const identity=typeof email==='string'&&email.trim()!==''?email.trim().toLowerCase():undefined
    const current=projectCodexQuota(telemetry,now)
    if(!telemetry||identity===undefined||current.fiveHours.status!=='fresh'||current.sevenDays.status!=='fresh'){
      observations.delete(auth)
      return current
    }
    const record=observations.get(auth)
    // Only copy the rate limit fields; never retain the raw provider payload.
    const sample:NativeQuotaTelemetry={kind:telemetry.kind,provider:telemetry.provider,accountType:'chatgpt',...(telemetry.primaryLimit?{primaryLimit:{...telemetry.primaryLimit}}:{}),...(telemetry.secondaryLimit?{secondaryLimit:{...telemetry.secondaryLimit}}:{})}
    if(!record||record.identity!==identity){
      observations.set(auth,{identity,baseline:sample,latest:sample})
      return current
    }
    const time=sampleTime(sample),latestTime=sampleTime(record.latest),baselineTime=sampleTime(record.baseline)
    if(time<latestTime)return current
    const prior=record.baseline
    // Keep a useful baseline through repeated cached reads; roll it after one hour.
    if(time>latestTime)observations.set(auth,{identity,baseline:time-baselineTime>=3600000?record.latest:prior,latest:sample})
    return projectCodexQuota(telemetry,now,prior)
  }catch{return projectCodexQuota(undefined)}
}
