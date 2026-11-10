/** Live, reproducible chronological sports calibration; NEVER self-certify accuracy.
 * Both squads' forecasts use only games preceding each fixture. Archived final
 * ESPN scores are outcomes, not prematch injury, odds or lineup snapshots.
 */
import {writeFile} from 'node:fs/promises'
import {auditSportsCalibration} from '../packages/core/tool-sports/src/sports-calibration.ts'

const MODE=process.env.PHOENIX_BACKTEST_MODE==='smoke'?'smoke':'full'
const AS_OF=Date.now()
const CASES=[
  ['basketball','nba'],['basketball','wnba'],['hockey','nhl'],
  ['baseball','mlb'],['football','nfl'],['soccer','eng.1'],['soccer','usa.1'],
]
const selected=MODE==='smoke'?CASES.slice(0,2):CASES
const duration=MODE==='smoke'?28:180
const network={requests:0,success:0,errors:[]}
const result={
  asOf:new Date(AS_OF).toISOString(),sha:process.env.GITHUB_SHA??null,
  mode:MODE,daysPerLeague:duration,engine:'historical-temperature-v1',
  baseline:'prior-train-class-frequency',leakagePolicy:'strictly prior final results',
  previousProductionVersionCompared:false,
  note:'Historical calibration is not a matched old-vs-new model replay; no old-version prematch ledger is present.',
  leagues:[],network,completedAt:null,
}
const source=async url=>{
  const target=new URL(url)
  if(target.protocol!=='https:'||target.hostname!=='site.api.espn.com'||
    !/^\/apis\/site\/v2\/sports\/[a-z-]+\/[a-z0-9._-]+\/scoreboard$/u.test(target.pathname)||
    !/^\d{6}(?:\d{2})?$/u.test(target.searchParams.get('dates')??'')){
    throw Error('Unexpected research URL; refusing non-ESPN or unbounded request')
  }
  network.requests++
  try{
    const response=await fetch(target,{redirect:'error',
      headers:{accept:'application/json'},signal:AbortSignal.timeout(9500)})
    if(!response.ok)throw Error('ESPN HTTP '+response.status)
    const length=Number(response.headers.get('content-length')??0)
    if(length>8_000_000)throw Error('ESPN JSON above 8 MB cap')
    const body=await response.json()
    if(!body||typeof body!=='object'||!Array.isArray(body.events))
      throw Error('ESPN scoreboard schema unavailable')
    network.success++
    return body
  }catch(error){
    network.errors.push({source:target.pathname,day:target.searchParams.get('dates'),
      message:error instanceof Error?error.message.slice(0,140):'unknown'})
    if(network.errors.length>80)network.errors.shift()
    throw error
  }
}
let cursor=0
await Promise.all(Array.from({length:Math.min(2,selected.length)},async()=>{
  while(cursor<selected.length){
    const [sport,league]=selected[cursor++]
    const started=Date.now()
    try{
      const audit=await auditSportsCalibration(sport,league,duration,source,AS_OF)
      result.leagues.push({sport,league,status:audit.status,events:audit.events,
        samples:audit.samples,trainCount:audit.trainCount,holdoutCount:audit.holdoutCount,
        trainedThrough:audit.trainedThrough,evaluatedFrom:audit.evaluatedFrom,
        temperature:audit.temperature,holdoutBrier:audit.holdoutBrier,
        baselineBrier:audit.baselineBrier,holdoutLogLoss:audit.holdoutLogLoss,
        expectedCalibrationError:audit.expectedCalibrationError,
        calibrated:audit.calibrated,missing:audit.missing,
        coverage:audit.coverage,elapsedMs:Date.now()-started})
    }catch(error){
      result.leagues.push({sport,league,status:'error',calibrated:false,
        missing:[error instanceof Error?error.message:'Unknown audit error'],
        elapsedMs:Date.now()-started})
    }
  }
}))
result.leagues.sort((a,b)=>a.sport.localeCompare(b.sport)||a.league.localeCompare(b.league))
result.completedAt=new Date().toISOString()
await writeFile('phoenix-sports-chronological-backtest.json',JSON.stringify(result,null,2)+'\n')
const clean=value=>String(value??'—').replaceAll('|','/').replaceAll('\n',' ').slice(0,200)
const table=result.leagues.map(x=>'| '+[x.sport+'/'+x.league,x.status,
  x.samples,x.trainCount,x.holdoutCount,x.holdoutBrier,
  x.baselineBrier,x.expectedCalibrationError,x.coverage?.verifiedCalendarDays,
  x.coverage?.daysRequested].map(clean).join(' | ')+' |').join('\n')
const report='# PHOENIX Sports · calibración cronológica auditable\n\n'+
  'Ejecución: '+result.asOf+' · SHA '+(result.sha??'manual')+' · modo '+MODE+'\n\n'+
  'Se usan exclusivamente resultados anteriores al comienzo de cada juego para producir su predicción. '+
  'El conjunto de entrenamiento antecede temporalmente al holdout. '+
  'Una ausencia de muestra o cobertura devuelve **insuficiente**, no una falsa tasa de acierto.\n\n'+
  '| Liga | Estado | Muestras | Train | Holdout | Brier | Brier base | ECE | Días acreditados | Días solicitados |\n'+
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n'+table+'\n\n'+
  '**Límite metodológico:** se compara la heurística actual con frecuencia de clases aprendida en entrenamiento, '+
  '**no con la versión anterior de PHOENIX**. Para comparar versiones se requieren pronósticos archivados antes de cada kickoff, '+
  'los mismos eventos, mercado exacto, cuotas con fecha y resultados definitivos. '+
  'Tampoco una buena calibración demuestra rentabilidad en apuestas.\n\n'+
  'Solicitudes ESPN: '+network.requests+'; respuestas válidas: '+network.success+
  '; errores: '+network.errors.length+'. Todos los errores se conservan en el JSON.\n'
await writeFile('phoenix-sports-chronological-backtest.md',report)
console.log('PHOENIX_CHRONOLOGICAL_AUDIT '+JSON.stringify({mode:MODE,results:result.leagues.map(x=>({
  sport:x.sport,league:x.league,status:x.status,samples:x.samples,
  calibrated:x.calibrated,coverage:x.coverage?.verifiedCalendarDays})),network}))
if(result.leagues.every(x=>x.status==='error'))process.exitCode=1
