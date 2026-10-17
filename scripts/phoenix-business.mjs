#!/usr/bin/env node
/** Phoenix Business Engine: durable, secret-free local product library and sales preparation. */
import { mkdir, readFile, writeFile, rename, rm, copyFile, stat } from 'node:fs/promises'
import { join, basename, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(process.env.PHOENIX_BUSINESS_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'business-library'))
const indexFile = join(root, 'library.json')
const lockFile = join(root, '.library.lock')
const PLATFORMS = Object.freeze({
  'amazon-kdp': { matcher: /(?:kdp|kindle|amazon)/i, required: ['ebook'], capabilities: ['list', 'upload', 'publish'] },
  etsy: { matcher: /etsy/i, required: ['source'], capabilities: ['list', 'upload', 'publish'] },
  shopify: { matcher: /shopify/i, required: ['source'], capabilities: ['list', 'upload', 'publish'] },
  woocommerce: { matcher: /(?:woo|wordpress)/i, required: ['source'], capabilities: ['list', 'upload', 'publish'] },
  gumroad: { matcher: /gumroad/i, required: ['source'], capabilities: ['list', 'upload', 'publish'] },
  itch: { matcher: /(?:itch|gamejolt)/i, required: ['source'], capabilities: ['list', 'upload', 'publish'] },
})
const TYPES = new Set(['book', 'course', 'software', 'game', 'design', 'research', 'video', 'audio', 'other'])
const ROLES = new Set(['source', 'manuscript', 'ebook', 'print', 'cover', 'promo', 'other'])
const iso = () => new Date().toISOString()
const fail = message => { throw new Error(message) }
const safeId = id => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id) ? id : fail('Identificador no válido.')
const words = text => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
const esc = s => String(s).replace(/[&<>"']/gu, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
const get = (db, id) => db.products.find(p => p.id === safeId(id)) ?? fail(`Producto no encontrado: ${id}`)
const money = value => { const n = Number(value); if (!Number.isFinite(n) || n <= 0 || n > 10000) fail('Precio inválido (0-10000).'); return Math.round(n * 100) / 100 }
const hash = content => createHash('sha256').update(content).digest('hex')
const printableName = name => basename(name).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 120) || 'asset'
const positiveInt = value => { const n=Number(value); if (!Number.isSafeInteger(n)||n < 1||n>1000000) fail('Número positivo inválido.'); return n }

async function lock() {
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (let i = 0; i < 80; i++) {
    try { return await import('node:fs/promises').then(fs => fs.open(lockFile, 'wx', 0o600)) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      const info = await stat(lockFile).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > 60000) { await rm(lockFile, { force: true }); continue }
      await sleep(50)
    }
  }
  fail('Biblioteca ocupada. Vuelve a ejecutar el comando.')
}
async function load() {
  try {
    const data = JSON.parse(await readFile(indexFile, 'utf8'))
    if (data.version !== 1 || !Array.isArray(data.products)) fail('Formato de biblioteca desconocido: no se sobrescribirá.')
    return data
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, products: [] }
    throw error
  }
}
async function save(data) {
  const temporary = join(root, `.library.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2)+'\n', { mode: 0o600, flag: 'wx' })
    await rename(temporary, indexFile)
  } finally { await rm(temporary, { force: true }) }
}
async function transaction(callback, mutate = true) {
  if (!mutate) return callback(await load())
  const owner = await lock()
  try { const db=await load(); const result=await callback(db); await save(db); return result }
  finally { await owner.close(); await rm(lockFile, {force:true}) }
}
async function addAsset(product, input, role) {
  if (!ROLES.has(role)) fail(`Tipo de archivo desconocido: ${role}`)
  const file = resolve(input)
  const info = await stat(file)
  if (!info.isFile() || info.size > 256*1024*1024) fail('Se necesita un archivo de hasta 256 MiB.')
  if (file === indexFile || file.startsWith(root + sep)) fail('Usa un archivo fuente fuera de la biblioteca para evitar duplicados.')
  const bytes = await readFile(file)
  const digest = hash(bytes)
  const name = `${digest.slice(0,12)}-${printableName(file)}`
  const folder = join(root, 'products', product.id, role)
  await mkdir(folder, {recursive:true,mode:0o700})
  const target = join(folder, name)
  await copyFile(file, target, fsConstants.COPYFILE_EXCL).catch(err => { if (err.code !== 'EEXIST') throw err })
  const entry = { role, name: printableName(file), path: `products/${product.id}/${role}/${name}`, sha256: digest, bytes: bytes.length, addedAt: iso() }
  if (!product.files.some(item => item.sha256 === digest && item.role === role)) product.files.push(entry)
  product.updatedAt = iso()
  return entry
}
function editorialCheck(product, opts={}) {
  const minWords = Number(opts.minWords ?? (product.type === 'book' ? 50000 : 0))
  const minChapters = Number(opts.minChapters ?? (product.type === 'book' ? 15 : 0))
  if (![minWords, minChapters].every(n => Number.isSafeInteger(n) && n >= 0)) fail('Umbrales editoriales inválidos.')
  const ordered = [...product.chapters].sort((a,b)=>a.number-b.number)
  const chapterWords = ordered.reduce((s,c)=>s+c.words,0)
  const consecutive = ordered.every((c,i)=>c.number===i+1)
    const epub = product.files.some(f=>f.role==='ebook' && /\.(epub|docx|kpf)$/i.test(f.name))
  const pdf = product.files.some(f=>f.role==='print' && /\.pdf$/i.test(f.name))
  const cover = product.files.some(f=>f.role==='cover')
  return { chapterCount: ordered.length, chapterWords, consecutive, minChapters, minWords, lengthReady: (consecutive && ordered.length >= minChapters && chapterWords >= minWords), ebookFileReady: epub, printFileReady: pdf && cover, humanEditorialReviewRequired: true, rightsReviewRequired: true, coverReviewRequired: true, aiDisclosureReviewRequired: true, printPageCountUnverified: true }
}
function route(platform, toolNames) {
  const candidate = PLATFORMS[platform] ?? fail('Plataforma desconocida.')
  const names = toolNames.filter(t=>/^mcp__[a-z0-9_-]+__[a-z0-9_-]+$/i.test(t))
  const matches = names.filter(t => candidate.matcher.test(t))
  // A read-only discovery/query connector is not evidence of publication rights.
  const writes = matches.filter(t => /(?:create|upload|publish|listing|product|update|submit)/i.test(t))
  return {platform, method:writes.length ? 'mcp-candidate' : 'minibrowser-candidate', compatibleTools:writes, inspectedTools:matches.length, capabilities:candidate.capabilities, note: writes.length ? 'Confirmar autenticación, permisos, parámetros y API antes de ejecutar.' : 'Comprobar primero la galería MCP; navegador autorizado solo si la plataforma lo permite.', submissionRequiresHumanApproval:true}
}
function gallery(products) {
  const cards = products.map(p => `<article><span class="kind">${esc(p.type)}</span><h2>${esc(p.title)}</h2><p>${esc(p.id)}</p><p>${p.files.length} archivos · ${p.chapters.length} capítulos · ${p.listings.length} publicaciones preparadas</p><small>Última actualización ${esc(p.updatedAt)}</small></article>`).join('\n')
  return `<!DOCTYPE html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mi Biblioteca · Phoenix</title><style>body{font:16px system-ui;background:#faf8f6;color:#26211d;max-width:980px;margin:2rem auto;padding:0 1rem}header{padding:1rem 0;border-bottom:3px solid #ed8a38}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:1rem;margin-top:1.5rem}article{border:1px solid #e6dcd1;background:white;border-radius:14px;padding:1.3rem}h2{font-size:1.1rem}.kind{font-size:.8rem;color:#a6591f;text-transform:uppercase}small,p{color:#736459}</style><header><h1>Mi Biblioteca</h1><p>${products.length} proyectos guardados · Panel local, sin datos comerciales inventados</p></header><main>${cards}</main></html>`
}
async function main(args) {
  const [cmd, ...rest] = args
  const option = (flag, fallback) => {const i=rest.indexOf(flag);return i<0?fallback:rest[i+1]??fail(`Falta valor de ${flag}`)}
  const positional = rest.filter((arg,i)=>!(arg.startsWith('--')||i>0&&rest[i-1].startsWith('--')))
  if (cmd === 'help' || !cmd) return {usage:['init <tipo> <título>', 'list', 'show <id>', 'asset <id> <archivo> --role <source|manuscript|ebook|print|cover|promo>', 'chapter <id> <número> <archivo.md>', 'check <id> [--words 50000] [--chapters 15]', 'route <plataforma> [--tools mcp__servidor__herramienta,...]', 'prepare <id> <plataforma> <precio> [--currency USD]', 'sale <id> <importe_bruto> <unidades> --source <referencia>', 'gallery'], home:root}
  if (cmd === 'init') {
    const [type,...titleParts]=positional; const title=titleParts.join(' ').trim()
    if(!TYPES.has(type)||title.length<3||title.length>180) fail('Tipo o título inválido.')
    return transaction(db=>{const id=(title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'producto')+'-'+randomUUID().slice(0,8);const at=iso();const product={id,type,title,createdAt:at,updatedAt:at,files:[],chapters:[],listings:[],sales:[]}; db.products.push(product);return product})
  }
  if (cmd === 'list') return transaction(db => db.products.map(({id,title,type,updatedAt,files,chapters,listings})=>({id,title,type,updatedAt,files:files.length,chapters:chapters.length,listings:listings.length})),false)
  if (cmd === 'show') return transaction(db=>get(db,positional[0]),false)
  if (cmd === 'asset') return transaction(db=>addAsset(get(db,positional[0]),positional[1],option('--role','source')))
  if (cmd === 'chapter') return transaction(async db=>{
    const p=get(db,positional[0]), number=positiveInt(positional[1]); if (number>500) fail('Número de capítulo fuera de rango.')
    if (p.type!=='book') fail('Los capítulos corresponden a proyectos tipo book.')
    if(number>1&&!p.chapters.some(c=>c.number===number-1)) fail('Falta el capítulo anterior: no se permite un salto narrativo.')
    const file=resolve(positional[2]);if(!file.endsWith('.md')) fail('Capítulo debe ser Markdown (.md).')
    const text=await readFile(file,'utf8');if(words(text)<100) fail('Capítulo demasiado corto: mínimo 100 palabras.')
    const folder=join(root,'products',p.id,'chapters');await mkdir(folder,{recursive:true,mode:0o700})
    const path=`products/${p.id}/chapters/${String(number).padStart(3,'0')}.md`
    const temp=join(folder,`.${randomUUID()}.tmp`);await writeFile(temp,text,{mode:0o600});await rename(temp,join(root,path))
    const item={number,path,words:words(text),sha256:hash(text),updatedAt:iso()};p.chapters=p.chapters.filter(c=>c.number!==number).concat(item).sort((a,b)=>a.number-b.number);p.updatedAt=iso();return item
  })
  if (cmd === 'check') return transaction(db=> editorialCheck(get(db,positional[0]),{minWords:Number(option('--words', undefined)??(get(db,positional[0]).type==='book'?50000:0)),minChapters:Number(option('--chapters', undefined)??(get(db,positional[0]).type==='book'?15:0))}),false)
  if (cmd === 'route') return route(positional[0],String(option('--tools','')).split(',').filter(Boolean))
  if (cmd === 'prepare') return transaction(db=>{
    const p=get(db,positional[0]), platform=positional[1];if(!(platform in PLATFORMS)) fail('Plataforma no soportada.')
    const currency=String(option('--currency','USD')).toUpperCase();if(!/^[A-Z]{3}$/.test(currency)) fail('Moneda inválida.')
    const price=money(positional[2]), check=editorialCheck(p)
    const files=PLATFORMS[platform].required.every(role=>p.files.some(f=>f.role===role))
    const ready=p.type==='book'&&platform==='amazon-kdp' ? check.lengthReady && check.ebookFileReady : files
    const now=iso(), entry={platform,currency,price,stage:ready?'review-required':'assets-missing',publicationConfirmed:false,externalUrl:null,createdAt:now,updatedAt:now,requires:['aprobación explícita del usuario','revisión de derechos/licencias','declaración de IA y requisitos de la plataforma','confirmación de recepción de la tienda'],editorial:check}
    p.listings=p.listings.filter(item=>item.platform!==platform).concat(entry);p.updatedAt=now;return entry
  })
  if(cmd==='sale') return transaction(db=>{
    const p=get(db,positional[0]);const amount=money(positional[1]), quantity=positiveInt(positional[2]);const source=option('--source','').trim()
    if(source.length<5||source.length>300) fail('Indica referencia verificable de la venta mediante --source.')
    const item={amount,quantity,currency:String(option('--currency','USD')).toUpperCase(),source,recordedAt:iso(),verifiedByPlatform:false};p.sales.push(item);p.updatedAt=iso();return item
  })
  if(cmd==='gallery') return transaction(async db=>{const output=join(root,'gallery.html');const temp=join(root,`.gallery.${randomUUID()}.tmp`);await mkdir(root,{recursive:true,mode:0o700});await writeFile(temp,gallery(db.products),{mode:0o600});await rename(temp,output);return{path:output,products:db.products.length}},false)
  fail(`Comando desconocido: ${cmd}`)
}
main(process.argv.slice(2)).then(result=>{console.log(JSON.stringify({ok:true,result},null,2))}).catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1})
