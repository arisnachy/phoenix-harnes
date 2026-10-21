import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=await mkdtemp(join(tmpdir(),'phoenix-comic-recover-'))
process.env.PHOENIX_COMICS_HOME=home
const { planComicArt, recordComicImageAttempt, acceptComicImage, inspectComicImageResponse, comicRecoveryStatus } = await import('./phoenix-comic-recovery.mjs')
const series='night-signal',issue='number-one',directory=join(home,'series',series),workspace=join(home,'downloads')
await mkdir(directory,{recursive:true});await mkdir(workspace,{recursive:true})
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4EAAAAASUVORK5CYII=','base64')
await writeFile(join(workspace,'page-one.png'),image)
await writeFile(join(directory,'project.json'),JSON.stringify({
  schemaVersion:1,id:series,revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
  title:'La señal de medianoche',language:'es',style:'novela gráfica',worldRules:[],assets:{},characters:[],locations:[],
  issues:[{id:issue,number:1,title:'Medianoche',synopsis:'Misterio del faro',pages:[],covers:null}]
}))
test('no se inventa ni se intercambia un ID de diseño con un ID de activo Canva',()=>{
  const response={content:[{type:'text',text:JSON.stringify({images:[{file_path:'page-one.png',design_id:'DA-123',asset_id:'MA-456'}]})}]}
  const scan=inspectComicImageResponse(response)
  assert.deepEqual(scan.localCandidates,['page-one.png'])
  assert.deepEqual(scan.providerIds,[{type:'design_id',value:'DA-123'},{type:'asset_id',value:'MA-456'}])
  assert.equal(scan.malformedJson,false)
  assert.equal(inspectComicImageResponse({content:[{type:'text',text:'{"images":['}]}).malformedJson,true)
})
test('edición planificada y recuperación idempotente de seis páginas sin borrar nada',async()=>{
  const plan=await planComicArt(series,issue,{interiorPages:6})
  assert.equal(plan.slots.length,8)
  assert.deepEqual(plan.slots.slice(0,2),['cover-front','page-1'])
  assert.equal((await planComicArt(series,issue,{interiorPages:6})).reused,true)
  await assert.rejects(planComicArt(series,issue,{interiorPages:4}),/distinto/)
})
test('la respuesta mal formada se archiva con su SHA y contenido exactos para recuperación',async()=>{
  const result=await recordComicImageAttempt(series,issue,{attemptId:'attempt-a',slot:'page-1',provider:'Canva',response:'{"images":[',workspace})
  assert.equal(result.status,'malformed-json')
  assert.equal(result.rawResult,'{"images":[')
  assert.equal(result.responseHash,createHash('sha256').update('{"images":[').digest('hex'))
  assert.equal((await recordComicImageAttempt(series,issue,{attemptId:'attempt-a',slot:'page-1',provider:'Canva',response:'{"images":[',workspace})).reused,true)
  await assert.rejects(recordComicImageAttempt(series,issue,{attemptId:'attempt-a',slot:'page-1',provider:'Canva',response:'otro',workspace}),/sobrescriben/)
})
test('reconoce un archivo real recuperado, exige revisión y luego evita regenerar esa página',async()=>{
  const result=await recordComicImageAttempt(series,issue,{
    attemptId:'attempt-b',slot:'page-1',provider:'Canva',workspace,
    response:{content:[{type:'text',text:JSON.stringify({image:{path:'page-one.png',design_id:'DA77'}})}]}
  })
  assert.equal(result.status,'local-file-found')
  assert.equal(result.localCandidates[0].verifiedLocalFile,true)
  const before=await comicRecoveryStatus(series,issue,{workspace})
  assert.equal(before.verified,0)
  assert.deepEqual(before.pendingReview,['page-1'])
  assert.equal(before.localDiscoveries.length,1)
  await assert.rejects(acceptComicImage(series,issue,{slot:'page-2',filePath:'../elsewhere.png',workspace}),/no está disponible/)
  await acceptComicImage(series,issue,{slot:'page-1',filePath:'page-one.png',workspace,attemptId:'attempt-b'})
  const after=await comicRecoveryStatus(series,issue)
  assert.equal(after.verified,1)
  assert.equal(after.needsGeneration.includes('page-1'),false)
  assert.equal(after.needsGeneration.includes('page-2'),true)
  assert.equal(after.noProviderCallsWereMade,true)
  assert.equal((await acceptComicImage(series,issue,{slot:'page-1',filePath:'page-one.png',workspace,attemptId:'attempt-b'})).reused,true)
})
test('un identificador remoto rechazado sigue siendo solo evidencia, no imagen verificada',async()=>{
  const receipt=await recordComicImageAttempt(series,issue,{attemptId:'attempt-c',slot:'page-2',provider:'Canva',workspace,response:{design_id:'DAGunresolved'}})
  assert.equal(receipt.status,'provider-id-only')
  assert.deepEqual(receipt.providerIds,[{type:'design_id',value:'DAGunresolved'}])
  assert.equal((await comicRecoveryStatus(series,issue)).slots.find(x=>x.slot==='page-2').status,'provider-id-only')
})
test('limpieza',async()=>{await rm(home,{recursive:true,force:true})})
