import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const home=await mkdtemp(join(tmpdir(),'phoenix-comic-canon-'))
process.env.PHOENIX_COMICS_HOME=home
const {
  proposeComicCanon, lockComicCanon, readComicCanon, comicProviderPacket
}=await import('./phoenix-comic-canon.mjs')
const p=join(home,'series','heroes'),assets=join(p,'assets')
await mkdir(assets,{recursive:true})
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4EAAAAASUVORK5CYII=','base64')
const sha=createHash('sha256').update(bytes).digest('hex')
await writeFile(join(assets,sha+'.png'),bytes)
await writeFile(join(p,'project.json'),JSON.stringify({
  schemaVersion:1,id:'heroes',title:'Los Guardianes del Portal',revision:1,assets:{
    'target-cover':{id:'target-cover',sha256:sha,filename:sha+'.png',mime:'image/png'},
    'actual-illustration':{id:'actual-illustration',sha256:sha,filename:sha+'.png',mime:'image/png'},
  },characters:[{id:'kai',name:'Kai'}],locations:[],issues:[
    {id:'one',number:1,title:'La grieta de fuego',pages:[],covers:null}
  ]
}))
const spec={
  style:{genre:'superhéroes',rendering:'Tinta vibrante, entintado nítido, color saturado y estética de cómic editorial',
    atmosphere:'Ciencia ficción de alta energía',palette:'azul, verde, naranja',exclusions:'No reinterpretar como ilustración marítima'},
  story:{synopsis:'Tres guardianes descubren un portal a mundos en ruinas',pages:[{number:1,
    beat:'Kai y Lía encuentran el portal',composition:'Viñetas diagonales y circulares; lectura natural'}]},
  editorial:{format:'Portada + interiores + contraportada',panelLanguage:'Viñetas libres, onomatopeyas, globos separados',
    frontCover:'Logotipo y equipo entrando al portal',backCover:'Sinopsis y presentación del equipo'},
  characters:[{id:'kai',appearance:'Pelo castaño, manga azul, guante luminoso',costume:'Chaqueta azul'}],
  references:[{assetId:'target-cover',role:'cover-target',note:'Ejemplo de portada deseada, no obra aprobada'},
    {assetId:'actual-illustration',role:'generated-art',note:'Ilustración real independiente: requiere revisión estética'}]
}
test('el canon pertenece a la serie y no confunde la portada objetivo con una imagen ya producida',async()=>{
  const v=await proposeComicCanon('heroes','one',spec)
  assert.equal(v.status,'draft')
  assert.equal(v.contract.references[0].role,'cover-target')
  assert.equal(v.contract.references[1].role,'generated-art')
  assert.equal((await proposeComicCanon('heroes','one',spec)).reused,true)
  await assert.rejects(proposeComicCanon('heroes','one',{...spec,style:{...spec.style,genre:'marítimo'}}),/no se puede reemplazar/)
  const packet=await readComicCanon('heroes','one')
  assert.equal(packet.locked,false)
  await assert.rejects(comicProviderPacket('heroes','one',{slot:'page-1'}),/carece de aprobación/)
  await assert.rejects(proposeComicCanon('otra-serie','one',spec),/ENOENT|no encontrada/)
})
test('aprobación explícita, digest exacto y referencias byte-verificadas bloquean la dirección',async()=>{
  const draft=await readComicCanon('heroes','one')
  await assert.rejects(lockComicCanon('heroes','one',{expectedDigest:draft.digest,approvalSource:'ai',
    approvalEvidence:'Kira decidió el estilo'}),/aprobación expresa/)
  await assert.rejects(lockComicCanon('heroes','one',{expectedDigest:'0'.repeat(64),approvalSource:'explicit-user',
    approvalEvidence:'Aprobé esta portada y dirección'}),/obsoleta/)
  const v=await lockComicCanon('heroes','one',{expectedDigest:draft.digest,approvalSource:'explicit-user',
    approvalEvidence:'El usuario aprueba el estilo del cómic y su portada'})
  assert.equal(v.locked,true)
  assert.equal((await readComicCanon('heroes','one')).status,'locked')
  assert.equal((await lockComicCanon('heroes','one',{expectedDigest:draft.digest,approvalSource:'explicit-user',
    approvalEvidence:'Persistencia tras reinicio'})).digest,draft.digest)
})
test('Canva solo maqueta arte existente, sin redefinir paleta, universo o personajes',async()=>{
  const image=await comicProviderPacket('heroes','one',{slot:'page-1',provider:'image-generator'})
  assert.equal(image.mode,'generate-missing-illustration')
  assert.match(image.scene.beat,/encuentran el portal/)
  assert.equal(image.references.find(r=>r.role==='cover-target').assetId,'target-cover')
  const canva=await comicProviderPacket('heroes','one',{slot:'page-1',provider:'Canva'})
  assert.equal(canva.mode,'layout-only')
  assert.equal(canva.allowRegeneration,false)
  assert.deepEqual(canva.references.map(r=>r.role),['generated-art'])
  assert.equal(canva.targetDesignNotes[0].role,'cover-target')
  assert.equal(canva.canonDigest,image.canonDigest)
  assert.equal(canva.style.rendering,spec.style.rendering)
  await assert.rejects(comicProviderPacket('heroes','one',{slot:'page-2'}),/fuera de la secuencia/)
})
test('intentos de Canva con canon ajeno siguen registrados pero no se aceptan como arte aprobado',async()=>{
  const {planComicArt,recordComicImageAttempt,comicRecoveryStatus,acceptComicImage}=await import('./phoenix-comic-recovery.mjs')
  await planComicArt('heroes','one',{interiorPages:1})
  const digest=(await readComicCanon('heroes','one')).digest
  const workspace=join(home,'workspace')
  await mkdir(workspace,{recursive:true})
  await writeFile(join(workspace,'panel.png'),bytes)
  const bad=await recordComicImageAttempt('heroes','one',{attemptId:'canva-bad',slot:'page-1',
    canonDigest:'f'.repeat(64),provider:'Canva',workspace,
    response:{file_path:'panel.png',design_id:'DAG123'}})
  assert.equal(bad.status,'canon-mismatch')
  const recovered=await comicRecoveryStatus('heroes','one',{workspace})
  assert.equal(recovered.creativeCanon.locked,true)
  assert.equal(recovered.mayGenerateFinalArt,true)
  assert.equal(recovered.pendingReview.includes('page-1'),false)
  assert.equal(recovered.slots.find(x=>x.slot==='page-1').mismatchedAttempts,1)
  await assert.rejects(acceptComicImage('heroes','one',{slot:'page-1',filePath:'panel.png',
    workspace,attemptId:'canva-bad',canonDigest:digest,
    visualReviewEvidence:'La ilustración fue revisada con el canon aprobado'}),/dirección creativa/)
  const good=await recordComicImageAttempt('heroes','one',{attemptId:'canva-good',slot:'page-1',
    canonDigest:digest,provider:'Generador',workspace,response:{file_path:'panel.png'}})
  assert.equal(good.status,'local-file-found')
  await assert.rejects(acceptComicImage('heroes','one',{slot:'page-1',filePath:'panel.png',
    workspace,attemptId:'canva-good'}),/Canon bloqueado/)
  const accepted=await acceptComicImage('heroes','one',{slot:'page-1',filePath:'panel.png',
    workspace,attemptId:'canva-good',canonDigest:digest,
    visualReviewEvidence:'Revisé expresiones, paleta y personajes contra la biblia'})
  assert.equal(accepted.canonDigest,digest)
  assert.equal((await comicRecoveryStatus('heroes','one')).needsGeneration.includes('page-1'),false)
})
test('cambio de bytes en imagen de referencia invalida el paquete en todas las herramientas',async()=>{
  await writeFile(join(assets,sha+'.png'),Buffer.from('imagen cambiada'))
  await assert.rejects(readComicCanon('heroes','one'),/no coincide/)
  await assert.rejects(comicProviderPacket('heroes','one',{slot:'cover-front',provider:'canva'}),/no coincide/)
})
test('limpieza',async()=>{await rm(home,{recursive:true,force:true})})
