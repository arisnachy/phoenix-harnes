import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordOracle,auditOracle,oracleSummary} from '../src/ledger.ts'
import {forecastOracle} from '../src/engine.ts'
test('registrar, auditar con horizonte vencido, evitar segunda liquidación',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'phoenix-oraculo-'))
 try{
  const path=join(dir,'predictions.jsonl'),result=forecastOracle({mode:'time-series',source:'datos de test',values:Array.from({length:40},(_,i)=>i),horizonSteps:1,stepHours:1,lastObservedAt:'2020-01-01T00:00:00Z',unit:'m'})
  const row=await recordOracle(path,result);assert.match(row.id,/^[a-f0-9-]{36}$/)
  await assert.rejects(auditOracle(path,{id:row.id,observedValue:40,observedAt:'2020-01-01T00:15:00Z',source:'test'}),/anterior/)
  const outcome=await auditOracle(path,{id:row.id,observedValue:40,observedAt:'2020-01-01T01:00:00Z',source:'test'})
  assert.equal(outcome.absoluteError,0);assert.equal(outcome.verification,'unverified_report')
  await assert.rejects(auditOracle(path,{id:row.id,observedValue:40,observedAt:'2020-01-01T01:00:00Z',source:'test'}),/ya fue/)
  assert.deepEqual(await oracleSummary(path),{total:1,settled:1,binarySettled:0,meanAbsoluteError:0,meanBrierScore:null,verifiedByHost:0})
 } finally{await rm(dir,{recursive:true,force:true})}
})

test('registrar pronóstico probabilístico, evaluar con Brier sin afirmar verificación externa',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'phoenix-oraculo-binary-'))
 try {
  const path=join(dir,'binary.jsonl')
  const prediction=await recordOracle(path,{status:'forecast',method:'conditional-test',targetAt:'2020-01-01T00:00:00Z',probabilityPercent:80,source:'datos de prueba',evidenceStatus:'user_supplied_unverified',assumptions:[]})
  await assert.rejects(auditOracle(path,{id:prediction.id,observedValue:0.5,observedAt:'2021-01-01T00:00:00Z',source:'prueba'}),/binario/)
  const audit=await auditOracle(path,{id:prediction.id,observedValue:1,observedAt:'2021-01-01T00:00:00Z',source:'prueba'})
  assert(Math.abs(audit.brierError-0.04)<1e-10)
  const score=await oracleSummary(path)
  assert.equal(score.binarySettled,1)
  assert(Math.abs(score.meanBrierScore-0.04)<1e-10)
  assert.equal(score.verifiedByHost,0)
 } finally { await rm(dir,{recursive:true,force:true}) }
})
