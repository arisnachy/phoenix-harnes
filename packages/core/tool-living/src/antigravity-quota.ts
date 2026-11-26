/** Pacing is advisory, scoped to each provider-reported bucket. */
type Bucket = {id:string; observedAt:number; durationMinutes?:number; remainingPercent?:number; resetsAt?:number; disabled?:boolean}
type Telemetry = {kind?:string; accountType?:string; quotaGroups?:Array<{name:string;buckets:Bucket[]}>}
export function projectAntigravityQuota(value:unknown,now=Date.now()) {
  const telemetry=value as Telemetry|undefined
  const groups=telemetry?.kind==='account'&&telemetry.accountType==='google-native-cli'&&Array.isArray(telemetry.quotaGroups)?telemetry.quotaGroups:[]
  return {source:'native-antigravity-cli',exactRemainingTokens:null,automaticProviderSwitchAuthorized:false,
    status:groups.length?'reported':'unknown',
    groups:groups.map(group=>({name:group.name,buckets:group.buckets.map(b=>{
      const seconds=typeof b.resetsAt==='number'?Math.max(0,Math.ceil(b.resetsAt-now/1000)):null
      const remaining=typeof b.remainingPercent==='number'&&Number.isFinite(b.remainingPercent)&&b.remainingPercent>=0&&b.remainingPercent<=100?b.remainingPercent:null
      const fresh=Number.isFinite(b.observedAt)&&b.observedAt<=now&&now-b.observedAt<=120000&&seconds!==null&&seconds>0&&remaining!==null&&b.disabled!==true
      const reserve=b.durationMinutes===300?5:b.durationMinutes===10080?10:null
      return {id:b.id,durationMinutes:b.durationMinutes??null,remainingPercent:remaining,resetAt:b.resetsAt??null,remainingSeconds:seconds,observedAt:b.observedAt,
        status:b.disabled?'disabled':fresh?'fresh':'unknown-or-stale',
        policy:!fresh||reserve===null?'unknown':remaining===0?'exhausted':remaining!<=reserve?'protect-reserve':'available',
        sustainablePercentPerHour:fresh&&reserve!==null?Math.max(0,remaining!-reserve)/(seconds!/3600):null}
    })}))}
}
