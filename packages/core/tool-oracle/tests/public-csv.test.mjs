import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forecastPublicCsv, csvRows } from '../src/public-csv.ts'
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
  const stale='date,cases\n'+Array.from({length:40},(_,i)=>'2020-01-'+String(1+i).padStart(2,'0')+','+i).join('\n')
  await assert.rejects(forecastPublicCsv(client(stale),input),/inválida|antigua|fecha/i)
})
