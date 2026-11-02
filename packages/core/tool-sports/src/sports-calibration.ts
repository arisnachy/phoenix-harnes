/**
 * Chronological, leakage-resistant sports model evaluation. The held-out
 * scoreboard results are never used to tune the temperature parameter.
 * This evaluates historical accuracy only; it cannot prove betting profit.
 */
import {estimateEvidenceForecast,type FinishedGame,type ForecastResult} from './sports-forecast.ts'
/** Final game with scored outcomes and ESPN event/team identifiers. */
export type HistoricalFixture={
 id:string;sport:string;league:string;date:string;homeId:string;awayId:string
 homeScore:number;awayScore:number;status:'post'
}
type Sample={date:string;eventId:string;p:number[];actual:number}
/** Time-split out-of-sample scores and gate for use of adjusted probabilities. */
export type CalibrationAudit={
 status:'validated'|'underperforming'|'insufficient'
 sport:string;league:string;checkedAt:string;events:number;samples:number
 trainCount:number;holdoutCount:number;trainedThrough:string|null
 evaluatedFrom:string|null;temperature:number|null
 holdoutBrier:number|null;baselineBrier:number|null;holdoutLogLoss:number|null
 expectedCalibrationError:number|null;calibrated:boolean
 model:'historical-temperature-v1';source:'ESPN historical final scoreboards'
 warning:string;missing:string[]
}
const score=(p:readonly number[],outcome:number)=>p.reduce((sum,x,i)=>sum+(x-(i===outcome?1:0))**2,0)
const loss=(p:readonly number[],outcome:number)=>-Math.log(Math.max(1e-8,p[outcome]??1e-8))
const mean=(rows:number[])=>rows.reduce((a,b)=>a+b,0)/rows.length
const shrink=(p:readonly number[],temp:number)=>{
 const exp=p.map(x=>Math.pow(Math.max(x,1e-5),1/temp))
 const total=exp.reduce((a,b)=>a+b,0)
 return exp.map(x=>x/total)
}
const valid=(x:HistoricalFixture,now:number)=>{
 const kickoff=Date.parse(x.date)
 return x.status==='post'&&/^\d{1,20}$/u.test(x.id)&&/^\d{1,20}$/u.test(x.homeId)
 &&/^\d{1,20}$/u.test(x.awayId)&&x.homeId!==x.awayId&&Number.isFinite(kickoff)
 &&kickoff<now&&Number.isInteger(x.homeScore)&&Number.isInteger(x.awayScore)
 &&x.homeScore>=0&&x.awayScore>=0&&x.homeScore<=300&&x.awayScore<=300
}
const drawAllowed=(sport:string)=>sport==='soccer'
const pvec=(forecast:ForecastResult,sport:string):number[]|null=>{
 const h=forecast.probabilityHome,a=forecast.probabilityAway
 if(forecast.status!=='exploratory'||h===null||a===null)return null
 const p=drawAllowed(sport)?[h,forecast.probabilityDraw??0,a]:[h,a]
 const total=p.reduce((sum,x)=>sum+x,0)
 return total>0&&p.every(x=>Number.isFinite(x)&&x>=0)?p.map(x=>x/total):null
}
const outcome=(g:HistoricalFixture)=>drawAllowed(g.sport)?
  g.homeScore>g.awayScore?0:g.homeScore===g.awayScore?1:2:
  g.homeScore>g.awayScore?0:1
const errCalibration=(rows:Sample[],temp:number)=>{
 let error=0
 for(let bin=0;bin<5;bin++){
   const records=rows.flatMap(row=>{
     const p=shrink(row.p,temp),best=p.indexOf(Math.max(...p))
     const conf=p[best]!
     return conf>=bin/5&&(bin===4?conf<=1:conf<(bin+1)/5)?
       [{confidence:conf,correct:best===row.actual?1:0}]:[]
   })
   if(records.length)error+=records.length/rows.length*Math.abs(
     mean(records.map(x=>x.confidence))-mean(records.map(x=>x.correct)))
 }
 return error
}
const cache=new Map<string,{until:number;audit:CalibrationAudit}>()
const cacheKey=(sport:string,league:string)=>sport+'|'+league
/** Return only a recently validated model fitted before the new kickoff.
 * @param sport - ESPN discipline identifier.
 * @param league - ESPN league identifier.
 * @param kickoff - Strictly future event timestamp.
 * @param now - Current observation time.
 * @returns Verified calibration metadata, otherwise null.
 */
export function availableSportCalibration(sport:string,league:string,kickoff:string,now=Date.now()){
 const result=cache.get(cacheKey(sport,league)),event=Date.parse(kickoff)
 if(!result||result.until<now||result.audit.status!=='validated'
    ||!Number.isFinite(event)||event<=now
    ||!result.audit.trainedThrough||Date.parse(result.audit.trainedThrough)>=event)return null
 return result.audit
}
/** Adjust probabilities using a trained, validated historical temperature.
 * @param forecast - Earlier independent, pregame heuristic forecast.
 * @param audit - Holdout-validated historical evaluation, never self-reported accuracy.
 * @returns Adjusted vector, or null without validated evidence.
 */
export function calibratedSportsForecast(forecast:ForecastResult,audit:CalibrationAudit){
 if(!audit.calibrated||audit.status!=='validated'||audit.temperature===null)return null
 const p=pvec(forecast,audit.sport)
 if(!p)return null
 const transformed=shrink(p,audit.temperature)
 return {probabilityHome:transformed[0]!,probabilityAway:transformed.at(-1)!,
   probabilityDraw:drawAllowed(audit.sport)?transformed[1]!:null,
   model:'historical-temperature-v1' as const,
   validatedOn: audit.holdoutCount,holdoutBrier:audit.holdoutBrier,
   baselineBrier:audit.baselineBrier,
   warning:'Calibración histórica validada fuera de muestra; NO garantiza beneficio ni valor esperado positivo.'}
}
/** Evaluate already-finished events with chronological feature generation.
 * @param fixtures - Timestamped final scoreboards (not live or market odds).
 * @param sport - Exact ESPN sport.
 * @param league - Exact ESPN league.
 * @param now - All input scores must have finished before this time.
 * @returns Holdout metrics; insufficient means no calibration can be claimed.
 */
export function evaluateSportsCalibration(fixtures:readonly HistoricalFixture[],sport:string,
 league:string,now=Date.now()):CalibrationAudit{
 const sorted=fixtures.filter(g=>g.sport===sport&&g.league===league&&valid(g,now))
   .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||a.id.localeCompare(b.id))
 const seen=new Set<string>(),history=new Map<string,FinishedGame[]>(),samples:Sample[]=[]
 for(const match of sorted){
   if(seen.has(match.id))continue
   seen.add(match.id)
   const h=history.get(match.homeId)??[],a=history.get(match.awayId)??[]
   const kickoff=Date.parse(match.date)
   if(match.homeScore!==match.awayScore||drawAllowed(sport)){
     const raw=estimateEvidenceForecast({
       sport,phase:'pre',eventDate:match.date,
       home:{name:match.homeId,lastGames:h},
       away:{name:match.awayId,lastGames:a},
     },kickoff-1)
     const p=pvec(raw,sport)
     if(p)samples.push({date:match.date,eventId:match.id,p,actual:outcome(match)})
   }
   // Append the match AFTER deriving its prediction, never before.
   const add=(teamId:string,scored:number,allowed:number)=>{
     const older=history.get(teamId)??[]
     history.set(teamId,[{date:match.date,scored,allowed},...older].slice(0,8))
   }
   add(match.homeId,match.homeScore,match.awayScore)
   add(match.awayId,match.awayScore,match.homeScore)
 }
 const split=Math.floor(samples.length*.7)
 const train=samples.slice(0,split),test=samples.slice(split)
 const base={sport,league,checkedAt:new Date(now).toISOString(),events:seen.size,
   samples:samples.length,trainCount:train.length,holdoutCount:test.length,
   trainedThrough:train.at(-1)?.date??null,evaluatedFrom:test[0]?.date??null,
   model:'historical-temperature-v1' as const,
   source:'ESPN historical final scoreboards' as const}
 const missing:string[]=[]
 if(train.length<60)missing.push('Se necesitan al menos 60 partidos de entrenamiento con historial previo completo')
 if(test.length<24)missing.push('Se necesitan al menos 24 eventos posteriores exclusivamente de validación')
 if(new Set(train.map(x=>x.actual)).size<(drawAllowed(sport)?3:2))
   missing.push('Falta cobertura de todas las clases de resultado')
 if(missing.length)return {...base,status:'insufficient',temperature:null,holdoutBrier:null,
   baselineBrier:null,holdoutLogLoss:null,expectedCalibrationError:null,
   calibrated:false,missing,warning:'No existe muestra suficiente para emitir probabilidades calibradas.'}
 const grid=[0.6,0.7,0.8,0.9,1,1.1,1.2,1.4,1.6,1.8,2,2.4,3,4]
 let temp=1,trainBest=Infinity
 for(const candidate of grid){
   const brier=mean(train.map(x=>score(shrink(x.p,candidate),x.actual)))
   if(brier<trainBest){trainBest=brier;temp=candidate}
 }
 const totals=Array(drawAllowed(sport)?3:2).fill(0) as number[]
 for(const entry of train)totals[entry.actual]!++
 const baseline=totals.map(x=>x/train.length)
 const brier=mean(test.map(x=>score(shrink(x.p,temp),x.actual)))
 const naive=mean(test.map(x=>score(baseline,x.actual)))
 const ll=mean(test.map(x=>loss(shrink(x.p,temp),x.actual)))
 const ece=errCalibration(test,temp)
 // Pre-specified gate; do not claim skill from a minuscule improvement.
 const validated=brier+0.003<naive&&ece<=0.14
 const result:CalibrationAudit={...base,status:validated?'validated':'underperforming',
   temperature:temp,holdoutBrier:Number(brier.toFixed(5)),
   baselineBrier:Number(naive.toFixed(5)),
   holdoutLogLoss:Number(ll.toFixed(5)),
   expectedCalibrationError:Number(ece.toFixed(5)),calibrated:validated,
   missing:validated?[]:['No supera simultáneamente la línea base en Brier y el umbral de calibración ECE'],
   warning:validated?'Precisión de probabilidades evaluada en fechas posteriores; no implica rentabilidad ni mejora frente al mercado.':
     'Se evaluó cronológicamente, pero NO hay evidencia suficiente para habilitar probabilidades calibradas.'}
 return result
}
type Board={events?:Array<{id?:string|number;date?:string;
 status?:{type?:{state?:string}};competitions?:Array<{competitors?:Array<{
 homeAway?:string;score?:string|number;team?:{id?:string|number}}>}>}>}
const day=(timestamp:number)=>new Date(timestamp).toISOString().slice(0,10).replaceAll('-','')
/** Collect bounded, official historical scoreboard snapshots by calendar day.
 * @param sport - One supported ESPN discipline.
 * @param league - One supported ESPN league (validated by the caller).
 * @param lookbackDays - 28..90 daily requests, with concurrency <=4.
 * @param getJSON - Injected read-only ESPN JSON provider.
 * @param now - Fixed audit cutoff for reproducibility.
 * @returns Dataset coverage and a strictly chronological audit.
 */
export async function auditSportsCalibration(
 sport:string,league:string,lookbackDays:number,getJSON:<T>(url:string)=>Promise<T>,
 now=Date.now()){
 if(!/^[a-z][a-z-]{1,35}$/u.test(sport)||!/^[a-z0-9][a-z0-9._-]{0,45}$/u.test(league)
 ||!Number.isInteger(lookbackDays)||lookbackDays<28||lookbackDays>90)
   throw Error('Liga o período de evaluación no permitido')
 const fixtures:HistoricalFixture[]=[],errors:string[]=[]
 const offsets=Array.from({length:lookbackDays},(_,i)=>i+1)
 for(let i=0;i<offsets.length;i+=4){
   const batch=offsets.slice(i,i+4)
   const replies=await Promise.allSettled(batch.map(async offset=>{
     const date=day(now-offset*86_400_000)
     const endpoint='https://site.api.espn.com/apis/site/v2/sports/'+sport+'/'+league+
       '/scoreboard?dates='+date+'&limit=200'
     const data=await getJSON<Board>(endpoint)
     return Array.isArray(data.events)?data.events:[]
   }))
   replies.forEach((reply,j)=>{
     if(reply.status==='rejected'){errors.push('Día -'+batch[j]+': consulta no disponible');return}
     for(const event of reply.value.slice(0,120)){
       if(event.status?.type?.state!=='post')continue
       const competitors=event.competitions?.[0]?.competitors??[]
       const home=competitors.find(x=>x.homeAway==='home'),away=competitors.find(x=>x.homeAway==='away')
       const scores=[Number(home?.score),Number(away?.score)]
       if(!home?.team?.id||!away?.team?.id||home.score===undefined||away.score===undefined
          ||!scores.every(x=>Number.isInteger(x)))continue
       fixtures.push({id:String(event.id??''),sport,league,date:String(event.date??''),
         homeId:String(home.team.id),awayId:String(away.team.id),
         homeScore:scores[0]!,awayScore:scores[1]!,status:'post'})
     }
   })
 }
 const report=evaluateSportsCalibration(fixtures,sport,league,now)
 const merged={...report,coverage:{daysRequested:lookbackDays,
   failedDays:errors.length,fixturesRead:fixtures.length,failedExamples:errors.slice(0,6)}}
 // Cache only genuinely validated audits, and only for a short period.
 if(report.calibrated)cache.set(cacheKey(sport,league),{until:now+6*3_600_000,audit:report})
 return merged
}
