/** Persistable, quote-anchored continuity ledger for long-form Phoenix books.
 * This checks explicit state transitions, not fictional truth or literary quality.
 */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const label = /^[\p{L}\p{N}][\p{L}\p{N} _.'’:-]{1,119}$/u
const key = /^[a-z][a-z0-9-]{1,63}$/u
const digest = /^[a-f0-9]{64}$/u
const fields = new Set(['location','status','knows','owns','goal','relationship','injury','secret','motivation','world-state'])
const object = v => !!v && typeof v === 'object' && !Array.isArray(v)

export function validateStoryLedger(payload, blueprint) {
  if (!object(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.events) ||
      payload.events.length > 5000) throw Error('Diario narrativo requiere schemaVersion 1 y máximo 5000 eventos.')
  const chapters = blueprint?.chapters
  if (!Array.isArray(chapters) || !chapters.length) throw Error('Se necesita blueprint validado antes del diario narrativo.')
  const result=[],seen=new Set()
  for (const raw of payload.events) {
    if (!object(raw) || !key.test(raw.id ?? '') || seen.has(raw.id)) throw Error('ID narrativo inválido o duplicado.')
    seen.add(raw.id)
    const chapter=raw.chapter,sequence=raw.sequence
    if (!Number.isSafeInteger(chapter) || chapter<1 || chapter>chapters.length ||
        !Number.isSafeInteger(sequence) || sequence<1 || sequence>1000) throw Error('Orden narrativo inválido.')
    if (typeof raw.actor!=='string' || !label.test(raw.actor) ||
        typeof raw.field!=='string' || !fields.has(raw.field)) throw Error('Actor o propiedad narrativa inválidos.')
    const before=raw.before
    if (before!==null && (typeof before!=='string'||before.length>160)) throw Error('Estado anterior inválido.')
    if (typeof raw.after!=='string' || raw.after.trim().length<2 || raw.after.length>160) throw Error('Estado nuevo inválido.')
    if (typeof raw.quote!=='string' || raw.quote.trim().length<18 || raw.quote.length>350) throw Error('Necesita cita de una escena real.')
    if (typeof raw.chapterSha256!=='string' || !digest.test(raw.chapterSha256)) throw Error('Falta SHA-256 del capítulo que prueba el evento.')
    result.push({id:raw.id,chapter,sequence,actor:raw.actor.trim(),
      field:raw.field,before,after:raw.after.trim(),quote:raw.quote.trim(),chapterSha256:raw.chapterSha256})
  }
  result.sort((a,b)=>a.chapter-b.chapter||a.sequence-b.sequence||a.id.localeCompare(b.id))
  return {schemaVersion:1,events:result}
}

export async function auditStoryLedger(product, root, candidate=product.storyLedger) {
  if (product?.type!=='book') throw Error('La continuidad exige un proyecto book.')
  const ledger=validateStoryLedger(candidate??{schemaVersion:1,events:[]},product.blueprint)
  const chapterMap=new Map((product.chapters??[]).map(c=>[c.number,c]))
  const rootReal=await realpath(root)
  const textCache=new Map(), problems=[], states=new Map(), used=new Set(),covered=new Set()
  const scoped=async (item) => {
    if (typeof item?.path!=='string' || !item.path.startsWith('products/'+product.id+'/') ||
        item.path.includes('\\') || item.path.split('/').includes('..') ||
        !/^[a-zA-Z0-9/_\-.]+$/u.test(item.path) || !digest.test(item.sha256??'')) throw Error('Ruta o hash de capítulo inválidos.')
    const file=resolve(root,item.path)
    if (!file.startsWith(resolve(root)+sep)) throw Error('Archivo de capítulo fuera de biblioteca.')
    const stat=await lstat(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20*1024*1024) throw Error('Capítulo inseguro o demasiado grande.')
    if (!(await realpath(file)).startsWith(rootReal+sep)) throw Error('Enlace de capítulo fuera de biblioteca.')
    const bytes=await readFile(file)
    if (sha(bytes)!==item.sha256) throw Error('Capítulo cambiado sin actualización de la biblioteca.')
    return bytes.toString('utf8')
  }
  for(const event of ledger.events) {
    const item=chapterMap.get(event.chapter)
    if (!item) {problems.push({event:event.id,code:'missing-chapter'});continue}
    if(event.chapterSha256!==item.sha256) {problems.push({event:event.id,code:'stale-chapter-revision'});continue}
    if(!textCache.has(event.chapter))textCache.set(event.chapter,await scoped(item))
    const original=textCache.get(event.chapter)
    if(!original.includes(event.quote)) {problems.push({event:event.id,code:'quote-not-in-chapter'});continue}
    const eventKey=event.chapter+':'+event.sequence
    if(used.has(eventKey)) {problems.push({event:event.id,code:'duplicate-scene-order'});continue}
    used.add(eventKey);covered.add(event.chapter)
    const k=event.actor.normalize('NFKC').toLowerCase()+'|'+event.field
    const current=states.has(k)?states.get(k):null
    if(event.before!==current) {problems.push({event:event.id,code:'contradictory-transition',field:event.field,chapter:event.chapter});continue}
    states.set(k,event.after)
  }
  const expected=product.blueprint?.chapters?.length??0
  const chaptersWithoutEvidence=Array.from({length:expected},(_,i)=>i+1).filter(n=>!covered.has(n))
  if(chaptersWithoutEvidence.length)problems.push({code:'missing-scene-evidence',count:chaptersWithoutEvidence.length})
  return {productId:product.id,events:ledger.events.length,chaptersWithEvidence:covered.size,
    chaptersPlanned:expected,chaptersWithoutEvidence,issues:problems,
    structurallyConsistent:problems.length===0 && expected>0,
    semanticContinuityVerified:false,storyOriginalityVerified:false,
    humanEditorialReviewRequired:true,externalPublicationVerified:false}
}
