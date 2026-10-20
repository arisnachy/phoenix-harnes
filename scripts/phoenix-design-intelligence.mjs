#!/usr/bin/env node
/** Phoenix Design Intelligence: plan MCP work and preserve verifiable design receipts.
 * Never invokes a paid tool, publishes, fabricates a deliverable or assumes a connector is authenticated.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(process.env.PHOENIX_DESIGN_HOME || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'design-intelligence'))
const ID = /^[a-f0-9-]{36}$/u
const DESIGN_ID = /^D[a-zA-Z0-9_-]{10}$/u
const SERVER = /^[a-zA-Z0-9_-]{1,64}$/u
const TOOL = /^mcp__[a-zA-Z0-9_-]{1,64}__[a-zA-Z0-9_-]{1,100}$/u
const MAX_FILE = 128 * 1024 * 1024
const MAX_INVENTORY = 256 * 1024
const names = {
  generate: ['create_design', 'generate_design', 'prepare_design_generation'],
  images: ['generate_image', 'image_to_design', 'remove_background'],
  brand: ['list_brand_kits', 'search_brand_templates', 'create_design_from_brand_template'],
  merge: ['merge_designs'],
  update: ['start_editing_transaction', 'perform_editing_operations', 'commit_editing_transaction'],
  autofill: ['get_design_dataset', 'get_brand_template_dataset', 'autofill_design'],
  preview: ['get_design_pages', 'get_design_thumbnail', 'get_design'],
  resize: ['resize_design'],
  export: ['export_design', 'create_design_export_job', 'get_design_export_job'],
}
const categories = [
  ['comic', /\b(comic|comics|historieta|manga|webtoon|novela grafica)\b/u],
  ['book', /\b(libro|novela|ebook|portada|contraportada|editorial|book)\b/u],
  ['research', /\b(cientific|investigacion|congreso|poster|infografia|informe|research|journal)\b/u],
  ['course', /\b(curso|educacion|lecciones|diapositivas|manual|course)\b/u],
  ['catalog', /\b(catalogo|productos|tarifario|fichas|inventario|catalog)\b/u],
  ['identity', /\b(marca|logo|branding|identidad visual|brand)\b/u],
  ['marketing', /\b(marketing|campana|anuncios|instagram|facebook|redes sociales|flyer|ads)\b/u],
  ['video', /\b(video|animacion|reel|mp4)\b/u],
]
const sha = value => createHash('sha256').update(value).digest('hex')
const fail = message => { throw new Error(message) }
const norm = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
const validJob = id => typeof id === 'string' && ID.test(id) ? id : fail('Identificador de misión inválido.')
const jobDir = id => join(ROOT, 'jobs', validJob(id))
const jsonFile = id => join(jobDir(id), 'manifest.json')
const boundedText = (value, limit, field) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit ? value.trim() : fail(field + ' inválido.')
const formatSet = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'pptx', 'docx', 'epub', 'mp4', 'svg'])

/** Choose a visual route from an actual, secret-free runtime inventory. No operations are performed. */
export function planDesign(request, inventory) {
  const brief = boundedText(request, 4000, 'Petición')
  if (inventory !== undefined && (!Array.isArray(inventory) || inventory.length > 200)) fail('Inventario MCP inválido.')
  const normalized = norm(brief)
  const kind = categories.find(([, re]) => re.test(normalized))?.[0] || 'design'
  const matches = (inventory || []).filter(item => item && typeof item.serverName === 'string' && SERVER.test(item.serverName) && /canva/i.test(item.serverName) && ['ready','starting','auth-required','failed','disconnected'].includes(item.status) && Array.isArray(item.toolNames) && item.toolNames.length <= 400)
  const chosen = matches.find(x => x.status === 'ready') || matches[0]
  const toolNames = (chosen?.toolNames || []).filter(t => typeof t === 'string' && TOOL.test(t) && t.toLowerCase().startsWith(('mcp__' + chosen.serverName + '__').toLowerCase()))
  const available = Object.fromEntries(Object.entries(names).map(([capability, variants]) => [capability, variants.filter(n => toolNames.some(t => t.toLowerCase().endsWith('__' + n)))]))
  const needsBulk = kind === 'catalog' || /\b(masivo|lote|cientos|bulk|autofill)\b/u.test(normalized)
  const wantsEdit = /\b(edita|modifica|actualiza|corrige|replace|edit)\b/u.test(normalized)
  const requestedOutput = [...formatSet].filter(f => new RegExp('\\b' + f + '\\b','u').test(normalized))
  const stages = [
    'definir-contenido-y-especificaciones',
    'comprobar-herramientas-reales-y-licencias',
    kind === 'comic' || kind === 'book' ? 'preservar-continuidad-y-activos-de-origen' : 'seleccionar-referencias-y-plantillas',
    wantsEdit ? 'editar-diseño-existente' : needsBulk ? 'rellenar-plantillas-en-lote' : 'crear-diseno',
    'inspeccionar-paginas-y-legibilidad',
    'entregar-enlace-real-o-exportacion-verificada',
  ]
  const blockers = []
  if (!chosen) blockers.push('Canva no figura en el inventario proporcionado; no se presume conectado.')
  else if (chosen.status !== 'ready') blockers.push('El servidor Canva no está listo: ' + chosen.status + '.')
  else if (!available.generate.length && !available.update.length) blockers.push('El servidor no anuncia herramientas suficientes para generar o editar.')
  if (needsBulk && !available.autofill.includes('autofill_design')) blockers.push('Autofill no está disponible; utilizar plantillas locales o una alternativa autorizada.')
  if (requestedOutput.length && !available.export.length) blockers.push('No hay exportación MCP anunciada; generar el archivo con el motor local o un exportador autorizado y verificarlo.')
  return {
    schemaVersion: 1, kind, stages, requestedOutput,
    connector: chosen ? { server: chosen.serverName, status: chosen.status, capabilities: available } : null,
    connectorState: inventory === undefined ? 'unknown' : 'inspected',
    route: chosen?.status === 'ready' && (available.generate.length || available.update.length) ? 'canva-hybrid' : 'local-engine-pending-verification',
    premiumMayBeRequired: needsBulk || available.brand.length > 0,
    externalPublicationRequiresApproval: true,
    paidActionsRequireApproval: true,
    canvaLinkIsNotAnExportedFile: true,
    blockers,
  }
}

/** Read a small, metadata-only MCP inventory; discard all unrecognized properties. */
export async function readInventory(path) {
  if (!path) return undefined
  const meta = await lstat(resolve(path))
  if (!meta.isFile() || meta.size > MAX_INVENTORY) fail('Archivo de inventario inválido.')
  const rows = JSON.parse(await readFile(path, 'utf8'))
  const list = Array.isArray(rows) ? rows : rows?.connectors
  if (!Array.isArray(list) || list.length > 200) fail('El inventario debe ser un array de conectores.')
  return list.map(x => ({
    serverName: x?.serverName,
    status: x?.status,
    toolNames: x?.toolNames,
  }))
}
async function writeAtomic(path, data) {
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temp, path)
  } finally { await rm(temp, {force:true}) }
}
async function readJob(id) {
  const p = jsonFile(id)
  const info = await lstat(p)
  if (!info.isFile() || info.size > 256 * 1024) fail('Expediente inválido.')
  const job = JSON.parse(await readFile(p, 'utf8'))
  if (job.schemaVersion !== 1 || job.id !== id || !Array.isArray(job.files) || !Array.isArray(job.designs)) fail('Expediente incompatible.')
  return job
}
async function locked(id, fn) {
  const dir = jobDir(id)
  const p = join(dir, '.lock')
  const handle = await open(p, 'wx', 0o600).catch(e => e.code === 'EEXIST' ? fail('Misión en uso; reintentar sin duplicar la operación.') : Promise.reject(e))
  try { return await fn() } finally { await handle.close(); await rm(p, {force:true}) }
}
/** Persist an in-progress mission without claiming any external result. */
export async function startDesign(request, inventory) {
  const plan = planDesign(request, inventory)
  const id = randomUUID()
  await mkdir(jobDir(id), { recursive:true })
  const job = {
    schemaVersion:1, id, requestSha256:sha(request), plan, status:'pending',
    designs:[], files:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  }
  await writeAtomic(jsonFile(id), job)
  return { id, status:job.status, plan }
}
async function updateJob(id, fn) {
  return locked(id, async () => {
    const job = await readJob(id)
    const result = await fn(job)
    job.updatedAt = new Date().toISOString()
    await writeAtomic(jsonFile(id), job)
    return result
  })
}
/** Record a Canva URL only after a corresponding real provider response. Does not validate remote existence. */
export async function linkDesign(id, designId, url, sourceTool) {
  if (!DESIGN_ID.test(designId)) fail('ID de diseño Canva inválido.')
  const tool = boundedText(sourceTool, 80, 'Herramienta')
  if (!/^(get_design|get_create_design_async_job|create_design_from_candidate|create_design_from_brand_template|autofill_design|image_to_design|generate_design|create_design)$/u.test(tool)) fail('La herramienta no acredita un diseño persistido.')
  let parsed
  try { parsed = new URL(url) } catch { fail('Enlace Canva inválido.') }
  if (parsed.protocol !== 'https:' || !['canva.com','www.canva.com'].includes(parsed.hostname) || parsed.pathname.split('/')[2] !== designId || parsed.pathname.split('/')[1] !== 'design') fail('El enlace no corresponde al ID.')
  return updateJob(id, async job => {
    if (!job.designs.some(x => x.id === designId)) job.designs.push({ id:designId, url:parsed.origin + parsed.pathname, sourceTool:tool })
    job.status = job.files.length ? 'export-signature-verified' : 'design-linked-unverified'
    return { id:job.id, status:job.status, designId }
  })
}
async function digestFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
function sniff(format, bytes) {
  if (format === 'pdf') { const end = bytes.lastIndexOf(Buffer.from('%%EOF')); return bytes.subarray(0,5).toString() === '%PDF-' && end >= 0 && bytes.length - end <= 1024 }
  if (format === 'png') return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.length > 24 && bytes.toString('ascii',12,16) === 'IHDR'
  if (format === 'jpg' || format === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  if (format === 'webp') return bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP'
  if (format === 'pptx' || format === 'docx' || format === 'epub') {
    if (bytes[0] !== 80 || bytes[1] !== 75 || bytes[2] !== 3 || bytes[3] !== 4) return false
    const filename = format === 'pptx' ? 'ppt/presentation.xml' : format === 'docx' ? 'word/document.xml' : 'META-INF/container.xml'
    return bytes.includes(Buffer.from(filename)) && (format === 'epub' ? bytes.includes(Buffer.from('mimetype')) : bytes.includes(Buffer.from('[Content_Types].xml')))
  }
  if (format === 'mp4') return bytes.toString('ascii',4,8) === 'ftyp'
  if (format === 'svg') return /<svg(?:\s|>)/u.test(bytes.toString('utf8',0,2048)) && /<\/svg>/u.test(bytes.toString('utf8',Math.max(bytes.length - 2048,0)))
  return false
}
/** Copy a genuine artifact into durable storage with signature, length and SHA-256 evidence. */
export async function verifyExport(id, sourcePath, format, role='final') {
  validJob(id)
  const ext = boundedText(format, 8, 'Formato').toLowerCase()
  if (!formatSet.has(ext)) fail('Formato de exportación no admitido.')
  const purpose = boundedText(role, 64, 'Rol')
  if (!/^[a-zA-Z0-9_-]+$/u.test(purpose)) fail('Rol inválido.')
  const input = resolve(sourcePath)
  const info = await lstat(input)
  if (!info.isFile() || info.size < 24 || info.size > MAX_FILE) fail('Exportación ausente, simbólica, vacía o excesiva.')
  if (extname(input).toLowerCase() !== '.' + ext) fail('La extensión no corresponde al formato declarado.')
  const bytes = await readFile(input)
  if (!sniff(ext, bytes)) fail('La firma no corresponde a un archivo ' + ext.toUpperCase() + '.')
  return updateJob(id, async job => {
    const idFile = randomUUID()
    const dir = join(jobDir(id), 'artifacts')
    await mkdir(dir, {recursive:true})
    const dest = join(dir, idFile + '.' + ext)
    await copyFile(input, dest)
    const digest = await digestFile(dest)
    if (digest !== sha(bytes)) { await rm(dest, {force:true}); fail('El archivo cambió durante la copia.') }
    const item = { id:idFile, role:purpose, format:ext, filename:basename(dest), bytes:bytes.length, sha256:digest }
    job.files.push(item)
    job.status = 'export-signature-verified'
    return { jobId:id, status:job.status, item, path:dest, validation:'firma+tamaño+sha256; no equivale a revisión editorial ni de licencia' }
  })
}
/** Recheck all durable files before reporting what can actually be delivered. */
export async function inspectDesign(id) {
  const job = await readJob(id)
  const errors = []
  for (const file of job.files) {
    if (!/^[a-f0-9-]{36}$/u.test(file.id) || !formatSet.has(file.format) || file.filename !== file.id + '.' + file.format) {
      errors.push('Metadatos de archivo inválidos.'); continue
    }
    try {
      const path = join(jobDir(id), 'artifacts', file.filename)
      const meta = await lstat(path)
      if (!meta.isFile() || meta.size !== file.bytes || await digestFile(path) !== file.sha256) errors.push('Integridad alterada: ' + file.filename)
    } catch { errors.push('Archivo ausente: ' + file.filename) }
  }
  return { id, kind:job.plan.kind, status: errors.length ? 'integrity-failed' : job.status, designs:job.designs, files:job.files.map(file => ({...file, path:join(jobDir(id), 'artifacts', file.filename)})), errors, warning:'Ningún enlace Canva demuestra por sí solo exportación, publicación, calidad visual o derechos.' }
}
async function main() {
  const [cmd,...args] = process.argv.slice(2)
  const option = key => { const i=args.indexOf('--'+key); return i < 0 ? undefined : args[i+1] }
  let result
  if (cmd === 'plan') result = planDesign(option('request'), await readInventory(option('inventory')))
  else if (cmd === 'start') result = await startDesign(option('request'), await readInventory(option('inventory')))
  else if (cmd === 'link') result = await linkDesign(args[0], option('design'), option('url'), option('tool'))
  else if (cmd === 'export') result = await verifyExport(args[0], args[1], option('format'), option('role') || 'final')
  else if (cmd === 'inspect') result = await inspectDesign(args[0])
  else result = {usage:[
    'plan --request "solicitud" [--inventory runtime.json]',
    'start --request "solicitud" [--inventory runtime.json]',
    'link JOB --design Dxxxxxxxxxx --url https://www.canva.com/design/Dxxxxxxxxxx/... --tool get_design',
    'export JOB archivo.pdf --format pdf [--role final]',
    'inspect JOB',
  ]}
  console.log(JSON.stringify(result,null,2))
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(JSON.stringify({error:e.message})); process.exitCode=1 })
}
