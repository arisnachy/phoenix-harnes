import {test} from 'node:test'
import assert from 'node:assert/strict'
import {forecastOracle} from '../src/engine.ts'
const source='datos de prueba; sin verificacion externa'
test('caída ideal conforme a ley física, sin certeza indebida',()=>{
 const r=forecastOracle({mode:'free-fall',heightM:19.6133,source})
 assert.equal(r.status,'forecast');assert(Math.abs(r.predictedValue-2)<1e-10)
 assert(r.assumptions.some(x=>x.includes('resistencia')))
})
test('datos insuficientes llevan a abstención',()=>{
 const r=forecastOracle({mode:'time-series',values:[1,2,3],horizonSteps:2,stepHours:24,lastObservedAt:'2026-11-04T00:00:00Z',unit:'casos',source})
 assert.equal(r.status,'insufficient');assert.equal(r.predictedValue,undefined)
})
test('previsión temporal con horizonte correcto y backtest cronológico',()=>{
 const values=Array.from({length:35},(_,i)=>100+2*i)
 const r=forecastOracle({mode:'time-series',values,horizonSteps:3,stepHours:24,lastObservedAt:'2026-11-04T00:00:00Z',unit:'unidades',source})
 assert.equal(r.status,'forecast');assert.equal(r.targetAt,'2026-11-07T00:00:00.000Z')
 assert.equal(r.predictedValue,174);assert.equal(r.evaluation.chosen,'linear')
 assert.equal(r.evaluation.walkForwardFolds,25)
})
test('escenario causal responde a intervención pero no se presenta como ley validada',()=>{
 const r=forecastOracle({mode:'causal-scenario',source,target:'demanda',unit:'camas',current:{infecciones:10},nodes:[{id:'demanda',base:5,parents:[{id:'infecciones',coefficient:2,source:'coeficiente hipotetico'}]}],intervention:{id:'infecciones',value:7}})
 assert.equal(r.status,'scenario');assert.equal(r.baseline,25);assert.equal(r.counterfactual,19);assert.equal(r.delta,-6)
})
test('rechaza ciclo y valores no finitos',()=>{
 assert.throws(()=>forecastOracle({mode:'causal-scenario',source,target:'a',unit:'x',current:{},nodes:[{id:'a',base:0,parents:[{id:'b',coefficient:1,source:'x'}]},{id:'b',base:0,parents:[{id:'a',coefficient:1,source:'x'}]}]}),/ciclo/)
 assert.throws(()=>forecastOracle({mode:'free-fall',heightM:Infinity,source}),/finito/)
})
test('mezcla luz RGB no confunde pigmentos',()=>{
 const r=forecastOracle({mode:'rgb-light',a:[255,0,0],b:[0,0,255],source})
 assert.match(r.reason,/255, 0, 255/);assert.equal(r.status,'scenario')
})
