import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forecastPublicCsv, forecastPublicBinaryCsv, csvRows } from '../src/public-csv.ts'
import { oracleVisual } from '../src/view.ts'

function fixture(){
  const base=new Date()
  base.setUTCHours(0,0,0,0)
  base.setUTCDate(base.getUTCDate()-1)
  const dates=Array.from({length:50},(_,i)=>{
    const d=new Date(base.getTime()-(49-i)*86_400_000)
    return d.toISOString().slice(0,10)
  })
  return 'date,cases\n'+dates.map((d,i)=>d+','+(10+i*2)).join('\n')+'\n'
}
const input={url:'https://official.example.org/daily-cases.csv',dateColumn:'date',valueColumn:'cases',unit:'casos',stepHours:24,horizonSteps:3}
const client=(content)=>({fetch:async({url})=>({url,statusCode:200,truncated:false,body:{kind:'text',content}})})

test('descarga un conjunto público, valida intervalos y pronostica sin inventar observaciones',async()=>{
  const forecast=await forecastPublicCsv(client(fixture()),input)
  assert.equal(forecast.result.status,'forecast')
  assert.equal(forecast.result.predictedValue,114)
  assert.equal(forecast.result.evidenceStatus,'retrieved_unverified')
  assert.equal(forecast.evidence.observations,50)
  assert.match(forecast.evidence.sha256,/^[a-f0-9]{64}$/)
  assert.equal(oracleVisual(forecast.result,undefined,forecast.evidence).component,'ui_canvas')
  assert(Date.parse(forecast.result.targetAt)>Date.now())
})

test('CSV RFC4180 conserva comillas, saltos internos y datos con comas',()=>{
  assert.deepEqual(csvRows('date,"cases,total"\n"2026-01-01","123"\n'),[
    ['date','cases,total'],['2026-01-01','123'],
  ])
})

test('rechaza lagunas temporales, valores fabricados o columnas equivocadas',async()=>{
  const gap=fixture().split('\n')
  gap.splice(15,1)
  await assert.rejects(forecastPublicCsv(client(gap.join('\n')),input),/huecos|intervalos/)
  await assert.rejects(forecastPublicCsv(client(fixture()),{...input,valueColumn:'invented'}),/Columnas/)
})

test('rechaza URL privada, no HTTPS y respuestas truncadas',async()=>{
  await assert.rejects(forecastPublicCsv(client(fixture()),{...input,url:'http://example.org/a.csv'}),/HTTPS/)
  await assert.rejects(forecastPublicCsv(client(fixture()),{...input,url:'https://admin:secret@example.org/data.csv'}),/HTTPS/)
  const truncated={fetch:async()=>({url:input.url,statusCode:200,truncated:true,body:{kind:'text',content:fixture()}})}
  await assert.rejects(forecastPublicCsv(truncated,input),/completo/)
})

test('el sistema no produce pronóstico futuro con una serie caducada',async()=>{
  const stale='date,cases\n'+Array.from({length:40},(_,i)=>new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10)+','+i).join('\n')
  await assert.rejects(forecastPublicCsv(client(stale),input),/inválida|antigua|fecha/i)
})


function eventFixture(){
  const rows=['id,signalAt,resolvedAt,signal,happened']
  for(let i=0;i<140;i++){
    const signalAt=new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)
    const resolvedAt=new Date(Date.UTC(2025,0,2+i)).toISOString().slice(0,10)
    const signal=i%2===0
    const happened=signal?i%10!==0:i%11===1
    rows.push(['row-'+i,signalAt,resolvedAt,Number(signal),Number(happened)].join(','))
  }
  return rows.join('\n')
}
const eventRequest={
  url:'https://official.example.org/historical-events.csv',
  question:'¿Se producirá el evento verificable en el horizonte previsto?',
  targetAt:'2099-01-01T00:00:00Z',
  idColumn:'id',signalAtColumn:'signalAt',resolvedAtColumn:'resolvedAt',
  signalColumn:'signal',outcomeColumn:'happened',currentSignal:true,
}
test('calcula una probabilidad de suceso a partir de episodios PUBLICADOS, con resolución posterior a señal',async()=>{
  const data=await forecastPublicBinaryCsv(client(eventFixture()),eventRequest)
  assert.equal(data.result.status,'forecast')
  assert.equal(data.evidence.observations,140)
  assert.equal(data.result.evidenceStatus,'retrieved_unverified')
  assert(data.result.probabilityPercent>70)
  assert(data.result.probabilityEvaluation.modelBrier<data.result.probabilityEvaluation.baselineBrier)
  assert(data.result.probabilityEvaluation.trainCount<98) // an overlapping resolution is purged
  assert.equal(oracleVisual(data.result,eventRequest.question,data.evidence).component,'ui_canvas')
})
test('no incorpora desenlaces anteriores a su señal ni episodios sin resolución',async()=>{
  const lines=eventFixture().split('\n')
  const parts=lines[1].split(',')
  parts[2]=parts[1]
  lines[1]=parts.join(',')
  await assert.rejects(forecastPublicBinaryCsv(client(lines.join('\n')),eventRequest),/preceder/)
  await assert.rejects(forecastPublicBinaryCsv(client(eventFixture()),{...eventRequest,outcomeColumn:'sin_casos'}),/columnas/)
})
