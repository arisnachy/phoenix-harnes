import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=await mkdtemp(join(tmpdir(),'phoenix-comic-test-'))
process.env.PHOENIX_COMICS_HOME=home
const { initSeries,addWorldRules,addCharacter,addLocation,addIssue,addPage,importImage,auditSeries,artBrief,renderIssue,listSeries }=await import('./phoenix-comic-studio.mjs')
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
  await addCharacter(i.seriesId,character)
  await addLocation(i.seriesId,{id:'tower',name:'Torre',description:'Atalaya de vigilancia',referenceAsset:'hero-side'})
  await addIssue(i.seriesId,{id:'issue-one',number:1,title:'El portal',synopsis:'El inicio de la saga'})
  await addIssue(i.seriesId,{id:'issue-two',number:2,title:'La cicatriz',synopsis:'Consecuencias del portal'})
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
  assert.match(html,/data:image\/png;base64,/)
  assert.equal(result.manifest.humanArtReviewRequired,true)
  assert.deepEqual(await listSeries(),['guardianes-orion'])
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