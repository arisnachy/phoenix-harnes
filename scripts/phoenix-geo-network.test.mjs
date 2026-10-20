import { test } from 'node:test'
import assert from 'node:assert/strict'
import {geocode,reverseGeocode,route,providerUrl} from './phoenix-geo-network.mjs'
const mock = value => async url => ({
 ok:true,status:200,headers:{get:()=>null}, text:async()=>JSON.stringify(value),url:String(url),
})
test('no dependencias de geocodificación pública ni protocolos inseguros',()=>{
 assert.throws(()=>providerUrl('https://nominatim.openstreetmap.org','geo'),/no está autorizado/)
 assert.throws(()=>providerUrl('http://metadata.google.internal','geo'),/HTTPS/)
 assert.throws(()=>providerUrl('https://router.project-osrm.org','routing'),/no está autorizado/)
})
test('geocodificación real es resultado del proveedor, sin inventar puntos',async()=>{
 const f=await geocode('Centro Santiago',{endpoint:'https://geo.example.net',fetchImpl:mock([{lat:'19.452',lon:'-70.703',display_name:'Centro, Santiago'}])})
 assert.deepEqual(f.features[0].geometry.coordinates,[-70.703,19.452])
 assert.equal(f.features[0].properties.confidence,'provider-result-not-verified')
})
test('geocodificación inversa conserva el punto proporcionado',async()=>{
 const r=await reverseGeocode([-70.7,19.45],{endpoint:'https://geo.example.net',fetchImpl:mock({display_name:'Calle XX'})})
 assert.deepEqual(r.features[0].geometry.coordinates,[-70.7,19.45])
})
test('enrutado valida el itinerario real y devuelve distancia / duración del proveedor',async()=>{
 const body={code:'Ok',routes:[{distance:850,duration:80,geometry:{coordinates:[[-70.70,19.45],[-70.72,19.46]]}}]}
 const f=await route([[-70.70,19.45],[-70.72,19.46]],{endpoint:'https://route.example.net',fetchImpl:mock(body)})
 assert.equal(f.features[0].properties.distanceMeters,850)
 assert.equal(f.features[0].properties.durationSeconds,80)
 assert.equal(f.features[0].geometry.type,'LineString')
 assert.equal(f.features.length,3)
})
test('no simula ruta cuando el proveedor no tiene datos',async()=>{
 await assert.rejects(()=>route([[-70.70,19.45],[-70.72,19.46]],{endpoint:'https://route.example.net',fetchImpl:mock({code:'NoRoute',routes:[]})}),/ruta calculada/)
})
