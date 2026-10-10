import { ToolArgsError } from '@phoenix-ai/dsh-tools'

type RecordValue = Readonly<Record<string, unknown>>
function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
function failed(message: string): never {
  throw new ToolArgsError(['Game Studio · arte: ' + message])
}
function imageById(html: string, id: string): { width: number; height: number; colorType: number } {
  const tags = [...html.matchAll(/<img\b[^>]*>/giu)]
  const entry = tags.find(match => {
    const tag = match[0]
    const idMatch = /\bid\s*=\s*(["'])([^"']+)\1/iu.exec(tag)
    return idMatch?.[2] === id
  })
  if (entry === undefined) failed('falta un <img> real con id="' + id + '" para el sprite/escenario aprobado.')
  const src = /\bsrc\s*=\s*(["'])(.*?)\1/iu.exec(entry[0])?.[2]
  const png = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(src ?? '')
  if (png === null) failed('"' + id + '" debe ser un atlas PNG incrustado (data:image/png;base64), no una ruta inaccesible.')
  const bytes = Buffer.from(png[1], 'base64')
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(header)
    || !bytes.includes(Buffer.from('IDAT')) || !bytes.includes(Buffer.from('IEND'))) {
    failed('"' + id + '" no contiene un PNG completo con IDAT e IEND.')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const colorType = bytes[25] ?? -1
  if (width < 2 || height < 2 || width > 8192 || height > 8192) failed('"' + id + '" tiene dimensiones incorrectas.')
  if (colorType !== 6 && colorType !== 4 && colorType !== 3) failed('"' + id + '" debe admitir transparencia RGBA, gris+alpha o paleta.')
  return { width, height, colorType }
}

/**
 * Enforce a deliberate prototype-vs-production game art contract. An illustrated
 * hero must be loaded and drawn at runtime, never replaced with a box-based
 * mock while the generated hero remains an unused concept image.
 * @param html - Complete untrusted HTML proposed for Game Studio.
 * @param manifest - Parsed game metadata used for packaging.
 * @returns Classified art readiness; does not certify visual fidelity.
 */
export function validateGameArt(html: string, manifest: RecordValue): 'production-structure' | 'prototype' | 'not-required' {
  const genre = String(manifest.gameType ?? manifest.genre ?? '').toLowerCase()
  const isCharacterGame = /run.and.gun|shooter|platformer|top.down.action|\brpg\b|role.play/u.test(genre)
  const art = manifest.art
  if (!record(art)) {
    if (isCharacterGame) failed('juego con personajes sin contrato art. Declara art.mode="production" con atlas real o "prototype" y NO lo presentes como terminado.')
    return 'not-required'
  }
  if (art.mode === 'prototype') return 'prototype'
  if (art.mode !== 'production') failed('art.mode debe ser "production" o "prototype".')
  // Abstract/non-character genres may produce professional vector art without a sprite atlas.
  if (!isCharacterGame) return 'production-structure'
  if (!nonempty(art.designReference)) failed('falta art.designReference: identidad del diseño de protagonista aprobado.')
  if (!record(art.hero)) failed('falta art.hero para vincular el protagonista aprobado con los píxeles jugables.')
  const hero = art.hero
  if (!nonempty(hero.imageId)) failed('art.hero.imageId debe identificar la imagen PNG usada en el juego.')
  const atlas = imageById(html, hero.imageId)
  if (!Number.isInteger(hero.frameWidth) || !Number.isInteger(hero.frameHeight)
      || (hero.frameWidth as number) < 8 || (hero.frameHeight as number) < 8
      || atlas.width % (hero.frameWidth as number) !== 0 || atlas.height % (hero.frameHeight as number) !== 0) {
    failed('art.hero.frameWidth/frameHeight deben dividir exactamente el tamaño del atlas PNG.')
  }
  const total = atlas.width / (hero.frameWidth as number) * atlas.height / (hero.frameHeight as number)
  if (!record(hero.animations)) failed('falta art.hero.animations con índices de frames reales.')
  for (const state of ['idle', 'run', 'jump', 'fall', 'shoot', 'hurt', 'death']) {
    const frames = hero.animations[state]
    if (!Array.isArray(frames) || frames.length < (state === 'run' ? 4 : 1)
      || frames.some(frame => !Number.isInteger(frame) || frame < 0 || frame >= total)) {
      failed('el protagonista no tiene frames válidos para "' + state + '".')
    }
    if (state === 'run' && new Set(frames).size < 4) failed('la animación run repite el mismo frame; requiere cuatro poses reales.')
  }
  if (!Array.isArray(art.backgrounds) || art.backgrounds.length === 0) failed('faltan imágenes de escenario integradas: art.backgrounds.')
  for (const item of art.backgrounds) {
    if (!record(item) || !nonempty(item.imageId)) failed('cada fondo debe declarar imageId.')
    imageById(html, item.imageId)
  }
  const runtime = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)]
    .filter(match => !/\btype\s*=\s*["']application\/json["']/iu.test(match[1] ?? ''))
    .map(match => match[2] ?? '').join('\n')
  if (!/\.drawImage\s*\(/u.test(runtime)) failed('no se llama a canvas.drawImage: el diseño no está realmente dibujado en gameplay.')
  if (!runtime.includes(hero.imageId)) failed('JavaScript no referencia art.hero.imageId; el protagonista diseñado quedó desconectado.')
  for (const item of art.backgrounds) {
    if (record(item) && nonempty(item.imageId) && !runtime.includes(item.imageId)) {
      failed('JavaScript no carga el escenario ilustrado "' + item.imageId + '".')
    }
  }
  return 'production-structure'
}
