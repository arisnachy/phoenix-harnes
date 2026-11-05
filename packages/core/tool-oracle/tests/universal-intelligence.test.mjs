import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oraclePlan, fuseSeries, calibrationReport } from '../src/scientific-intelligence.ts'
import { ensembleForecast } from '../src/forecast-ensemble.ts'
import { oraclePlanVisual, oracleFusionVisual, oracleCalibrationVisual } from '../src/view.ts'

const future=new Date(Date.now()+3*86400000).toISOString()
test('enrutador universal define método, supuestos y faltantes sin inventar porcentajes',()=>{
  const plan=oraclePlan('¿Aumentarán los casos de dengue en Santiago?',future)
  assert.equal(plan.domain,'public-health')
  assert.equal(plan.route,'research-only')
  assert.equal(plan.status,'ready-to-investigate')
  assert.equal(plan.targetAt,future)
  assert.equal(plan.evidenceNeeded.length>=6,true)
  assert.equal(oraclePlanVisual(plan).component,'ui_canvas')
  const unspecified=oraclePlan('¿Qué pasará en una futura misión espacial?')
  assert.equal(unspecified.status,'needs-horizon')
  assert(unspecified.missing.length>0)
})
test('concilia series alineadas de tres fuentes sin falsear unidades ni desacuerdos',()=>{
  const baseline=Array.from({length:40},(_,i)=>({
    at:new Date(Date.UTC(2025,0,1+i)).toISOString(),value:100+i,
  }))
  const series=[0,1,-1].map((delta,i)=>({
    source:'source-'+i,unit:'casos',stepHours:24,
    points:baseline.map(p=>({...p,value:p.value+delta})),
  }))
  const result=fuseSeries(series)
  assert.equal(result.status,'fused')
  assert.equal(result.observations.length,40)
  assert.equal(result.observations[0].value,100)
  assert.equal(oracleFusionVisual(result).component,'ui_canvas')
  assert.throws(()=>fuseSeries([...series.slice(0,2),{...series[2],unit:'USD'}]),/incompatibles/)
  series[2].points[10].value=9999
  const conflicted=fuseSeries(series)
  assert.equal(conflicted.status,'insufficient')
  assert(conflicted.conflictCount>0)
})
test('calibración del historial usa tasas observadas y Brier, nunca asigna certeza',()=>{
  const records=[
    ...Array.from({length:20},(_,i)=>({predicted:.8,observed:i<16})),
    ...Array.from({length:20},(_,i)=>({predicted:.2,observed:i<4})),
  ]
  const r=calibrationReport(records)
  assert.equal(r.count,40)
  assert.equal(r.bins.length,2)
  assert(Math.abs(r.brier-.16)<1e-10)
  assert(Math.abs(r.expectedCalibrationError)<1e-10)
  assert.equal(oracleCalibrationVisual(r).component,'ui_canvas')
  assert.equal(calibrationReport([]).brier,null)
})
test('conjunto científico separa selección y prueba temporal y pinta intervalos en fechas reales',()=>{
  const values=Array.from({length:75},(_,i)=>10+2*i)
  const lastObservedAt=new Date(Date.now()-86400000).toISOString()
  const r=ensembleForecast({values,horizonSteps:3,stepHours:24,lastObservedAt,unit:'casos'})
  assert.equal(r.status,'projected')
  assert(r.holdoutFolds>=8)
  assert.equal(r.selected,'ensemble')
  assert(Math.abs(r.predictedValue-164)<.1)
  assert(r.selectedMae<r.baselineMae)
  assert(r.points.some(p=>p.lower!==undefined&&p.upper!==undefined))
  assert(r.points.some(p=>p.observed!==undefined))
  assert(r.points.some(p=>p.forecast!==undefined))
})
test('el conjunto se abstiene si falta histórico y no confunde periodo futuro',()=>{
  const r=ensembleForecast({values:Array.from({length:12},(_,i)=>i),
    horizonSteps:3,stepHours:24,lastObservedAt:future,unit:'casos'})
  assert.equal(r.status,'insufficient')
  const stale=ensembleForecast({values:Array.from({length:70},(_,i)=>i),
    horizonSteps:1,stepHours:24,lastObservedAt:'2020-01-01T00:00:00Z',unit:'casos'})
  assert.equal(stale.status,'insufficient')
})


test('calibración del ledger solo considera pronósticos congelados antes del evento',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {oracleCalibrationLedger}=await import('../src/ledger.ts')
  const dir=await mkdtemp(join(tmpdir(),'oraculo-calibration-'))
  try{
    const path=join(dir,'scored.jsonl')
    const make=(id,createdAt)=>({
      kind:'prediction',id,createdAt,result:{
        status:'forecast',method:'historical-real-data',targetAt:'2021-02-01T00:00:00Z',
        probabilityPercent:80,source:'test fixtures',evidenceStatus:'retrieved_unverified',assumptions:[],
      },
    })
    const entries=[
      make('a','2021-01-01T00:00:00Z'),
      {kind:'outcome',id:'a',recordedAt:'2022-01-01T00:00:00Z',observedAt:'2021-02-02T00:00:00Z',
        observedValue:1,source:'fixture',absoluteError:.2,brierError:.04,verification:'unverified_report'},
      make('b','2022-01-01T00:00:00Z'),
      {kind:'outcome',id:'b',recordedAt:'2022-01-01T00:00:00Z',observedAt:'2021-02-02T00:00:00Z',
        observedValue:1,source:'fixture',absoluteError:.2,brierError:.04,verification:'unverified_report'},
    ]
    await writeFile(path,entries.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8')
    const r=await oracleCalibrationLedger(path)
    assert.equal(r.count,1)
    assert.equal(r.retrospectiveExcluded,1)
    assert.equal(r.verification,'user_reported_unverified')
    assert(Math.abs(r.brier-.04)<1e-10)
  }finally{await rm(dir,{recursive:true,force:true})}
})



test('biblioteca inmutable conserva versiones y detecta desenlaces vencidos',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {recordOracle,reviseOracle,oracleHistory,oracleDuePredictions}=await import('../src/ledger.ts')
  const dir=await mkdtemp(join(tmpdir(),'oraculo-history-'))
  try {
    const path=join(dir,'predictions.jsonl')
    const scenario={status:'scenario',method:'causal-test',
      targetAt:'2020-01-01T00:00:00Z',predictedValue:23,
      source:'synthetic test fixture',evidenceStatus:'user_supplied_unverified',assumptions:[]}
    const original=await recordOracle(path,scenario)
    const revision=await reviseOracle(path,original.id,{...scenario,predictedValue:26,targetAt:future})
    const history=await oracleHistory(path)
    assert.equal(history.length,2)
    assert.equal(history[0].id,revision.id)
    assert.equal(history[0].supersedes,original.id)
    assert.equal(history[1].predictedValue,23)
    const due=await oracleDuePredictions(path)
    assert.equal(due.length,1)
    assert.equal(due[0].id,original.id)
  }finally{await rm(dir,{recursive:true,force:true})}
})


test('holdout independiente conserva resultado negativo sin cambiar el modelo por retrospectiva',()=>{
  const values=Array.from({length:120},(_,i)=>100+2*Math.min(i,89)+(i>=90?i%2:0))
  const lastObservedAt=new Date(Date.now()-43200000).toISOString()
  const forecast=ensembleForecast({values,horizonSteps:1,stepHours:24,lastObservedAt,unit:'casos'})
  assert.equal(forecast.status,'projected')
  assert.equal(forecast.selected,'ensemble')
  assert(forecast.selectedMae>forecast.baselineMae)
  assert(forecast.skillPercent<0)
  assert(forecast.warnings.some(w=>w.includes('ventana')))
})

test('prohibido elegir estacionalidad que necesita observar valores futuros',()=>{
  const values=Array.from({length:120},(_,i)=>10+i%2)
  const result=ensembleForecast({values,horizonSteps:5,stepHours:24,
    lastObservedAt:new Date(Date.now()-86400000).toISOString(),unit:'casos',seasonSteps:2})
  assert.equal(result.status,'projected')
  assert(!result.models.some(model=>model.name==='seasonal'))
})
