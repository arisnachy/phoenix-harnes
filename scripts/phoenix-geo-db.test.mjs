import {test} from 'node:test'
import assert from 'node:assert/strict'
import {h3Query,planarQuery,copyScript,scoped} from './phoenix-geo-db.mjs'
test('bloquea interpolación SQL fuera del ámbito permitido',()=>{
 assert.throws(()=>scoped("a';drop table x"),/inválido/)
 assert.throws(()=>planarQuery('a','b;',500),/inválido/)
})
test('hexágonos PostGIS reales y transformaciones WGS84',()=>{
 const sql=planarQuery('A','B',500);assert.match(sql,/ST_HexagonGrid\(500,/);assert.match(sql,/ST_Transform\(geom,4326\)/)
})
test('H3 auténtico con extensión h3-pg, resolución estricta',()=>{
 const sql=h3Query('A','B',8);assert.match(sql,/h3_latlng_to_cell/);assert.match(sql,/h3_cell_to_boundary_geometry/)
 assert.throws(()=>h3Query('A','B',16),/resolución/)
})
test('ingesta COPY bajo transacción y por escena',()=>{
 const fc={type:'FeatureCollection',features:[{type:'Feature',id:'x',properties:{name:'A',value:4},geometry:{type:'Point',coordinates:[-70.7,19.4]}}]}
 const sql=copyScript('A','B',fc);assert.match(sql,/BEGIN;/);assert.match(sql,/COPY geo_stage/)
 assert.match(sql,/workspace_key='A' AND scene_key='B'/);assert.match(sql,/COMMIT;/)
})
