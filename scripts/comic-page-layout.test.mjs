import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePageLayout, panelGeometry, hasDynamicPanels, EDITORIAL_CSS } from './comic-page-layout.mjs'

const panels = n => Array.from({length:n}, (_,i)=>({id:`shot-${i}`}))
test('presets cinematicos son deterministas, no uniformes y encajan hasta 20 viñetas', () => {
  for(let n=1;n<=20;n++) {
    const page={panels:panels(n)}
    assert.deepEqual(resolvePageLayout(page),resolvePageLayout(page))
    const slots=resolvePageLayout(page)
    assert.equal(slots.length,n)
    assert.deepEqual(slots.map(s=>s.id),panels(n).map(s=>s.id))
    for(const slot of slots){
      assert.ok(slot.x>=0 && slot.x+slot.width<=1000)
      assert.ok(slot.y>=0 && slot.y+slot.height<=1000)
      assert.match(panelGeometry(slot,0),/clip-path:/)
    }
    if(n>1)assert.equal(hasDynamicPanels(page),true)
  }
})
test('permite layout editorial de viñetas diagonales con inserto circular superpuesto', () => {
  const page={panels:panels(4),layout:{mode:'freeform',slots:[
    {id:'shot-0',x:0,y:0,width:1000,height:360,shape:'angled-bottom'},
    {id:'shot-1',x:0,y:374,width:454,height:626,shape:'slant-left'},
    {id:'shot-2',x:468,y:374,width:532,height:626,shape:'trapezoid'},
    {id:'shot-3',x:780,y:400,width:190,height:210,shape:'circle',overlay:true},
  ]}}
  assert.equal(resolvePageLayout(page)[3].overlay,true)
  assert.match(panelGeometry(resolvePageLayout(page)[3],3),/clip-path:ellipse/)
  assert.equal(hasDynamicPanels(page),true)
  assert.match(EDITORIAL_CSS,/\.comic-cover-page/)
})
test('rechaza escapes del área, solapes no declarados, polígonos no permitidos y páginas vacías', () => {
  const p=panels(2)
  const mk=slots=>({panels:p,layout:{mode:'freeform',slots}})
  assert.throws(()=>resolvePageLayout({panels:[]}),/sin viñetas/)
  assert.throws(()=>resolvePageLayout(mk([
    {id:'shot-0',x:0,y:0,width:900,height:700},
    {id:'shot-1',x:500,y:100,width:500,height:900},
  ])),/superponen/)
  assert.throws(()=>resolvePageLayout(mk([
    {id:'shot-0',x:950,y:0,width:100,height:600},
    {id:'shot-1',x:0,y:0,width:1000,height:1000},
  ])),/fuera de página/)
  assert.throws(()=>resolvePageLayout(mk([
    {id:'shot-0',x:0,y:0,width:1000,height:430,shape:'javascript:alert'},
    {id:'shot-1',x:0,y:450,width:1000,height:550},
  ])),/silueta/)
})