import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileGeoJson, parseCsvGeo, statistics, reportMarkdown } from './phoenix-geo.mjs'
const sample={type:'FeatureCollection',features:[
  {type:'Feature',id:'a',properties:{name:'A',value:10},geometry:{type:'Point',coordinates:[-70.70,19.45]}},
  {type:'Feature',id:'b',properties:{name:'B',value:20},geometry:{type:'Point',coordinates:[-70.74,19.48]}},
]}
test('compila mapa válido, sin coordenadas inventadas',()=>{
  const r=compileGeoJson(sample,{source:'CSV auditado',title:'Santiago',theme:'business',polarity:'higher-better'})
  assert.equal(r.spec.component,'geo_map')
  assert.deepEqual(r.spec.props.layers[0].features[0].coordinates,[[-70.70,19.45]])
  assert.equal(r.statistics.mean,15)
  assert.equal(r.spec.props.layers[0].features[0].color,'#ce493f')
  assert.match(reportMarkdown(r),/WGS84/)
})
test('frena coordenadas inválidas y datos no comprobados',()=>{
  assert.throws(()=>compileGeoJson(sample,{}),/fuente real/)
  assert.throws(()=>compileGeoJson({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[400,0]}}]}, {source:'S'}),/inválida/)
})
test('importa CSV con comas y valores verificados',()=>{
  const data=parseCsvGeo('nombre,latitud,longitud,ventas\n"Centro, Santiago",19.45,-70.7,12\n')
  assert.equal(data.features[0].properties.name,'Centro, Santiago')
  assert.equal(data.features[0].properties.value,12)
  assert.throws(()=>parseCsvGeo('nombre,latitud,longitud\nA,xx,-70\n'),/Coordenadas inválidas/)
})
test('estadística no inventa métricas',()=>{
  assert.deepEqual(statistics([{value:undefined}]).values,0)
})
