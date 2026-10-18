#!/usr/bin/env node
/** Universal product readiness and portable release packs for Phoenix Business Engine.
 * Never publishes externally, charges customers, invents reviews or verifies sales.
 * Uses the existing durable business-library; does not modify the library index.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { buildFingerprint } from './phoenix-business-studio.mjs'
import { auditBook, BOOK_FORMATS } from './phoenix-book-quality.mjs'
import { auditStoryLedger } from './phoenix-book-continuity.mjs'

const ROOT = resolve(process.env.PHOENIX_BUSINESS_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'business-library'))
const DB = join(ROOT, 'library.json')
const RELEASE_ROOT = join(ROOT, 'releases')
const MAX_INDEX = 16 * 1024 * 1024
const MAX_ASSET = 64 * 1024 * 1024
const MAX_RELEASE = 128 * 1024 * 1024
const MAX_FILES = 128
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const HEX = /^[a-f0-9]{64}$/u
const errors = message => { throw new Error(message) }
const sha = value => createHash('sha256').update(value).digest('hex')
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const safeId = id => typeof id === 'string' && ID_RE.test(id) && id.length <= 120 ? id : errors('Identificador inválido.')

// Gates are deliberately structural: semantic QA, licensing, marketing claims and platform rules require evidence.
// `groups` is conjunctive: each group needs at least `min` files with the listed role and extension.
export const RECIPES = Object.freeze({
  book: {
    label:'Libros y novelas', markets:['amazon-kdp','shopify','woocommerce','gumroad','direct'],
    groups:[{role:'ebook',extensions:['.epub','.kpf'],min:1},{role:'cover',extensions:['.jpg','.jpeg','.png'],min:1}],
    reviews:['continuidad editorial','originalidad y derechos','declaración de IA','paginación real si es impreso'],
    guide:'Manuscrito completo, biblia narrativa, EPUB válido, portada y revisión humana. Un EPUB empaquetado no demuestra 350 páginas.'
  },
  course: {
    label:'Cursos completos',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'syllabus',extensions:['.md','.pdf'],min:1},{role:'lesson',extensions:['.md','.html','.pdf','.mp4'],min:3},{role:'assessment',extensions:['.json','.md','.pdf','.csv'],min:1}],
    reviews:['exactitud pedagógica','prueba de ejercicios y evaluaciones','derechos de materiales'],
    guide:'Temario con objetivos, al menos tres lecciones íntegras y evaluación. La cobertura curricular sigue requiriendo revisión.'
  },
  software: {
    label:'Aplicaciones y SaaS',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'source',extensions:['.zip','.tar','.gz','.js','.ts','.py'],min:1},{role:'package',extensions:['.zip','.exe','.msi','.apk','.deb','.tgz'],min:1},{role:'documentation',extensions:['.md','.pdf','.html'],min:1}],
    reviews:['ejecución de pruebas y compilación','auditoría de seguridad','licencia y soporte','entrega y credenciales'],
    guide:'Código real, artefacto de despliegue e instrucciones. El empaquetado no sustituye pruebas de ejecución.'
  },
  game: {
    label:'Videojuegos y recursos',markets:['itch','shopify','woocommerce','gumroad','direct'],
    groups:[{role:'source',extensions:['.zip','.ts','.js','.gd'],min:1},{role:'package',extensions:['.zip','.exe','.apk','.html'],min:1},{role:'preview',extensions:['.png','.jpg','.jpeg','.mp4','.webp'],min:1}],
    reviews:['jugabilidad y rendimiento','licencias de arte y música','prueba en plataforma destino'],
    guide:'Juego exportado y jugable, código o proyecto y captura real; verificar recursos usados y controles.'
  },
  design: {
    label:'Diseños y plantillas',markets:['etsy','shopify','woocommerce','gumroad','direct'],
    groups:[{role:'source',extensions:['.svg','.psd','.ai','.fig','.zip','.pdf'],min:1},{role:'preview',extensions:['.png','.jpg','.jpeg','.webp'],min:1},{role:'package',extensions:['.zip','.pdf','.svg','.png'],min:1}],
    reviews:['originalidad y derechos','especificaciones de impresión','política del marketplace'],
    guide:'Archivo editable, exportaciones finales y vista previa. No vender imágenes de demostración como entregables.'
  },
  research: {
    label:'Investigaciones e informes',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'report',extensions:['.pdf','.docx'],min:1},{role:'methodology',extensions:['.md','.pdf','.docx'],min:1},{role:'sources',extensions:['.json','.csv','.bib','.md'],min:1}],
    reviews:['verificación de citas y fuentes','metodología y análisis','consentimiento y datos personales','revisión profesional'],
    guide:'Informe final completo con fuentes y metodología; no afirmar revisión científica ni citas verificadas sin evidencia.'
  },
  video: {
    label:'Vídeos y contenido audiovisual',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'video',extensions:['.mp4','.webm','.mov'],min:1},{role:'caption',extensions:['.srt','.vtt'],min:1},{role:'preview',extensions:['.jpg','.jpeg','.png','.webp'],min:1}],
    reviews:['calidad audiovisual','accesibilidad','derechos de audio e imagen','divulgación de IA'],
    guide:'Vídeo exportado, subtítulos y miniatura; comprobar reproducción y derechos de voces y música.'
  },
  audio: {
    label:'Audio y pódcast',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'audio',extensions:['.mp3','.wav','.flac','.m4a'],min:1},{role:'transcript',extensions:['.md','.txt','.srt','.vtt'],min:1}],
    reviews:['audio audible','licencias de voz y música','derechos de distribución'],
    guide:'Audio reproducible con transcripción y licencias; no presupone aceptación por ACX u otra tienda.'
  },
  service: {
    label:'Servicios comerciales',markets:['shopify','woocommerce','direct'],
    groups:[{role:'proposal',extensions:['.pdf','.docx','.md'],min:1},{role:'scope',extensions:['.pdf','.docx','.md'],min:1},{role:'fulfillment',extensions:['.md','.pdf','.json'],min:1}],
    reviews:['capacidad real de entrega','condiciones y política de reembolso','jurisdicción y cualificaciones'],
    guide:'Oferta, alcance, entregables y proceso de prestación; una oferta no equivale a un servicio realizado.'
  },
  other: {
    label:'Otros productos digitales',markets:['shopify','woocommerce','gumroad','direct'],
    groups:[{role:'source',extensions:['.zip','.pdf','.md','.html'],min:1},{role:'documentation',extensions:['.pdf','.md'],min:1}],
    reviews:['derechos y licencias','viabilidad y controles específicos del producto'],
    guide:'Definir requisitos específicos antes de considerar el producto comercialmente listo.'
  },
})

function extension(name) {
  const s=typeof name === 'string' ? name.toLowerCase() : ''
  const i=s.lastIndexOf('.'); return i<0?'':s.slice(i)
}
function safeFileName(name) {
  const raw=typeof name==='string'?name:'file'
  return basename(raw).replace(/[^a-zA-Z0-9._-]/gu,'_').slice(0,100)||'file'
}
async function readIndex() {
  const info=await lstat(DB)
  if(!info.isFile()||info.size>MAX_INDEX) errors('Índice de biblioteca no seguro o demasiado grande.')
  const db=JSON.parse(await readFile(DB,'utf8'))
  if(!isObj(db)||db.version!==1||!Array.isArray(db.products)||db.products.length>10000) errors('Formato de biblioteca incompatible.')
  return db
}
async function productById(id) {
  safeId(id)
  const db=await readIndex()
  const p=db.products.find(value=>value?.id===id)
  if(!isObj(p)||!Array.isArray(p.files)||!Array.isArray(p.chapters)||!Array.isArray(p.listings)) errors('Producto no encontrado o inválido.')
  return p
}
async function fileHash(file) {
  const h=createHash('sha256')
  for await (const block of createReadStream(file)) h.update(block)
  return h.digest('hex')
}
async function headerCheck(path, asset) {
  const suffix=extension(asset.name)
  const handle=await open(path,'r')
  let head
  try { head=Buffer.alloc(128);const {bytesRead}=await handle.read(head,0,128,0);head=head.subarray(0,bytesRead) }
  finally {await handle.close()}
  const start=head.toString('utf8')
  const zip=['.zip','.docx','.epub','.apk'].includes(suffix)
  if(zip && !(head.length>=4&&head.readUInt32LE(0)===0x04034b50)) return 'ZIP/DOCX/EPUB sin cabecera ZIP válida.'
  if(suffix==='.pdf'&&!start.startsWith('%PDF-')) return 'PDF sin cabecera válida.'
  if(suffix==='.png'&&!head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'PNG sin firma válida.'
  if(['.jpg','.jpeg'].includes(suffix)&&!head.subarray(0,3).equals(Buffer.from([255,216,255]))) return 'JPEG sin firma válida.'
  if(suffix==='.mp4'&&!(head.length>=12&&head.subarray(4,8).toString('ascii')==='ftyp')) return 'MP4 sin contenedor reconocible.'
  if(suffix==='.mp3'&&!(start.startsWith('ID3') || (head.length>=2 && head[0]===0xff && (head[1]&0xe0)===0xe0))) return 'MP3 sin firma reconocible.'
  if(suffix==='.wav'&&!(start.startsWith('RIFF')&&head.subarray(8,12).toString()==='WAVE')) return 'WAV sin contenedor reconocible.'
  if(suffix==='.webm'&&!head.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return 'WEBM sin firma reconocible.'
  if(suffix==='.exe'&&!start.startsWith('MZ')) return 'EXE sin cabecera PE/MZ.'
  if(suffix==='.gz'&&!head.subarray(0,2).equals(Buffer.from([31,139]))) return 'GZIP sin firma.'
  if(suffix==='.vtt'&&!start.startsWith('WEBVTT')) return 'Subtítulos VTT sin cabecera.'
  if(suffix==='.svg'&&!/<svg(?:\s|>)/iu.test(start)) return 'SVG sin elemento raíz.'
  return null
}

async function inspectAssets(product) {
  if(product.files.length+product.chapters.length>MAX_FILES) errors('Demasiados archivos para un paquete.')
  const rootReal=await realpath(ROOT)
  const issues=[], assets=[]
  let total=0
  for (const asset of [...product.files,...product.chapters]) {
    if(!isObj(asset)||typeof asset.path!=='string'||asset.path.length>512||
      !asset.path.startsWith(`products/${product.id}/`)||asset.path.includes('\\')||
      !/^[a-zA-Z0-9/_\-.]+$/u.test(asset.path)||asset.path.split('/').includes('..')||!HEX.test(asset.sha256??'')) {
      issues.push('Metadatos de archivo inseguros.');continue
    }
    const file=resolve(ROOT,asset.path)
    if(!file.startsWith(ROOT+sep)){issues.push('Archivo fuera de la biblioteca.');continue}
    const info=await lstat(file).catch(err=>err.code==='ENOENT'?null:Promise.reject(err))
    if(!info){issues.push(`Falta archivo ${asset.role??'chapter'}.`);continue}
    if(!info.isFile()||info.size>MAX_ASSET){issues.push('Archivo no regular o demasiado grande.');continue}
    const resolved=await realpath(file)
    if(!resolved.startsWith(rootReal+sep)){issues.push('Archivo redirigido fuera de la biblioteca.');continue}
    if(await fileHash(file)!==asset.sha256){issues.push('Huella SHA-256 alterada.');continue}
    const formatIssue=await headerCheck(file,asset)
    if(formatIssue){issues.push(formatIssue);continue}
    if(Number.isSafeInteger(asset.number)) {
      const chapterText=await readFile(file,'utf8')
      const chapterWords=(chapterText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)??[]).length
      if(chapterWords!==asset.words){issues.push('El recuento del capítulo no corresponde al texto real.');continue}
    }
    total+=info.size
    if(total>MAX_RELEASE){issues.push('Producto supera límite de 128 MiB por paquete.');break}
    assets.push({file,sha256:asset.sha256,bytes:info.size,role:typeof asset.role==='string'?asset.role:'chapter',name:safeFileName(asset.name??`chapter-${asset.number}.md`)})
  }
  return {issues:[...new Set(issues)],assets,totalBytes:total}
}
function validateRecipe(product, assets, platform) {
  const recipe=RECIPES[product.type]
  if(!recipe) return {supported:false,blockers:['Tipo de producto no soportado.'],checks:[],manualReviews:[]}
  const blockers=[],checks=[]
  if(platform && !recipe.markets.includes(platform)) blockers.push('Canal no previsto para esta categoría. Revisar políticas.')
  for(const group of recipe.groups) {
    const count=assets.filter(a=>a.role===group.role&&group.extensions.includes(extension(a.name))).length
    const passed=count>=group.min
    checks.push({role:group.role,required:group.min,found:count,formats:group.extensions,passed})
    if(!passed) blockers.push(`Faltan archivos válidos: ${group.role} (${count}/${group.min}).`)
  }
  if(product.type==='book') {
    const numbers=new Set(product.chapters.map(c=>c.number))
    const count=product.chapters.length
    const words=product.chapters.reduce((sum,c)=>sum+(Number.isSafeInteger(c.words)?c.words:0),0)
    const format=BOOK_FORMATS[product.blueprint?.editorial?.format] ?? BOOK_FORMATS.novel
    if(count<format.minChapters||words<format.minWords||numbers.size!==count||![...numbers].every((n,i)=>numbers.has(i+1))) blockers.push('Libro insuficiente para el formato elegido (capítulos consecutivos y longitud mínima interna).')
    if(!isObj(product.build)||product.build.fingerprint!==buildFingerprint(product)) blockers.push('Libro sin compilación editorial vigente.')
  }
  const reviews=recipe.reviews.map(name=>({name,verified:false,requiresEvidence:true}))
  return {supported:true,blockers,checks,manualReviews:reviews}
}

/** Readiness is explicitly structural, not a publishing or semantic-quality approval. */
export async function assessRelease(id,{platform='direct'}={}) {
  const product=await productById(id)
  const integrity=await inspectAssets(product)
  const result=validateRecipe(product,integrity.assets,platform)
  const blockers=[...integrity.issues,...result.blockers]
  let editorial = null
  if(product.type==='book' && integrity.issues.length===0){
    try {
      editorial=await auditBook(product,ROOT)
      blockers.push(...editorial.blockers.map(problem=>'Control editorial: '+problem))
    } catch(error) {
      blockers.push('No se pudo auditar el libro: '+(error instanceof Error?error.message:'error no identificado'))
    }
  }
  let continuity = null
  if(product.type==='book' && product.storyLedger) {
    try {
      continuity=await auditStoryLedger(product,ROOT)
      blockers.push(...continuity.issues.map(issue=>'Control de continuidad: '+issue.code))
    } catch(error) {
      blockers.push('Diario narrativo inválido: '+(error instanceof Error?error.message:'error no identificado'))
    }
  }
  if(product.type==='book' && product.printProof &&
    product.printProof.sourceFingerprint!==buildFingerprint(product)) blockers.push('El PDF interior fue generado a partir de una revisión anterior del libro.')
  return {productId:id,type:product.type,platform,structurallyReady:blockers.length===0,editorial,continuity,
    blockers,checks:result.checks,assetCount:integrity.assets.length,totalBytes:integrity.totalBytes,
    manualReviews:result.manualReviews,commerciallyApproved:false,publicationConfirmed:false,
    salesVerified:false,requiresHumanAuthorization:true}
}

function crc32(bytes) {
  let value=0xffffffff
  for(const b of bytes){value^=b;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0)}
  return (value^0xffffffff)>>>0
}
function zip(entries) {
  const files=[],central=[]
  let offset=0
  for(const entry of entries) {
    const name=Buffer.from(entry.path,'utf8'), body=Buffer.isBuffer(entry.bytes)?entry.bytes:Buffer.from(entry.bytes)
    if(name.length>65535||body.length>0xffffffff||entries.length>65535) errors('Límite ZIP superado.')
    const compressed=deflateRawSync(body,{level:6}),crc=crc32(body),local=Buffer.alloc(30),record=Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8)
    local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26)
    files.push(local,name,compressed)
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10)
    record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(body.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42)
    central.push(record,name);offset+=local.length+name.length+compressed.length
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10)
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...files,directory,end])
}

/** Builds a verifiable distribution ZIP; never publishes, uploads or charges. */
export async function buildRelease(id,{platform='direct'}={}) {
  const assessment=await assessRelease(id,{platform})
  if(!assessment.structurallyReady) return {built:false,...assessment}
  const product=await productById(id)
  const inspected=await inspectAssets(product)
  if(inspected.issues.length) return {built:false,...assessment,blockers:inspected.issues}
  const latest=await productById(id)
  // Detect modifications between review and packaging, including changed file inventory and pricing.
  if(sha(JSON.stringify({files:product.files,chapters:product.chapters,listings:product.listings,build:product.build,updatedAt:product.updatedAt}))!==
     sha(JSON.stringify({files:latest.files,chapters:latest.chapters,listings:latest.listings,build:latest.build,updatedAt:latest.updatedAt}))) {
    return {built:false,...assessment,blockers:['El producto cambió durante el empaquetado.']}
  }
  const catalog=inspected.assets.map((a,i)=>({role:a.role,name:a.name,sha256:a.sha256,bytes:a.bytes,path:`assets/${String(i+1).padStart(3,'0')}-${a.name}`}))
  const record={schemaVersion:1,id:product.id,type:product.type,title:product.title,platform,
    assets:catalog,quality:{structuralChecks:assessment.checks,manualReviews:assessment.manualReviews},
    flags:{externalPublished:false,salesVerified:false,commerciallyApproved:false},
    sourceRevision:sha(JSON.stringify({files:product.files,chapters:product.chapters,build:product.build,updatedAt:product.updatedAt}))}
  const manifestBytes=Buffer.from(JSON.stringify(record,null,2)+'\n','utf8')
  const entries=[{path:'manifest.json',bytes:manifestBytes}]
  for(let i=0;i<inspected.assets.length;i++){
    const a=inspected.assets[i],bytes=await readFile(a.file)
    if(sha(bytes)!==a.sha256) return {built:false,...assessment,blockers:['Un activo cambió durante la copia.']}
    entries.push({path:catalog[i].path,bytes})
  }
  const manifestSha=sha(manifestBytes),packageName=`${safeId(id)}-${platform}-${manifestSha.slice(0,12)}.zip`
  const directory=join(RELEASE_ROOT,safeId(id));await mkdir(directory,{recursive:true,mode:0o700})
  const target=join(directory,packageName)
  const artifact=zip(entries),expectedChecksum=sha(artifact)
  const file=await lstat(target).catch(err=>err.code==='ENOENT'?null:Promise.reject(err))
  if(file) {
    if(!file.isFile()) errors('Paquete previo inseguro.')
    const checksum=await fileHash(target)
    if(checksum!==expectedChecksum) errors('Paquete previo alterado. No se reutilizará.')
    return {built:true,reused:true,productId:id,platform,relativePath:`releases/${id}/${packageName}`,sha256:checksum,manifestSha256:manifestSha,assetCount:catalog.length,commerciallyApproved:false,publicationConfirmed:false}
  }
  const final=await productById(id)
  if(sha(JSON.stringify({files:product.files,chapters:product.chapters,listings:product.listings,build:product.build,updatedAt:product.updatedAt}))!==
     sha(JSON.stringify({files:final.files,chapters:final.chapters,listings:final.listings,build:final.build,updatedAt:final.updatedAt})))
    return {built:false,...assessment,blockers:['El producto cambió antes de guardar el paquete.']}
  const temp=join(directory,`.${packageName}.${randomUUID()}.tmp`)
  try {const handle=await open(temp,'wx',0o600);try {await handle.writeFile(artifact)}finally{await handle.close()}await rename(temp,target)}
  finally {await rm(temp,{force:true})}
  return {built:true,reused:false,productId:id,platform,relativePath:`releases/${id}/${packageName}`,sha256:sha(artifact),manifestSha256:manifestSha,assetCount:catalog.length,commerciallyApproved:false,publicationConfirmed:false}
}

export async function salesSnapshot(id) {
  const p=await productById(id)
  const rows=Array.isArray(p.sales)?p.sales:[]
  const unverified=rows.filter(s=>s?.verifiedByPlatform!==true)
  const verified=rows.filter(s=>s?.verifiedByPlatform===true&&typeof s.platformReceipt==='string'&&s.platformReceipt.trim().length>0)
  const sum=items=>Math.round(items.reduce((total,s)=>total+(Number.isFinite(s.amount)&&s.amount>0? s.amount * (Number.isSafeInteger(s.quantity)&&s.quantity>0?s.quantity:1):0),0)*100)/100
  return {productId:id,reportedGross:sum(rows),unverifiedGross:sum(unverified),platformReceiptGross:sum(verified),
    platformReceiptCount:verified.length,confirmedPayouts:0,netProfit:null,notes:'Registros declarados; verificación externa de recibos y cobros pendiente. No afirmar ingresos recibidos.'}
}

async function cli(args) {
  const [cmd,...argv]=args
  if(cmd==='catalog') return Object.entries(RECIPES).map(([type,r])=>({type,label:r.label,markets:r.markets,required:r.groups,manualReview:r.reviews}))
  if(!cmd||cmd==='help') return {commands:['catalog','plan PRODUCT_ID [--platform direct]','check PRODUCT_ID [--platform direct]','package PRODUCT_ID [--platform direct]','metrics PRODUCT_ID'],publisherEnabled:false}
  const platform=argv.includes('--platform')?argv[argv.indexOf('--platform')+1]:'direct'
  const id=argv[0]
  if(cmd==='plan') {
    const p=await productById(id),recipe=RECIPES[p.type]
    if(!recipe) errors('Tipo no soportado.')
    return {productId:id,type:p.type,guide:recipe.guide,markets:recipe.markets,checklist:recipe.groups,manualReviews:recipe.reviews}
  }
  if(cmd==='check') return assessRelease(id,{platform})
  if(cmd==='package') return buildRelease(id,{platform})
  if(cmd==='metrics') return salesSnapshot(id)
  errors('Comando no reconocido.')
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(result=>console.log(JSON.stringify({ok:true,result},null,2)))
    .catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1})
}