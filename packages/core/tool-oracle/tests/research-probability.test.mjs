import {test} from 'node:test'
import assert from 'node:assert/strict'
import {forecastOracle} from '../src/engine.ts'
import {researchOracle} from '../src/research.ts'
import {oracleVisual} from '../src/view.ts'

const now='2099-01-01T00:00:00Z',source='conjunto de prueba NO autenticado'
const cases=Array.from({length:140},(_,i)=>({
  id:'case-'+i,
  observedAt:new Date(Date.parse('2025-01-01T00:00:00Z')+i*86400000).toISOString(),
  signal:i%2===0,
  happened:i%2===0 ? i%10!==0 : i%11===1,
}))

test('calcula porcentaje condicionado solo con holdout temporal y Brier',()=>{
  const r=forecastOracle({mode:'binary-event',source,question:'¿Se activará la señal en la siguiente ocasión?',targetAt:now,cases,currentSignal:true})
  assert.equal(r.status,'forecast')
  assert.equal(typeof r.probabilityPercent,'number')
  assert(r.probabilityPercent>70)
  assert(r.probabilityPercent<100)
  assert(r.probabilityEvaluation.modelBrier<=r.probabilityEvaluation.baselineBrier)
  assert(r.probabilityInterval80.lower<r.probabilityPercent)
  assert(r.probabilityInterval80.upper>r.probabilityPercent)
})

test('abstención en eventos sin históricos suficientes',()=>{
  const r=forecastOracle({mode:'binary-event',source,question:'¿Sucederá el evento registrado en el futuro?',targetAt:now,cases:cases.slice(0,40),currentSignal:true})
  assert.equal(r.status,'insufficient')
  assert.equal(r.probabilityPercent,undefined)
})

test('fuga temporal y duplicación de casos no se aceptan',()=>{
  assert.throws(()=>forecastOracle({mode:'binary-event',source,question:'¿Sucederá un evento futuro observable?',targetAt:now,
    cases:[...cases.slice(0,-1),{...cases[0]}],currentSignal:true}),/duplicado/)
})

test('la investigación usa búsquedas web reales y NO fabrica porcentaje',async()=>{
  const queries=[]
  const web={async search(input){queries.push(input.query);return{sources:[
    {url:'https://example.edu/study',title:'Estudio A',snippet:'Cohorte observada'},
    {url:'https://example.org/data',title:'Datos B',publishedAt:'2025-05-01'},
  ]}}}
  const r=await researchOracle(web,'¿Aumentará el número de casos de dengue?',now)
  assert.equal(r.status,'researched')
  assert.equal(r.probabilityPercent,null)
  assert.equal(r.sources.length,2)
  assert.equal(queries.length,2)
  assert.equal(oracleVisual(r).component,'ui_canvas')
})

test('sin fuentes independientes la investigación se abstiene',async()=>{
  const web={async search(){throw new Error('No hay proveedor web')}}
  const r=await researchOracle(web,'¿Se producirá un evento nuevo?',now)
  assert.equal(r.status,'insufficient')
  assert.equal(r.probabilityPercent,null)
})
