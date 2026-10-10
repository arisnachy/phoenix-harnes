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
  const bytes = Buffer.from(png[1] ?? '', 'base64')
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
  const imageBindings = [...runtime.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*(["'])([^"']+)\2\s*\)/gu)]
  const drawnVariables = new Set([...runtime.matchAll(/\.drawImage\s*\(\s*([A-Za-z_$][\w$]*)\s*,/gu)].map(match => match[1]))
  const usedByDraw = (id: string): boolean => imageBindings.some(match =>
    match[3] === id && drawnVariables.has(match[1] ?? ''))
  if (!usedByDraw(hero.imageId)) failed('el sprite del protagonista no se carga y dibuja con drawImage en el juego.')
  for (const item of art.backgrounds) {
    if (record(item) && nonempty(item.imageId) && !usedByDraw(item.imageId)) {
      failed('JavaScript no carga ni dibuja con drawImage el escenario ilustrado "' + item.imageId + '".')
    }
  }

  // A production shooter is a complete illustrated world, not an isolated hero
  // atlas pasted over placeholder enemies, props, weapons and mountains.
  if (/run.and.gun|shooter|shoot.em.up/u.test(genre)) {
    const group = (name: string, min: number, states: readonly string[] = []): RecordValue[] => {
      const entries = art[name]
      if (!Array.isArray(entries) || entries.length < min || !entries.every(record)) {
        failed('falta art.' + name + ': crea e integra todos los diseños antes de declarar arte de producción.')
      }
      const images = new Set<string>()
      const ids = new Set<string>()
      for (const entry of entries) {
        if (!nonempty(entry.id) || !nonempty(entry.imageId)) failed('art.' + name + ' requiere id e imageId reales.')
        if (ids.has(entry.id) || images.has(entry.imageId)) failed('art.' + name + ' reutiliza un id/atlas en papeles diferentes.')
        ids.add(entry.id); images.add(entry.imageId)
        const atlas = imageById(html, entry.imageId)
        if (!usedByDraw(entry.imageId)) failed('art.' + name + ' no se dibuja con drawImage: ' + entry.id)
        if (states.length === 0) continue
        if (!Number.isInteger(entry.frameWidth) || !Number.isInteger(entry.frameHeight)
          || (entry.frameWidth as number) < 8 || (entry.frameHeight as number) < 8
          || atlas.width % (entry.frameWidth as number) !== 0
          || atlas.height % (entry.frameHeight as number) !== 0) {
          failed('art.' + name + ' tiene recortes de sprites inválidos: ' + entry.id)
        }
        const count = atlas.width / (entry.frameWidth as number) * atlas.height / (entry.frameHeight as number)
        if (!record(entry.animations)) failed('art.' + name + ' necesita animaciones para ' + entry.id)
        for (const state of states) {
          const frames = entry.animations[state]
          if (!Array.isArray(frames) || frames.length < 1 || frames.some(index =>
            !Number.isInteger(index) || index < 0 || index >= count)) {
            failed('art.' + name + ': faltan frames reales "' + state + '" de ' + entry.id)
          }
        }
      }
      return entries
    }
    const roster = (visual: string, game: string, states: readonly string[]): RecordValue[] => {
      const declared = manifest[game]
      if (!Array.isArray(declared) || declared.length === 0 || !declared.every(record)) {
        failed('faltan ' + game + ' jugables declarados en el manifiesto.')
      }
      const characters = group(visual, declared.length, states)
      for (const entity of declared) {
        if (!nonempty(entity.id) || !characters.some(entry => entry.id === entity.id)) {
          failed('el ' + game + ' "' + String(entity.id) + '" no tiene diseño animado propio en art.' + visual)
        }
      }
      return characters
    }
    const enemies = roster('enemies', 'enemies', ['move', 'attack', 'hurt', 'death'])
    const bosses = roster('bosses', 'bosses', ['idle', 'attack', 'hurt', 'death'])
    for (const boss of bosses) {
      const declared = (manifest.bosses as RecordValue[]).find(item => item.id === boss.id)
      if (!Array.isArray(declared?.phases) || !record(boss.phaseAnimations)) {
        failed('el jefe ' + String(boss.id) + ' necesita diseños para cada fase de combate.')
      }
      const animated = boss.animations as RecordValue
      for (const phase of declared.phases) {
        if (!nonempty(phase) || !Array.isArray(boss.phaseAnimations[phase])
          || boss.phaseAnimations[phase].length === 0
          || boss.phaseAnimations[phase].some(frame => !Number.isInteger(frame)
            || frame < 0 || !Object.values(animated).some(value => Array.isArray(value) && value.includes(frame)))) {
          failed('falta el atlas de animación para la fase "' + String(phase) + '" del jefe ' + String(boss.id))
        }
      }
    }
    // Backdrops represent the distinct camera layers, not a single generic flat rectangle.
    const expectedLayers = record(manifest.level) && Array.isArray(manifest.level.layers)
      ? manifest.level.layers.filter(record) : []
    if (expectedLayers.length < 3) failed('escenario de producción necesita capas parallax reales.')
    const backdrops = group('backgrounds', expectedLayers.length)
    for (const layer of expectedLayers) if (!backdrops.some(entry => entry.id === layer.id)) {
      failed('falta ilustrar la capa del escenario ' + String(layer.id) + '.')
    }
    group('weapons', 1)
    group('projectiles', 1)
    group('powers', 1)
    group('props', 1)
    group('effects', 2)
    // No independent family may secretly reuse the same PNG as the hero or
    // substitute one picture for every enemy, boss, weapon and environment.
    const all = [art.hero, ...enemies, ...bosses,
      ...['backgrounds','weapons','projectiles','powers','props','effects'].flatMap(name => art[name] as RecordValue[])]
    const ids = all.filter(record).map(item => item.imageId).filter(nonempty)
    if (new Set(ids).size !== ids.length) failed('el protagonista y los elementos del mundo deben tener recursos visuales distintos.')
  }
  return 'production-structure'
}
