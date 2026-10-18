/** Reusable book quality skill. Evidence-based checks, not an AI bestseller guarantee.
 * Business Engine invokes this only for book products. All other products are unaffected.
 */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { inflateSync } from 'node:zlib'

export const BOOK_FORMATS = Object.freeze({
  novel: { minWords: 50000, minChapters: 15, guidance: 'Novela larga: desarrollar escenas, personajes y desenlace completo.' },
  novella: { minWords: 15000, minChapters: 6, guidance: 'Novela corta: arco autocontenido, sin capítulos de relleno.' },
  nonfiction: { minWords: 25000, minChapters: 8, guidance: 'No ficción: referencias, método y revisión de hechos específicos.' },
  children: { minWords: 2000, minChapters: 1, guidance: 'Infantil: longitud y lenguaje adaptados a edad y formato.' },
})
export const GENRE_GUIDES = Object.freeze({
  thriller: { targetWords: 90000, focus: ['misterio causal', 'tensión escalonada', 'revelaciones justificadas'] },
  romance: { targetWords: 85000, focus: ['conflicto emocional', 'agencia de protagonistas', 'resolución convincente'] },
  fantasy: { targetWords: 105000, focus: ['reglas del mundo', 'arcos entrelazados', 'continuidad de la saga'] },
  scifi: { targetWords: 95000, focus: ['premisa verificable', 'consecuencias tecnológicas', 'coherencia interna'] },
  horror: { targetWords: 80000, focus: ['atmósfera', 'progresión del peligro', 'consecuencias de decisiones'] },
  general: { targetWords: 80000, focus: ['personajes', 'causalidad', 'ritmo y resolución'] },
})
const countWords = text => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
const normalize = text => text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
const sha256 = value => createHash('sha256').update(value).digest('hex')
const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const bookFormat = product => BOOK_FORMATS[product?.blueprint?.editorial?.format] ? product.blueprint.editorial.format : 'novel'

/** Curated editorial directions, NOT sales rankings or externally verified demand data. */
export function genreGuide(genre) {
  const n = normalize(typeof genre === 'string' ? genre : '')
  const group = /thriller|misterio|suspense|policiac|detective/u.test(n) ? 'thriller'
    : /romance|romant|amor/u.test(n) ? 'romance'
    : /fantas|epic|magia/u.test(n) ? 'fantasy'
    : /ciencia ficcion|science fiction|sci.fi|distop/u.test(n) ? 'scifi'
    : /terror|horror/u.test(n) ? 'horror' : 'general'
  return { genreKey: group, ...GENRE_GUIDES[group], marketDemandVerified: false }
}

function repetitionRatio(text) {
  const tokens = (normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [])
  if (tokens.length < 12) return 1
  const n = Math.min(tokens.length, 10000)
  const phrases = new Set()
  for (let i = 0; i <= n - 8; i++) phrases.add(tokens.slice(i, i + 8).join(' '))
  return Number((phrases.size / (n - 7)).toFixed(3))
}

/** Validates dimensions of a raster cover; visual attractiveness and licensing remain human QA. */
export function inspectCover(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return { valid: false, reason: 'Portada no reconocida.' }
  let width, height, format
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    format = 'png'
    if (bytes.toString('ascii', 12, 16) !== 'IHDR') return { valid: false, reason: 'PNG sin cabecera IHDR.' }
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
    const depth = bytes[24], color = bytes[25]
    const channels = ({0:1,2:3,3:1,4:2,6:4})[color]
    if (depth !== 8 || !channels) return {valid:false,format,reason:'PNG debe ser de 8 bits por canal para EPUB.'}
    let offset=8, idat=[], iend=false, started=false
    while (offset+12 <= bytes.length) {
      const length=bytes.readUInt32BE(offset)
      if (length>40*1024*1024 || offset+length+12>bytes.length) break
      const kind=bytes.toString('ascii',offset+4,offset+8)
      if (!started && (kind!=='IHDR'||length!==13)) break
      started=true
      if (kind==='IDAT') idat.push(bytes.subarray(offset+8,offset+8+length))
      offset+=length+12
      if (kind==='IEND') {iend=length===0 && offset===bytes.length;break}
    }
    if (!iend || !idat.length || width>20000 || height>20000) return {valid:false,format,reason:'PNG incompleto o dimensiones inseguras.'}
    try {
      const scan=inflateSync(Buffer.concat(idat),{maxOutputLength:60*1024*1024})
      const row=width*channels+1
      if (scan.length!==row*height) return {valid:false,format,reason:'PNG no coincide con sus dimensiones.'}
      for (let y=0;y<height;y++) if (scan[y*row]>4) return {valid:false,format,reason:'PNG con filtros de imagen no válidos.'}
    } catch {return {valid:false,format,reason:'No se puede descomprimir la portada PNG.'}}
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    format = 'jpeg'
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break
      let marker = bytes[offset + 1]
      while (marker === 255 && offset + 2 < bytes.length) { offset++; marker = bytes[offset + 1] }
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) { offset += 2; continue }
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > bytes.length) break
      if ([192, 193, 194, 195, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break
      }
      offset += 2 + length
    }
  } else return { valid: false, reason: 'Formato de portada no compatible (se requiere JPG o PNG).' }
  if (format==='jpeg' && (bytes[bytes.length-2]!==255 || bytes[bytes.length-1]!==217)) return {valid:false,format,reason:'JPEG incompleto.'}
  if (!width || !height) return { valid: false, format, reason: 'No se pudieron verificar dimensiones.' }
  const ratio = height / width
  const valid = width >= 1200 && height >= 1800 && ratio >= 1.30 && ratio <= 1.85
  return { valid, format, width, height, reason: valid ? null : 'Portada demasiado pequeña o proporción no apta para cubierta vertical.' }
}

/** Quantitative readiness; impossible to certify great storytelling or plagiarism automatically. */
export function evaluateBook(product, chapters, covers = []) {
  if (!isObj(product) || product.type !== 'book') throw new Error('Solo se auditan libros.')
  const blockers = [], warnings = [], perChapter = []
  const blueprint = product.blueprint
  const formatKey = bookFormat(product), standard = BOOK_FORMATS[formatKey]
  const plan = Array.isArray(blueprint?.chapters) ? blueprint.chapters : []
  if (!plan.length) blockers.push('Falta plan editorial persistente con todos los capítulos.')
  if (!Array.isArray(blueprint?.characters) || !blueprint.characters.length) blockers.push('Falta biblia de personajes y sus arcos.')
  if (!Array.isArray(blueprint?.timeline) || !blueprint.timeline.length) warnings.push('Cronología no registrada: continuidad temporal requiere revisión.')
  if (!Array.isArray(blueprint?.worldRules) || !blueprint.worldRules.length) warnings.push('Reglas del mundo no registradas: revisar consistencia.')
  if (plan.length < standard.minChapters) blockers.push('El formato ' + formatKey + ' requiere al menos ' + standard.minChapters + ' capítulos según la política interna.')
  if (!Number.isSafeInteger(blueprint?.targetWords) || blueprint.targetWords < standard.minWords) blockers.push('Objetivo demasiado corto para ' + formatKey + ' (' + standard.minWords + ' palabras mínimas internas).')
  if (!Array.isArray(chapters)) throw new Error('Listado de capítulos inválido.')
  const ordered = [...chapters].sort((a, b) => a.number - b.number)
  if (ordered.length !== plan.length || !ordered.every((c, i) => c.number === i + 1)) blockers.push('Faltan capítulos o existe una numeración incompleta.')
  let totalWords = 0
  for (const expected of plan) {
    const item = ordered.find(x => x.number === expected.number)
    if (!item || typeof item.text !== 'string') {
      perChapter.push({ number: expected.number, status: 'missing', words: 0, targetWords: expected.targetWords })
      blockers.push('Falta el texto real del capítulo ' + expected.number + '.')
      continue
    }
    const realWords = countWords(item.text)
    totalWords += realWords
    const declared = product.chapters?.find(x => x.number === expected.number)
    const minimum = Math.max(formatKey === 'children' ? 100 : 600,
      Math.ceil(expected.targetWords * (expected.kind === 'interlude' ? 0.55 : 0.72)))
    const ratio = repetitionRatio(item.text)
    const problems = []
    if (realWords < minimum) problems.push('Capítulo insuficiente: ' + realWords + '/' + minimum + ' palabras mínimas.')
    if (declared && declared.words !== realWords) problems.push('Recuento declarado no coincide con el manuscrito.')
    if (/\b(?:lorem ipsum|TODO|TBD|insertar texto aqu[ií]|escribir cap[ií]tulo|pendiente de redactar)\b/iu.test(item.text)) problems.push('Contiene texto provisional o marcadores.')
    if (realWords >= 150 && ratio < 0.65) problems.push('Repetición excesiva de secuencias: posible relleno mecánico.')
    if (realWords >= 1200 && item.text.trim().split(/\n\s*\n/u).length < 4) warnings.push('Capítulo ' + expected.number + ': comprobar estructura de párrafos y escenas.')
    if (problems.length) blockers.push('Capítulo ' + expected.number + ': ' + problems.join(' '))
    perChapter.push({number: expected.number, title: expected.title, words: realWords,
      targetWords: expected.targetWords, minimumWords: minimum, repetitionRatio: ratio,
      status: problems.length ? 'needs-revision' : 'structurally-complete', problems})
  }
  if (totalWords < standard.minWords || totalWords < Math.ceil((blueprint?.targetWords || 0) * 0.90)) blockers.push('Manuscrito completo por debajo de la longitud acordada.')
  const coverResults = covers.map(c => ({ name: c.name, ...inspectCover(c.bytes) }))
  if (!coverResults.some(c => c.valid)) blockers.push('Falta portada JPG/PNG con dimensiones verificables para ebook.')
  const reviewGates = ['continuidad narrativa y causalidad','originalidad y derechos','estructura y ritmo literario',
    'corrección ortotipográfica','portada y diseño de marketing','accesibilidad y navegación EPUB',
    'PDF de impresión paginado y lomo cuando aplique','declaración de contenido IA y políticas del canal']
  return { productId: product.id, format: formatKey, genre: genreGuide(blueprint?.genre),
    targetWords: blueprint?.targetWords ?? null, actualWords: totalWords, plannedChapters: plan.length,
    completedChapters: perChapter.filter(c => c.status === 'structurally-complete').length,
    chapterReport: perChapter, coverResults, blockers: [...new Set(blockers)], warnings,
    structurallyReadyForReview: blockers.length === 0, humanEditorialReviewVerified: false,
    originalityVerified: false, coverArtQualityVerified: false, printReadyVerified: false,
    publiclyPublished: false, salesVerified: false, readyForUnsupervisedPublication: false,
    reviewGates }
}

/** Safe read from a durable library; prevents traversal, symlinks and stale checksums. */
export async function auditBook(product, root) {
  if (!isObj(product) || product.type !== 'book') throw new Error('Producto editorial inválido.')
  const rootReal = await realpath(root)
  const readAsset = async asset => {
    const relative = asset?.path
    if (typeof relative !== 'string' || !relative.startsWith('products/' + product.id + '/') ||
        relative.includes('\\') || relative.split('/').includes('..') || !/^[a-zA-Z0-9/_\-.]+$/u.test(relative) ||
        !isHash(asset.sha256)) throw new Error('Ruta o huella insegura en el libro.')
    const file = resolve(root, relative)
    if (!file.startsWith(resolve(root) + sep)) throw new Error('Ruta de libro fuera de biblioteca.')
    const st = await lstat(file)
    if (!st.isFile() || st.isSymbolicLink() || st.size > 40 * 1024 * 1024) throw new Error('Archivo no regular o demasiado grande.')
    if (!(await realpath(file)).startsWith(rootReal + sep)) throw new Error('Enlace externo a biblioteca.')
    const bytes = await readFile(file)
    if (sha256(bytes) !== asset.sha256) throw new Error('Huella de archivo modificada.')
    return bytes
  }
  const chapters = []
  for (const item of product.chapters ?? []) chapters.push({number: item.number, text: (await readAsset(item)).toString('utf8')})
  const covers = []
  for (const item of (product.files ?? []).filter(x => x.role === 'cover')) {
    covers.push({name: item.name, bytes: await readAsset(item)})
  }
  return evaluateBook(product, chapters, covers)
}

/** Source-bound marketing directions, not proof that listed books sold particular amounts. */
export function buildBookMarketingBrief(product, sources) {
  if (!isObj(product) || product.type !== 'book') throw new Error('Se necesita un producto tipo book.')
  if (!Array.isArray(sources) || sources.length < 2 || sources.length > 30) throw new Error('Se necesitan de 2 a 30 fuentes para un posicionamiento responsable.')
  const seen = new Set(), evidence = []
  for (const source of sources) {
    if (!isObj(source) || typeof source.title !== 'string' || source.title.trim().length < 5 ||
        typeof source.observation !== 'string' || source.observation.trim().length < 12 ||
        typeof source.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(source.date) ||
        !Number.isFinite(Date.parse(source.date + 'T00:00:00Z')) ||
        Date.parse(source.date + 'T00:00:00Z') > Date.now()) throw new Error('Fuente comercial sin título, observación o fecha válida.')
    let url
    try { url = new URL(source.url) } catch { throw new Error('Enlace comercial inválido.') }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') ||
        /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/iu.test(url.hostname)) throw new Error('Se necesitan fuentes públicas HTTPS.')
    const canonical = url.origin + url.pathname
    if (seen.has(canonical)) throw new Error('Fuentes de mercado duplicadas.')
    seen.add(canonical)
    evidence.push({title:source.title.trim().slice(0,150),url:canonical,date:source.date,
      observation:source.observation.trim().slice(0,700),metricType:typeof source.metricType==='string'?source.metricType.slice(0,40):'qualitative'})
  }
  const genre = genreGuide(product.blueprint?.genre)
  return { productId: product.id, positioning: {genre: product.blueprint?.genre ?? 'por definir',
    reader: product.blueprint?.audience ?? 'por definir', editorialPromise: product.blueprint?.premise ?? 'por definir',
    creativeFocus: genre.focus},
    evidence, actions: ['Revisar las fuentes y sus métricas antes de afirmar demanda o ventas.',
      'Probar 2–3 portadas y sinopsis originales con lectores del género.',
      'Preparar muestra de lectura, categorías, palabras clave y ficha comercial.',
      'Medir conversiones, devoluciones y beneficio neto solo con datos de la plataforma.'],
    independentSourceVerification: false, bestsellerPredictionVerified: false,
    externalAdvertisingExecuted: false, customerSalesVerified: false }
}
