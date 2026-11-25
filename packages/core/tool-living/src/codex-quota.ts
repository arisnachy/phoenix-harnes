/** Secret-free account quota projection. Native percentages are not token balances. */
export interface NativeQuotaWindow {usedPercent:number;windowDurationMins?:number;resetsAt?:number;observedAt?:number}
export interface NativeQuotaTelemetry {kind:string;provider:string;accountType?:string;primaryLimit?:NativeQuotaWindow;secondaryLimit?:NativeQuotaWindow}
const MINUTE=60000
export function projectCodexQuota(telemetry:NativeQuotaTelemetry|undefined,now=Date.now()){
  const isCodex=telemetry?.kind==='account'&&telemetry.provider.toLowerCase()==='codex'&&telemetry.accountType?.toLowerCase()==='chatgpt'
  const windows=isCodex?[telemetry?.primaryLimit,telemetry?.secondaryLimit]:[]
  const project=(minutes:number)=>{
    // Match provider duration, not primary/secondary position; no guessed window.
    const candidates=windows.filter(w=>w?.windowDurationMins===minutes)
    const w=candidates.length===1?candidates[0]:undefined
    const used=w?.usedPercent
    if(!w||typeof used!=='number'||!Number.isFinite(used)||used<0||used>100)return {status:'unknown' as const,durationMinutes:minutes,usedPercent:null,remainingPercent:null,resetAt:null,remainingSeconds:null,observedAt:null,pace:'unknown' as const,sustainablePercentPerHour:null}
    const reset=typeof w.resetsAt==='number'&&Number.isFinite(w.resetsAt)&&w.resetsAt>0&&w.resetsAt<=8.64e12?w.resetsAt*1000:null
    const observed=typeof w.observedAt==='number'&&Number.isFinite(w.observedAt)&&w.observedAt<=now?w.observedAt:null
    const seconds=reset===null?null:Math.max(0,Math.ceil((reset-now)/1000))
    const remaining=100-used
    const fresh=observed!==null&&now-observed<=120000&&reset!==null&&reset>now&&reset-now<=minutes*MINUTE
    const reserve=minutes===300?5:10
    const elapsed=reset===null?0:Math.max(0,Math.min(1,1-(reset-now)/(minutes*MINUTE)))
    const allowance=Math.min(90,10+elapsed*85)
    return {status:fresh?'fresh' as const:reset!==null&&reset<=now?'awaiting-refresh' as const:'stale' as const,durationMinutes:minutes,usedPercent:used,remainingPercent:remaining,resetAt:reset===null?null:new Date(reset).toISOString(),remainingSeconds:seconds,observedAt:observed,pace:!fresh?'unknown' as const:remaining<=reserve?'reserve' as const:used>allowance?'conserve' as const:'on-pace' as const,sustainablePercentPerHour:fresh&&seconds!==null&&seconds>0?Math.round(Math.max(0,remaining-reserve)/(seconds/3600)*1000)/1000:null}
  }
  const fiveHours=project(300),sevenDays=project(10080)
  const ready=fiveHours.status==='fresh'&&sevenDays.status==='fresh'
  const policy=!ready?'unknown':fiveHours.pace==='reserve'||sevenDays.pace==='reserve'?'protect-reserve':fiveHours.pace==='conserve'||sevenDays.pace==='conserve'?'conserve':'balanced'
  return {schema:'phoenix.codex-quota.v1',source:'native-codex-account',fiveHours,sevenDays,policy,exactRemainingTokens:null,quotaIsTokenCount:false,automaticProviderSwitchAuthorized:false}
}
interface QuotaAuthorization {
  list():readonly {key:string;label:string}[]
  inspect(key:string,signal?:AbortSignal):Promise<NativeQuotaTelemetry|undefined>
}
export async function inspectCodexQuota(auth:QuotaAuthorization|undefined,signal?:AbortSignal){
  try{
    const entry=auth?.list().find(x=>x.key==='subagent-codex/account')
    if(!auth||!entry)return projectCodexQuota(undefined)
    const timeout=AbortSignal.timeout(2500)
    return projectCodexQuota(await auth.inspect(entry.key,signal===undefined?timeout:AbortSignal.any([signal,timeout])))
  }catch{return projectCodexQuota(undefined)}
}
