#!/usr/bin/env node
/** Governed, durable, pre-publication queue for Phoenix Business Engine.
 *
 * This module cannot publish, claim sales, or bypass the user's approval.
 * It snapshots verified assets and prepares a resumable, idempotent handoff to
 * a future authorized MCP / browser publisher.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildFingerprint } from './phoenix-business-studio.mjs'
import { assessRelease } from './phoenix-business-factory.mjs'

const ROOT = resolve(process.env.PHOENIX_BUSINESS_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'business-library'))
const PRODUCTS = join(ROOT, 'library.json')
const JOBS = join(ROOT, 'publication-queue.json')
const LOCK = join(ROOT, '.publication-queue.lock')
const MAX_DB_BYTES = 16 * 1024 * 1024
const MAX_ASSET_BYTES = 256 * 1024 * 1024
const MAX_ASSETS = 2000
const PLATFORMS = Object.freeze({
  'amazon-kdp': { roles: ['ebook', 'cover'], matcher: /(?:amazon|kdp|kindle)/i },
  etsy: { roles: ['source'], matcher: /etsy/i },
  shopify: { roles: ['source'], matcher: /shopify/i },
  woocommerce: { roles: ['source'], matcher: /(?:woocommerce|wordpress|woo-)/i },
  gumroad: { roles: ['source'], matcher: /gumroad/i },
  itch: { roles: ['source'], matcher: /(?:itch|gamejolt)/i },
})
const ERR = message => { throw new Error(message) }
const sha = value => createHash('sha256').update(value).digest('hex')
const stableJson = value => JSON.stringify(value)
const idValid = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 120
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

async function readJsonFile(file, fallback) {
  let info
  try { info = await lstat(file) } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback
    throw err
  }
  if (!info.isFile() || info.size > MAX_DB_BYTES) ERR('Archivo de biblioteca o cola inválido.')
  const content = await readFile(file, 'utf8')
  if (Buffer.byteLength(content) > MAX_DB_BYTES) ERR('Índice comercial demasiado grande.')
  return JSON.parse(content)
}

async function library() {
  const db = await readJsonFile(PRODUCTS)
  if (!isObject(db) || db.version !== 1 || !Array.isArray(db.products)) ERR('Biblioteca inválida o incompatible.')
  return db
}

function safeProduct(db, productId) {
  if (!idValid(productId)) ERR('Identificador de producto inválido.')
  const p = db.products.find(x => x.id === productId)
  if (!isObject(p) || !Array.isArray(p.files) || !Array.isArray(p.chapters) || !Array.isArray(p.listings)) ERR('Producto no encontrado o inválido.')
  return p
}

async function fileHash(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}

async function validateAssets(product) {
  const errors = [], assets = [], inventory = [...product.files, ...product.chapters]
  if (inventory.length > MAX_ASSETS) ERR('Demasiados archivos en el producto.')
  const realRoot = await realpath(ROOT)
  for (const item of inventory) {
    const relative = item?.path
    if (typeof relative !== 'string' || relative.length > 512 || !relative.startsWith(`products/${product.id}/`) || relative.includes('\\')) {
      errors.push('Ruta de activo inválida.'); continue
    }
    const path = resolve(ROOT, relative)
    if (!path.startsWith(ROOT + sep)) { errors.push('Ruta fuera de la biblioteca.'); continue }
    let info
    try { info = await lstat(path) } catch (err) {
      if (err.code === 'ENOENT') { errors.push('Falta un activo.'); continue }
      throw err
    }
    if (!info.isFile() || info.size > MAX_ASSET_BYTES) { errors.push('Archivo no regular o demasiado grande.'); continue }
    if (!(await realpath(path)).startsWith(realRoot + sep)) { errors.push('Activo resuelto fuera de la biblioteca.'); continue }
    if (!/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) { errors.push('Huella inválida.'); continue }
    if (await fileHash(path) !== item.sha256) { errors.push('Huella de archivo alterada.'); continue }
    // Never export an OS path, content or private file name in queue snapshots.
    assets.push({ role: typeof item.role === 'string' ? item.role : 'chapter', sha256: item.sha256, bytes: info.size })
  }
  return { errors: [...new Set(errors)], assets }
}

function currentListing(product, platform) {
  const listing = [...product.listings].reverse().find(x => x?.platform === platform)
  if (!isObject(listing)) ERR('Primero prepara una ficha comercial en la biblioteca.')
  if (listing.stage !== 'review-required' || listing.publicationConfirmed !== false) ERR('La ficha no está en revisión previa a publicación.')
  if (typeof listing.price !== 'number' || !Number.isFinite(listing.price) || listing.price <= 0 || listing.price > 10000 || !/^[A-Z]{3}$/.test(listing.currency ?? '')) ERR('Precio o moneda no válidos.')
  return listing
}

function verifyRequirements(product, platform) {
  const problems = []
  for (const role of PLATFORMS[platform].roles) {
    if (!product.files.some(f => f.role === role)) problems.push(`Falta activo ${role}.`)
  }
  if (platform === 'amazon-kdp') {
    if (product.type !== 'book') problems.push('KDP requiere un libro.')
    if (!product.files.some(f => f.role === 'ebook' && /\.epub$/i.test(f.name ?? ''))) problems.push('Falta EPUB.')
    if (!product.build || product.build.fingerprint !== buildFingerprint(product)) problems.push('La compilación editorial está desactualizada.')
    const words = product.chapters.reduce((sum,c) => sum+(Number.isSafeInteger(c.words) ? c.words : 0), 0)
    if (words < 50000 || product.chapters.length < 15) problems.push('No alcanza el mínimo editorial interno de Phoenix (50 000 palabras y 15 capítulos); no es una norma de KDP.')
  }
  return problems
}

/** Validate a product's current snapshot, without changing the real listing. */
export async function assessProduct(productId, platform) {
  if (!Object.hasOwn(PLATFORMS, platform)) ERR('Plataforma desconocida.')
  const db = await library(), product = safeProduct(db, productId)
  const listing = currentListing(product, platform)
  const audit = await validateAssets(product)
  const universal = await assessRelease(productId, {platform})
  const blockers = [...audit.errors, ...verifyRequirements(product,platform), ...universal.blockers]
  if (blockers.length > 0) return { allowed: false, productId, platform, blockers }
  const manifest = {
    productId, platform, price: listing.price, currency: listing.currency,
    assetHashes: audit.assets.map(a => a.sha256).sort(),
    buildFingerprint: product.type === 'book' ? buildFingerprint(product) : null,
    updatedAt: product.updatedAt,
  }
  // A source edit occurring during asset hashing cannot create an acceptable plan.
  const latest = safeProduct(await library(), productId)
  const confirmListing = currentListing(latest, platform)
  if (sha(stableJson({files: latest.files, chapters: latest.chapters, blueprint: latest.blueprint,build:latest.build,listing:confirmListing,updatedAt:latest.updatedAt})) !==
      sha(stableJson({files:product.files,chapters:product.chapters,blueprint:product.blueprint,build:product.build,listing,updatedAt:product.updatedAt}))) {
    return { allowed: false, productId, platform, blockers: ['El producto cambió durante la auditoría.'] }
  }
  return { allowed: true, productId, platform, blockers: [], manifest, fingerprint: sha(stableJson(manifest)), assets: audit.assets }
}

async function acquireLock() {
  await mkdir(ROOT,{recursive:true,mode:0o700})
  for(let i=0;i<100;i++) {
    try { return await open(LOCK,'wx',0o600) } catch(err) {
      if (err.code !== 'EEXIST') throw err
      const info = await stat(LOCK).catch(() => undefined)
      // A lock held by a crashed process is eventually recoverable.
      if (info && Date.now()-info.mtimeMs>120000) { await rm(LOCK,{force:true});continue }
      await sleep(100)
    }
  }
  ERR('La cola comercial está ocupada.')
}

async function mutateJobs(action) {
  const fd=await acquireLock()
  try {
    const db=await readJsonFile(JOBS,{version:1,jobs:[]})
    if (!isObject(db)||db.version!==1||!Array.isArray(db.jobs)||db.jobs.length>10000) ERR('Formato de cola inválido.')
    const result=await action(db.jobs)
    const temp=join(ROOT,`.publication-queue.${randomUUID()}.tmp`)
    try { await writeFile(temp,JSON.stringify(db,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,JOBS) }
    finally { await rm(temp,{force:true}) }
    return result
  } finally { await fd.close();await rm(LOCK,{force:true}) }
}

const publicJob = job => ({
  id:job.id,productId:job.productId,platform:job.platform,stage:job.stage,
  price:job.price,currency:job.currency,createdAt:job.createdAt,
  revision:job.revision,requiresApproval:true,submitted:false,published:false,
  verifiedSales:0,
})

/** An idempotent, approval-gated commercial draft. Never submits externally. */
export async function stagePublication(productId, platform) {
  const assessment=await assessProduct(productId,platform)
  if (!assessment.allowed) return { queued:false, ...assessment }
  return mutateJobs(jobs=>{
    const existing=jobs.find(j=>j.revision===assessment.fingerprint && j.stage!=='cancelled')
    if (existing) return {queued:true,reused:true,job:publicJob(existing)}
    const now=new Date().toISOString()
    const job={id:`pub-${randomUUID()}`,productId,platform,stage:'awaiting-approval',
      price:assessment.manifest.price,currency:assessment.manifest.currency,
      revision:assessment.fingerprint,assetHashes:assessment.manifest.assetHashes,
      createdAt:now,updatedAt:now}
    jobs.push(job)
    return {queued:true,reused:false,job:publicJob(job)}
  })
}

export async function inspectPublication(id) {
  const db=await readJsonFile(JOBS,{version:1,jobs:[]})
  if (!isObject(db)||db.version!==1||!Array.isArray(db.jobs)) ERR('Cola comercial inválida.')
  if (!idValid(id)) ERR('Id de publicación inválido.')
  const job=db.jobs.find(j=>j.id===id)
  if (!job) ERR('Trabajo no encontrado.')
  if(job.stage==='cancelled') return {...publicJob(job),current:false,blockers:['Cancelado.']}
  const assessment=await assessProduct(job.productId,job.platform).catch(error=>({allowed:false,blockers:[error.message]}))
  return {...publicJob(job),current:assessment.allowed && assessment.fingerprint===job.revision,
    blockers:!assessment.allowed?assessment.blockers:assessment.fingerprint!==job.revision?['Cambió el producto, sus activos o el precio.']:[]}
}

export async function cancelPublication(id) {
  if (!idValid(id)) ERR('Id de publicación inválido.')
  return mutateJobs(jobs=>{
    const job=jobs.find(j=>j.id===id)
    if (!job) ERR('Trabajo no encontrado.')
    if (job.stage !== 'awaiting-approval' && job.stage !== 'cancelled') ERR('Este trabajo ya no admite cancelación local.')
    job.stage='cancelled';job.updatedAt=new Date().toISOString()
    return publicJob(job)
  })
}

export async function listPublications() {
  const db=await readJsonFile(JOBS,{version:1,jobs:[]})
  if(!isObject(db)||db.version!==1||!Array.isArray(db.jobs)) ERR('Cola comercial inválida.')
  return db.jobs.slice(-250).map(publicJob)
}

/** Advisory tool discovery only. A name is not proof of permission, authenticity or API capability. */
export function routeCommerce(platform, inventory) {
  if(!Object.hasOwn(PLATFORMS,platform)) ERR('Plataforma desconocida.')
  const runtime = Array.isArray(inventory?.runtime) ? inventory.runtime : []
  const candidates=runtime.filter(item=>item?.status==='ready' &&
    typeof item.serverName==='string' && PLATFORMS[platform].matcher.test(item.serverName) &&
    Array.isArray(item.toolNames)).flatMap(item=>item.toolNames
      .filter(name=>typeof name==='string'&&/^mcp__[a-z0-9_-]+__[a-z0-9_-]+$/i.test(name)&&/(?:create|upload|publish|listing|update|product|submit)/i.test(name))
      .map(name=>({server:item.serverName,tool:name})))
  return { platform,preferred:candidates.length?'mcp-candidate':'minibrowser-candidate',
    candidates:candidates.slice(0,30),validatedAuthentication:false,publicationCapabilityConfirmed:false,
    humanApprovalRequired:true,note:'Verificar esquema, origen, autenticación, términos y resultado real antes de ejecutar.' }
}

async function cli(args) {
  const [cmd,...rest]=args
  if (!cmd||cmd==='help') return {usage:['plan PRODUCT_ID PLATFORM','inspect JOB_ID','cancel JOB_ID','list','route PLATFORM --inventory snapshot.json'],rootLabel:basename(ROOT),publicationEnabled:false}
  if(cmd==='plan') return stagePublication(rest[0],rest[1])
  if(cmd==='inspect') return inspectPublication(rest[0])
  if(cmd==='cancel') return cancelPublication(rest[0])
  if(cmd==='list') return listPublications()
  if(cmd==='route') {
    const i=rest.indexOf('--inventory')
    if(i<0||typeof rest[i+1]!=='string') return routeCommerce(rest[0],null)
    const inventory=await readJsonFile(resolve(rest[i+1]))
    return routeCommerce(rest[0],inventory)
  }
  ERR('Comando comercial no reconocido.')
}
// No submission command on purpose; only trusted Host adapters may carry out side effects.
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(result=>console.log(JSON.stringify({ok:true,result},null,2)))
    .catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1})
}