import {test} from 'node:test'
import assert from 'node:assert/strict'
import {publishOracleResearch} from '../src/research-publication.ts'
import {forecastOracleWeather} from '../src/weather.ts'
import {oracleEvidenceReportVisual,oracleWeatherVisual} from '../src/view.ts'
import {researchOracle} from '../src/research.ts'

const deadline='2099-11-13T03:59:59Z'
const question='¿La temperatura máxima diaria en Santo Domingo, República Dominicana, superará los 30 °C el 12 de noviembre de 2099?'
const official='https://indomet.gov.do/tiempo/'
const relevantHtml='<html><title>Pronóstico de temperatura máxima Santo Domingo República Dominicana</title><body>'+
  'Santo Domingo. República Dominicana. La temperatura máxima diaria se observa con estaciones de vigilancia. '+
  'INDOMET informa pronósticos meteorológicos mediante observaciones nacionales en Santo Domingo. '+ 
  'Se debe consultar la fecha y el modelo operativo, los valores diarios pueden variar.</body></html>'
test('hallar 0 fuentes es una etapa de investigación, no una predicción',async()=>{
  const web={async search(){return {sources:[]}}}
  const r=await researchOracle(web,question,deadline)
  assert.equal(r.status,'insufficient')
  assert.equal(r.sources.length,0)
  assert.equal(r.probabilityPercent,null)
  assert(r.searches.some(q=>q.includes('indomet.gov.do')))
  assert(r.sourceDirectories.some(x=>x.url.includes('indomet.gov.do')))
})
test('publica informe SOLO después de consultar y recuperar documentación real',async()=>{
  let visits=0
  const web={async fetch(){visits++;return {url:official,statusCode:200,truncated:false,
    body:{kind:'html',content:relevantHtml}}}}
  const r=await publishOracleResearch(web,{question,targetAt:deadline,urls:[official]})
  assert.equal(visits,1)
  assert.equal(r.status,'researched')
  assert.equal(r.documents.length,1)
  assert.equal(r.probabilityPercent,null)
  assert.equal(oracleEvidenceReportVisual(r).component,'ui_canvas')
})
test('CAPTCHA y páginas irrelevantes no permiten publicar card',async()=>{
  const blocked={async fetch(){return {url:official,statusCode:200,truncated:false,
    body:{kind:'html',content:'<html>Just a moment. CAPTCHA access denied. Verify you are human.</html>'}}}}
  const r=await publishOracleResearch(blocked,{question,targetAt:deadline,urls:[official]})
  assert.equal(r.status,'insufficient')
  assert.equal(r.documents.length,0)
  assert.throws(()=>oracleEvidenceReportVisual(r),/No hay documentos/)
})
test('la temperatura solo aparece al recibir modelo diario real, sin porcentaje inventado',async()=>{
  const target=new Date(Date.now()+4*86400000).toISOString().slice(0,10)
  const days=Array.from({length:8},(_,i)=>new Date(Date.now()+i*86400000).toISOString().slice(0,10))
  const sources=[]
  const web={async fetch({url}){
    sources.push(url)
    const response=url.includes('geocoding-api')?{results:[{name:'Santo Domingo',latitude:18.48,longitude:-69.94,country_code:'DO',country:'República Dominicana'}]}
      :{daily:{time:days,temperature_2m_max:[29,29.5,30.3,31.8,32.4,29,30,31]}}
    return {url,statusCode:200,truncated:false,body:{kind:'text',content:JSON.stringify(response)}}
  }}
  const result=await forecastOracleWeather(web,{location:'Santo Domingo, República Dominicana',countryCode:'DO',date:target,thresholdC:30})
  assert.equal(result.status,'forecast')
  assert.equal(result.expectedMaxC,32.4)
  assert.equal(result.exceedsThreshold,true)
  assert.equal(result.probabilityPercent,null)
  assert.equal(result.daily.length,8)
  assert(sources.some(s=>s.includes('daily=temperature_2m_max')))
  assert.equal(oracleWeatherVisual(result).component,'ui_canvas')
})
test('no publica tarjeta de predicción para una fecha fuera del horizonte diario',async()=>{
  const web={async fetch({url}){
    const response=url.includes('geocoding-api')?{results:[{name:'Santo Domingo',latitude:18.48,longitude:-69.94,country_code:'DO',country:'República Dominicana'}]}
      :{daily:{time:['2026-11-05','2026-11-06'],temperature_2m_max:[32,33]}}
    return {url,statusCode:200,truncated:false,body:{kind:'text',content:JSON.stringify(response)}}
  }}
  const r=await forecastOracleWeather(web,{location:'Santo Domingo',countryCode:'DO',date:'2099-11-12',thresholdC:30})
  assert.equal(r.status,'insufficient')
  assert.throws(()=>oracleWeatherVisual(r),/No hay pronóstico/)
})
