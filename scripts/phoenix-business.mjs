#!/usr/bin/env node
/** Phoenix Business Engine: durable, secret-free local product library and sales preparation. */
import { mkdir, readFile, writeFile, rename, rm, copyFile, stat } from 'node:fs/promises'
import { join, basename, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'
import { validateBlueprint, progress, buildFingerprint, docxEntries, printHtml } from './phoenix-business-studio.mjs'
import { auditBook, buildBookMarketingBrief, genreGuide, inspectCover, BOOK_FORMATS } from './phoenix-book-quality.mjs'

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
const TYPES = new Set(['book', 'course', 'software', 'game', 'design', 'research', 'video', 'audio', 'service', 'other'])
const ROLES = new Set(['source', 'manuscript', 'ebook', 'print', 'cover', 'promo', 'syllabus', 'lesson', 'assessment', 'package', 'documentation', 'license', 'preview', 'report', 'methodology', 'sources', 'video', 'caption', 'audio', 'transcript', 'proposal', 'scope', 'fulfillment', 'other'])
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
  const standard=BOOK_FORMATS[product.blueprint?.editorial?.format] ?? BOOK_FORMATS.novel
  const minWords = Number(opts.minWords ?? (product.type === 'book' ? standard.minWords : 0))
  const minChapters = Number(opts.minChapters ?? (product.type === 'book' ? standard.minChapters : 0))
  if (![minWords, minChapters].every(n => Number.isSafeInteger(n) && n >= 0)) fail('Umbrales editoriales inválidos.')
  const ordered = [...product.chapters].sort((a,b)=>a.number-b.number)
  const blueprint = product.blueprint
  const planned = blueprint?.chapters ?? []
  const planReady = !blueprint || planned.every(c => ordered.some(a => a.number===c.number && a.words >= Math.ceil(c.targetWords*.85)))
  const buildCurrent = product.build !== undefined && product.build.fingerprint === buildFingerprint(product)
  const chapterWords = ordered.reduce((s,c)=>s+c.words,0)
  const consecutive = ordered.every((c,i)=>c.number===i+1)
    const epub = product.files.some(f=>f.role==='ebook' && /\.(epub|docx|kpf)$/i.test(f.name))
  const pdf = product.files.some(f=>f.role==='print' && /\.pdf$/i.test(f.name))
  const cover = product.files.some(f=>f.role==='cover')
  return { chapterCount: ordered.length, chapterWords, consecutive, minChapters, minWords, lengthReady: (consecutive && planReady && ordered.length >= minChapters && chapterWords >= minWords), planReady, buildCurrent, ebookFileReady: epub && buildCurrent, printFileReady: pdf && cover, humanEditorialReviewRequired: true, rightsReviewRequired: true, coverReviewRequired: true, aiDisclosureReviewRequired: true, printPageCountUnverified: true }
}
function route(platform, toolNames) {
  const candidate = PLATFORMS[platform] ?? fail('Plataforma desconocida.')
  const names = toolNames.filter(t=>/^mcp__[a-z0-9_-]+__[a-z0-9_-]+$/i.test(t))
  const matches = names.filter(t => candidate.matcher.test(t))
  // A read-only discovery/query connector is not evidence of publication rights.
  const writes = matches.filter(t => /(?:create|upload|publish|listing|product|update|submit)/i.test(t))
  return {platform, method:writes.length ? 'mcp-candidate' : 'minibrowser-candidate', compatibleTools:writes, inspectedTools:matches.length, capabilities:candidate.capabilities, note: writes.length ? 'Confirmar autenticación, permisos, parámetros y API antes de ejecutar.' : 'Comprobar primero la galería MCP; navegador autorizado solo si la plataforma lo permite.', submissionRequiresHumanApproval:true}
}

/** Standard ZIP implementation for valid, self-contained EPUB3; no extra dependencies. */
function crc32(input) {
  let value = 0xffffffff
  for (const byte of input) {
    value ^= byte
    for(let j=0;j<8;j++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
function archiveZip(entries) {
  const out=[], directory=[];let cursor=0
  for(const {name,bytes,stored=false} of entries){
    const fileName=Buffer.from(name,'utf8'), raw=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes,'utf8')
    const zipped=stored?raw:deflateRawSync(raw), sum=crc32(raw), method=stored?0:8
    const local=Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6)
    local.writeUInt16LE(method,8);local.writeUInt32LE(sum,14)
    local.writeUInt32LE(zipped.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(fileName.length,26)
    out.push(local,fileName,zipped)
    const central=Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6)
    central.writeUInt16LE(0x800,8);central.writeUInt16LE(method,10);central.writeUInt32LE(sum,16)
    central.writeUInt32LE(zipped.length,20);central.writeUInt32LE(raw.length,24)
    central.writeUInt16LE(fileName.length,28);central.writeUInt32LE(cursor,42)
    directory.push(central,fileName)
    cursor+=local.length+fileName.length+zipped.length
  }
  const centralBytes=Buffer.concat(directory), footer=Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50,0);footer.writeUInt16LE(entries.length,8);footer.writeUInt16LE(entries.length,10)
  footer.writeUInt32LE(centralBytes.length,12);footer.writeUInt32LE(cursor,16)
  return Buffer.concat([...out,centralBytes,footer])
}
function chapterHtml(text) {
  // Fiction-first: all paragraphs become XHTML text nodes; no raw HTML injection.
  return text.trim().split(/\n\s*\n/u).map(p=>`<p>${esc(p.replace(/^#{1,6}\s*/u,'').replace(/\s*\n\s*/gu,' '))}</p>`).join('\n')
}
const xhtml = (title, body, lang) => `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(title)}</title><link href="style.css" rel="stylesheet" type="text/css"/></head><body>${body}</body></html>`
async function registerGenerated(product, name, content, role) {
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8'), digest=hash(bytes)
  const dir=join(root,'products',product.id,role)
  await mkdir(dir,{recursive:true,mode:0o700})
  const path=`products/${product.id}/${role}/${digest.slice(0,12)}-${name}`
  await writeFile(join(root,path),bytes,{mode:0o600})
  const entry={role,name,path,sha256:digest,bytes:bytes.length,addedAt:iso()}
  product.files=product.files.filter(f=>f.role!==role||f.name!==name).concat(entry)
  product.updatedAt=iso()
  return entry
}
async function compileBook(product,author,lang,opts) {
  if(product.type!=='book') fail('Solo se compilan proyectos tipo book.')
  if(author.trim().length<2||author.length>160) fail('Debes indicar el autor real mediante --author.')
  if(!/^[a-z]{2,3}(?:-[A-Za-z]{2})?$/.test(lang)) fail('Idioma BCP-47 inválido.')
  const quality=editorialCheck(product,opts)
  if(!quality.lengthReady) fail(`Manuscrito incompleto (${quality.chapterCount} capítulos; ${quality.chapterWords} palabras).`)
  // Short local builds with explicitly lowered thresholds remain draft-only for tests and prototypes.
  // A commercial-sized default build cannot silently package repetitive/unfinished chapters.
  let editorialGate = null
  const standard=BOOK_FORMATS[product.blueprint?.editorial?.format] ?? BOOK_FORMATS.novel
  if (opts.minWords >= standard.minWords && opts.minChapters >= standard.minChapters) {
    editorialGate = await auditBook(product,root)
    const manuscriptIssues = editorialGate.blockers.filter(issue => !issue.startsWith('Falta portada'))
    if (manuscriptIssues.length) fail('Revisión editorial estructural incompleta: ' + manuscriptIssues.join(' | '))
  }
  const chapters=[]
  for(const c of [...product.chapters].sort((a,b)=>a.number-b.number)){
    const content=await readFile(join(root,c.path),'utf8')
    if(hash(content)!==c.sha256) fail(`Capítulo ${c.number} modificado fuera de Phoenix: bloqueada la compilación.`)
    const planned=product.blueprint?.chapters.find(entry=>entry.number===c.number)
    chapters.push({number:c.number,title:planned?.title??`Capítulo ${c.number}`,text:content})
  }
  const manuscript=`# ${product.title}\n\nAutor: ${author}\n\n`+chapters.map(c=>`# Capítulo ${c.number}\n\n${c.text.trim()}\n`).join('\n')
  const identifier=`urn:uuid:${randomUUID()}`, files=[{name:'mimetype',bytes:'application/epub+zip',stored:true}]
  files.push({name:'META-INF/container.xml',bytes:'<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'})
  files.push({name:'OEBPS/style.css',bytes:'body{font-family:serif;line-height:1.5;margin:5%}p{text-indent:1em;margin:0 0 .5em}h1{text-align:center;page-break-before:always}'})
  // Embed an existing verified raster cover; drafts without cover can still compile locally.
  let epubCover = ''
  const coverAsset = product.files.find(f => f.role === 'cover' && /\.(jpe?g|png)$/iu.test(f.name))
  if (coverAsset) {
    const coverFile = resolve(root,coverAsset.path)
    if (!coverFile.startsWith(root+sep) || !coverAsset.path.startsWith('products/'+product.id+'/')) fail('Ruta insegura de portada.')
    const coverBytes = await readFile(coverFile)
    if (hash(coverBytes) !== coverAsset.sha256) fail('Portada modificada fuera de Phoenix.')
    const coverInfo = inspectCover(coverBytes)
    if (!coverInfo.valid) fail('Portada inválida: ' + coverInfo.reason)
    const ext = coverInfo.format === 'png' ? 'png' : 'jpg'
    const mediaType = coverInfo.format === 'png' ? 'image/png' : 'image/jpeg'
    files.push({name:'OEBPS/cover.'+ext,bytes:coverBytes})
    files.push({name:'OEBPS/cover.xhtml',bytes:xhtml('Portada','<div><img src="cover.'+ext+'" alt="Portada de '+esc(product.title)+'" style="display:block;max-width:100%;height:auto;margin:auto"/></div>',lang)})
    epubCover = '<item id="cover-img" href="cover.'+ext+'" media-type="'+mediaType+'" properties="cover-image"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>'
  }
  files.push({name:'OEBPS/title.xhtml',bytes:xhtml(product.title,`<h1>${esc(product.title)}</h1><p>${esc(author)}</p>`,lang)})
  const nav=chapters.map(c=>`<li><a href="chapter-${String(c.number).padStart(3,'0')}.xhtml">${esc(c.title)}</a></li>`).join('')
  files.push({name:'OEBPS/nav.xhtml',bytes:xhtml('Índice',`<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc" id="toc"><h1>Índice</h1><ol>${nav}</ol></nav>`,lang)})
  for(const c of chapters) files.push({name:`OEBPS/chapter-${String(c.number).padStart(3,'0')}.xhtml`,bytes:xhtml(c.title,`<h1>${esc(c.title)}</h1>${chapterHtml(c.text)}`,lang)})
  const manifest=chapters.map(c=>`<item id="c${c.number}" href="chapter-${String(c.number).padStart(3,'0')}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spine=chapters.map(c=>`<itemref idref="c${c.number}"/>`).join('')
  const opf=`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${identifier}</dc:identifier><dc:title>${esc(product.title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${esc(lang)}</dc:language><meta property="dcterms:modified">${iso().replace(/\.\d{3}Z$/,'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/>${epubCover}${manifest}</manifest><spine>${epubCover?'<itemref idref="cover-page"/>':''}<itemref idref="title"/>${spine}</spine></package>`
  files.push({name:'OEBPS/content.opf',bytes:opf})
  const book=await registerGenerated(product,'manuscript.md',manuscript,'manuscript')
  const ebook=await registerGenerated(product,'ebook.epub',archiveZip(files),'ebook')
  const docx=await registerGenerated(product,'manuscript.docx',archiveZip(docxEntries(product.title,author,chapters)),'manuscript')
  const printSource=await registerGenerated(product,'print-interior.html',printHtml(product.title,author,chapters,lang),'print')
  product.build={fingerprint:buildFingerprint(product),compiledAt:iso(),formatVersion:2,author,lang}
  return {manuscript:book,ebook,docx,printSource,chapters:quality.chapterCount,words:quality.chapterWords,author,lang,editorialStatus:editorialGate?'structural-manuscript-gate-passed-review-required':'draft-only',validation:'EPUB3/DOCX and print-ready HTML generated; PDF, rendered pagination, rights, and editorial review remain pending'}
}

function gallery(products) {
  const cards = products.map(p => `<article><span class="kind">${esc(p.type)}</span><h2>${esc(p.title)}</h2><p>${esc(p.id)}</p><p>${p.files.length} archivos · ${p.chapters.length} capítulos · ${p.listings.length} publicaciones preparadas</p><p>${p.build ? (p.build.fingerprint===buildFingerprint(p)?'Exportación vigente':'Exportación desactualizada') : 'Sin exportación'}</p><small>Última actualización ${esc(p.updatedAt)}</small></article>`).join('\n')
  return `<!DOCTYPE html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mi Biblioteca · Phoenix</title><style>body{font:16px system-ui;background:#faf8f6;color:#26211d;max-width:980px;margin:2rem auto;padding:0 1rem}header{padding:1rem 0;border-bottom:3px solid #ed8a38}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:1rem;margin-top:1.5rem}article{border:1px solid #e6dcd1;background:white;border-radius:14px;padding:1.3rem}h2{font-size:1.1rem}.kind{font-size:.8rem;color:#a6591f;text-transform:uppercase}small,p{color:#736459}</style><header><h1>Mi Biblioteca</h1><p>${products.length} proyectos guardados · Panel local, sin datos comerciales inventados</p></header><main>${cards}</main></html>`
}
async function main(args) {
  const [cmd, ...rest] = args
  const option = (flag, fallback) => {const i=rest.indexOf(flag);return i<0?fallback:rest[i+1]??fail(`Falta valor de ${flag}`)}
  const positional = rest.filter((arg,i)=>!(arg.startsWith('--')||i>0&&rest[i-1].startsWith('--')))
  if (cmd === 'help' || !cmd) return {usage:['init <tipo> <título>', 'list', 'show <id>', 'asset <id> <archivo> --role <source|manuscript|ebook|print|cover|promo>', 'chapter <id> <número> <archivo.md>', 'blueprint <id> <plan.json>', 'progress <id>', 'audit <id>', 'book-quality <id>', 'book-guide <género>', 'book-marketing <id> <fuentes.json>', 'compile <id> --author <nombre> [--words 50000] [--chapters 15] [--lang es]', 'check <id> [--words 50000] [--chapters 15]', 'route <plataforma> [--tools mcp__servidor__herramienta,...]', 'prepare <id> <plataforma> <precio> [--currency USD]', 'sale <id> <importe_bruto> <unidades> --source <referencia>', 'gallery'], home:root}
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
  if (cmd === 'blueprint') return transaction(async db=>{
    const p=get(db,positional[0]);if(p.type!=='book') fail('Los planes editoriales requieren un proyecto book.')
    const file=resolve(positional[1]);const info=await stat(file)
    if(!info.isFile()||info.size>1024*1024) fail('El plan JSON no puede superar 1 MiB.')
    const validated=validateBlueprint(JSON.parse(await readFile(file,'utf8')))
    p.blueprint=validated;p.updatedAt=iso()
    return {productId:p.id,chapters:validated.chapters.length,targetWords:validated.targetWords,characters:validated.characters.length,series:validated.series??null}
  })
  if (cmd === 'progress') return transaction(db=>{const p=get(db,positional[0]);return progress(p,p.blueprint)},false)
  if (cmd === 'book-guide') return genreGuide(positional.join(' '))
  if (cmd === 'book-quality') return transaction(async db=>{
    const p=get(db,positional[0])
    if(p.type!=='book') fail('book-quality requiere un libro.')
    return auditBook(p,root)
  },false)
  if (cmd === 'book-marketing') return transaction(async db=>{
    const p=get(db,positional[0])
    if(p.type!=='book') fail('book-marketing requiere un libro.')
    const evidenceFile=resolve(positional[1]??'')
    const info=await stat(evidenceFile)
    if(!info.isFile()||info.size>256*1024) fail('Fuentes de mercado JSON inválidas o demasiado grandes.')
    return buildBookMarketingBrief(p,JSON.parse(await readFile(evidenceFile,'utf8')))
  },false)
  if (cmd === 'audit') return transaction(async db=>{
    const p=get(db,positional[0]),issues=[]
    for(const file of [...p.files,...p.chapters]){
      const path=resolve(root,file.path)
      if(!path.startsWith(root+sep)) { issues.push({file:file.path,status:'unsafe-path'});continue }
      const bytes=await readFile(path).catch(()=>null)
      if(bytes===null) {issues.push({file:file.path,status:'missing'});continue}
      if(hash(bytes)!==file.sha256) issues.push({file:file.path,status:'sha256-mismatch'})
    }
    const check=editorialCheck(p)
    if(p.type==='book'&&!check.lengthReady) issues.push({status:'manuscript-incomplete'})
    if(p.type==='book'&&!check.buildCurrent) issues.push({status:'export-stale-or-missing'})
    return {id:p.id,filesInspected:p.files.length+p.chapters.length,issues,checks:check,filesIntact:!issues.some(i=>['missing','sha256-mismatch','unsafe-path'].includes(i.status)),readyForAutomaticPublication:false,externalPublicationVerified:false,reviewRequired:['Derechos y licencias','Originalidad','Calidad editorial','Declaración de IA','Portada','PDF y paginación reales']}
  },false)
  if (cmd === 'compile') return transaction(db=>{const p=get(db,positional[0]),standard=BOOK_FORMATS[p.blueprint?.editorial?.format]??BOOK_FORMATS.novel;return compileBook(p,String(option('--author','')),String(option('--lang','es')),{minWords:Number(option('--words',standard.minWords)),minChapters:Number(option('--chapters',standard.minChapters))})})
  if (cmd === 'check') return transaction(db=>{const p=get(db,positional[0]),standard=BOOK_FORMATS[p.blueprint?.editorial?.format]??BOOK_FORMATS.novel;return editorialCheck(p,{minWords:Number(option('--words',p.type==='book'?standard.minWords:0)),minChapters:Number(option('--chapters',p.type==='book'?standard.minChapters:0))})},false)
  if (cmd === 'route') return route(positional[0],String(option('--tools','')).split(',').filter(Boolean))
  if (cmd === 'prepare') return transaction(async db=>{
    const p=get(db,positional[0]), platform=positional[1];if(!(platform in PLATFORMS)) fail('Plataforma no soportada.')
    const currency=String(option('--currency','USD')).toUpperCase();if(!/^[A-Z]{3}$/.test(currency)) fail('Moneda inválida.')
    const price=money(positional[2]), check=editorialCheck(p)
    const files=p.type === 'book' ? PLATFORMS[platform].required.every(role=>p.files.some(f=>f.role===role)) : p.files.length > 0
    const ready=p.type==='book'&&platform==='amazon-kdp' ? check.lengthReady && check.ebookFileReady && p.files.some(f=>f.role==='cover') : files
    const integrityFailures=[]
    for(const f of p.files) {
      const target=resolve(root,f.path)
      if(!target.startsWith(root+sep)){integrityFailures.push(f.name);continue}
      const bytes=await readFile(target).catch(()=>null)
      if(bytes===null || hash(bytes)!==f.sha256) integrityFailures.push(f.name)
    }
    let bookQuality=null
    if(ready && p.type==='book') {
      try { bookQuality=await auditBook(p,root) }
      catch(error) { bookQuality={structurallyReadyForReview:false,blockers:[error instanceof Error?error.message:'Error en auditoría editorial.']} }
    }
    const stage=integrityFailures.length?'integrity-failed':!ready?'assets-missing':bookQuality && !bookQuality.structurallyReadyForReview?'editorial-incomplete':'review-required'
    const now=iso(), entry={platform,currency,price,stage,bookQuality,integrityFailures,publicationConfirmed:false,externalUrl:null,createdAt:now,updatedAt:now,requires:['aprobación explícita del usuario','revisión de derechos/licencias','declaración de IA y requisitos de la plataforma','confirmación de recepción de la tienda'],editorial:check}
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