import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=await mkdtemp(join(tmpdir(),'phoenix-comic-test-'))
process.env.PHOENIX_COMICS_HOME=home
const { initSeries,addWorldRules,addCharacter,addLocation,addIssue,addPage,setIssueCovers,importImage,auditSeries,artBrief,renderIssue,listSeries }=await import('./phoenix-comic-studio.mjs')
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4EAAAAASUVORK5CYII=','base64')
const img=join(home,'asset.png')
await writeFile(img,image)
const character={id:'venga',name:'Venga',description:'Heroína original',visualSignature:'Pelo plateado, ojo verde, chaqueta escarlata, rostro ovalado',baseline:{costume:'scarlet',injury:'none',location:'tower'},references:{front:'hero-front',profile:'hero-side'},voice:'Directa y curiosa'}
const basePanel=(suffix='1')=>({id:`panel-${suffix}`,asset:`art-${suffix}`,location:'tower',action:'Venga mira hacia la ciudad',characters:[{id:'venga',pose:'de pie',costume:'scarlet',expression:'alerta'}],dialogue:[{speaker:'venga',text:'¡El portal está abierto!'}],changes:[],visualPrompt:'Plano medio. Mantener chaqueta escarlata.'})
test('memoria, referencias y render HTML persistentes', async()=>{
  const i=await initSeries('Guardianes de Orión',{seriesId:'guardianes-orion'})
  assert.equal(i.seriesId,'guardianes-orion')
  await addWorldRules(i.seriesId,['Los portales solo abren de noche'])
  await importImage(i.seriesId,'hero-front',img)
  await importImage(i.seriesId,'hero-side',img)
  await importImage(i.seriesId,'art-1',img)
  await importImage(i.seriesId,'art-2',img)
  await importImage(i.seriesId,'front-cover',img)
  await importImage(i.seriesId,'back-cover',img)
  await addCharacter(i.seriesId,character)
  await addLocation(i.seriesId,{id:'tower',name:'Torre',description:'Atalaya de vigilancia',referenceAsset:'hero-side'})
  await addIssue(i.seriesId,{id:'issue-one',number:1,title:'El portal',synopsis:'El inicio de la saga'})
  await addIssue(i.seriesId,{id:'issue-two',number:2,title:'La cicatriz',synopsis:'Consecuencias del portal'})
  await setIssueCovers(i.seriesId,'issue-one',{frontAsset:'front-cover',backAsset:'back-cover',tagline:'Al otro lado del portal',backBlurb:'Esta es la primera aventura de la saga.'})
  await setIssueCovers(i.seriesId,'issue-two',{frontAsset:'front-cover',backAsset:'back-cover',tagline:'El misterio continúa',backBlurb:'La cicatriz recuerda el portal.'})
  const one=basePanel('1');one.changes=[{subject:'venga',field:'injury',before:'none',after:'scar',reason:'Recibió un corte de cristal'}]
  await addPage(i.seriesId,'issue-one',{number:1,rows:[1],panels:[one]})
  const two=basePanel('2');two.changes=[{subject:'venga',field:'injury',before:'scar',after:'healed',reason:'Fue atendida en el hospital'}]
  await addPage(i.seriesId,'issue-two',{number:1,rows:[1],panels:[two]})
  const audit=await auditSeries(i.seriesId)
  assert.equal(audit.structurallyValid,true,JSON.stringify(audit.errors))
  assert.equal(audit.states['venga:injury'],'healed')
  assert.equal(audit.visualConsistencyVerified,false)
  assert.equal((await artBrief(i.seriesId,'issue-one')).shots[0].actorReferences[0].referenceAssets.front,'hero-front')
  const result=await renderIssue(i.seriesId,'issue-one')
  const html=await readFile(result.outputs.html,'utf8')
  assert.match(html,/¡El portal está abierto!/)
  assert.match(html,/data-comic-cover="front"/)
  assert.match(html,/data-comic-cover="back"/)
  assert.match(html,/class="panel-stage"/)
  assert.equal(result.manifest.editorialComplete,true)
  assert.equal(result.manifest.pages,3)
  assert.match(html,/data:image\/png;base64,/)
  assert.equal(result.manifest.humanArtReviewRequired,true)
  assert.deepEqual(await listSeries(),['guardianes-orion'])
})

test('editorial completo exige ambas cubiertas y no inventa éxito de publicación', async()=>{
  await addIssue('guardianes-orion',{id:'issue-uncovered',number:3,title:'Sin cubierta',synopsis:'Prueba incompleta'})
  await importImage('guardianes-orion','art-uncovered',img)
  await addPage('guardianes-orion','issue-uncovered',{number:1,panels:[basePanel('uncovered')]})
  await assert.rejects(renderIssue('guardianes-orion','issue-uncovered'),/portada y contraportada/)
  const draft=await renderIssue('guardianes-orion','issue-uncovered',{draft:true})
  assert.equal(draft.manifest.editorialComplete,false)
  assert.match(await readFile(draft.outputs.html,'utf8'),/Arte de cubierta pendiente/)
})
test('viñetas cinematográficas variables, siluetas diagonales, inserto circular y lectura por página', async()=>{
  await addIssue('guardianes-orion',{id:'issue-layout',number:4,title:'Composición libre',synopsis:'Diseño artístico'})
  await setIssueCovers('guardianes-orion','issue-layout',{frontAsset:'front-cover',backAsset:'back-cover',tagline:'Una sorpresa',backBlurb:'Aventura de cuatro viñetas'})
  for(let n=3;n<=6;n++)await importImage('guardianes-orion','art-'+n,img)
  const panels=[3,4,5,6].map(n=>({...basePanel(String(n)),sfx:n===6?'KRAAASH!':null}))
  await addPage('guardianes-orion','issue-layout',{number:1,panels,layout:{mode:'freeform',slots:[
    {id:'panel-3',x:0,y:0,width:1000,height:350,shape:'angled-bottom'},
    {id:'panel-4',x:0,y:365,width:460,height:635,shape:'slant-left'},
    {id:'panel-5',x:475,y:365,width:525,height:635,shape:'trapezoid'},
    {id:'panel-6',x:760,y:385,width:220,height:230,shape:'circle',overlay:true},
  ]}})
  const result=await renderIssue('guardianes-orion','issue-layout')
  const html=await readFile(result.outputs.html,'utf8')
  assert.match(html,/clip-path:polygon/)
  assert.match(html,/clip-path:ellipse/)
  assert.match(html,/KRAAASH!/)
  assert.equal(result.manifest.editorialComplete,true)
  assert.equal(result.manifest.dynamicPanelPages,1)
  assert.equal(result.manifest.pages,3)
  assert.ok(html.indexOf('data-comic-cover="front"')<html.indexOf('class="comic-page"'))
  assert.ok(html.indexOf('class="comic-page"')<html.indexOf('data-comic-cover="back"'))
})
test('rechaza viñetas fuera de página, solapamientos accidentales y layouts inventados', async()=>{
  await assert.rejects(addPage('guardianes-orion','issue-layout',{number:2,panels:[basePanel('1')],layout:{mode:'freeform',slots:[{id:'panel-1',x:980,y:0,width:400,height:250,shape:'rectangle'}]}}),/fuera de página/)
  await assert.rejects(addPage('guardianes-orion','issue-layout',{number:2,panels:[basePanel('1')],layout:{mode:'freeform',slots:[{id:'panel-1',x:0,y:0,width:1000,height:1000,shape:'injected'}]}}),/silueta/)
  await assert.rejects(setIssueCovers('guardianes-orion','issue-layout',{frontAsset:'front-cover',backAsset:'back-cover'}),/ya existe/)
})

test('no se sobrescriben personajes, arte, eventos ni páginas por accidente', async()=>{
  await assert.rejects(initSeries('Duplicado',{seriesId:'guardianes-orion'}),/ya existe/)
  await assert.rejects(addCharacter('guardianes-orion',character),/existente/)
  await assert.rejects(addWorldRules('guardianes-orion',['El agua hierve a 100']),/fijadas/)
  await assert.rejects(addPage('guardianes-orion','issue-one',{number:1,rows:[1],panels:[basePanel('1')]}),/ya existe/)
  await assert.rejects(initSeries('X',{seriesId:'../evil'}),/ID inválido/)
  await assert.rejects(importImage('guardianes-orion','../escape',img),/ID inválido/)
})
test('auditoría detecta edición externa del canon y arte sin generar falsos aprobados', async()=>{
  const p=JSON.parse(await readFile(join(home,'series','guardianes-orion','project.json'),'utf8'))
  p.issues[1].pages[0].panels[0].changes[0].before='none'
  await writeFile(join(home,'series','guardianes-orion','project.json'),JSON.stringify(p))
  let r=await auditSeries('guardianes-orion')
  assert.equal(r.structurallyValid,false)
  assert.ok(r.errors.some(x=>x.code==='contradictory-state'))
  await assert.rejects(renderIssue('guardianes-orion','issue-two'),/Bloqueo editorial/)
  p.issues[1].pages[0].panels[0].changes[0].before='scar'
  await writeFile(join(home,'series','guardianes-orion','project.json'),JSON.stringify(p))
  await writeFile(join(home,'series','guardianes-orion','assets',p.assets['art-1'].filename),Buffer.from('malicioso'))
  r=await auditSeries('guardianes-orion')
  assert.ok(r.errors.some(x=>x.code==='invalid-asset'))
  assert.ok(r.errors.some(x=>x.code==='missing-panel-art'))
  await assert.rejects(renderIssue('guardianes-orion','issue-one'),/Bloqueo editorial/)
})
test('limpieza',async()=>{await rm(home,{recursive:true,force:true})})