import {test} from 'node:test'
import assert from 'node:assert/strict'
import {renderGeoPDF} from './phoenix-geo-pdf.mjs'
import {compileGeoJson} from './phoenix-geo.mjs'
test('PDF cartografico real con dos paginas, geometria y fuente',()=>{
 const input={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Santiago',value:90},geometry:{type:'Point',coordinates:[-70.7,19.45]}}]}
 const b=renderGeoPDF(compileGeoJson(input,{title:'Informe territorial',source:'Censo auditado',metric:'Casos'}))
 const s=b.toString('latin1')
 assert.match(s,/^%PDF-1.4/);assert.match(s,/Informe territorial/);assert.match(s,/Censo auditado/)
 assert.match(s,/\/Count 2/);assert.ok(b.length>1800)
 const xref=Number(s.match(/startxref\n(\d+)/)?.[1]);assert.equal(s.slice(xref,xref+4),'xref')
 assert.match(s,/%%EOF/)
})
