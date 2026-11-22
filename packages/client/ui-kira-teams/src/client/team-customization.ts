/** User-owned names and portraits for the 21 fixed PHOENIX Living Team slots.
 * Stored only in this browser's IndexedDB. Never changes runtime routing ids.
 */
import type { ModelAvatarKind } from './ModelActivityAvatar.tsx'

export const LIVING_TEAM_KINDS = [
  'kira','vortice','aurora','atlas','nova','lumen','helix','prisma','orion','vega',
  'eclipse','argo','solaria','nexo','astra','lyra','zenith','cobalto','quasar','senda','orbita',
] as const satisfies readonly ModelAvatarKind[]
export type LivingTeamKind = typeof LIVING_TEAM_KINDS[number]
export type TeamDisplayNames = Partial<Record<LivingTeamKind, string>>
/** Canonical default labels, used only to guard against ambiguous @mentions. */
export const DEFAULT_TEAM_NAMES: Readonly<Record<LivingTeamKind, string>> = {
  kira: 'Kira', vortice:'Vórtice', aurora:'Aurora', atlas:'Atlas', nova:'Nova',
  lumen:'Lumen', helix:'Helix', prisma:'Prisma', orion:'Orión', vega:'Vega',
  eclipse:'Eclipse', argo:'Argo', solaria:'Solaria', nexo:'Nexo', astra:'Astra',
  lyra:'Lyra', zenith:'Zenith', cobalto:'Cobalto', quasar:'Quasar', senda:'Senda', orbita:'Órbita',
}
function comparisonKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase().trim()
}

const DB_NAME = 'phoenix-living-team-profiles-v1'
const STORE = 'members'
const EVENT = 'phoenix:living-team-profiles-changed'
const MAX_IMAGE = 8 * 1024 * 1024

function validKind(value: string): asserts value is LivingTeamKind {
  if (!(LIVING_TEAM_KINDS as readonly string[]).includes(value)) throw new Error('Perfil del equipo desconocido.')
}
export function normalizeTeamName(value: string): string {
  const name = value.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (name.length < 2 || name.length > 48 || !/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(name)) {
    throw new Error('Usa un nombre de 2 a 48 caracteres, sin etiquetas ni símbolos de código.')
  }
  return name
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('El almacenamiento privado de perfiles no está disponible.')); return }
    const open = indexedDB.open(DB_NAME, 1)
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE) }
    open.onerror = () => { reject(open.error ?? new Error('No se pudieron abrir los perfiles del equipo.')) }
    open.onblocked = () => { reject(new Error('El almacenamiento está bloqueado por otra ventana.')) }
    open.onsuccess = () => { resolve(open.result) }
  })
}
function resultOf<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('La lectura del perfil falló.')) }
  })
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { resolve() }
    tx.onerror = () => { reject(tx.error ?? new Error('No se pudo guardar el perfil.')) }
    tx.onabort = () => { reject(tx.error ?? new Error('Se canceló la escritura del perfil.')) }
  })
}
function notify(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}
/** Current names, keyed by immutable team slot. Names never become runtime ids. */
export async function readTeamNames(): Promise<TeamDisplayNames> {
  const db = await openDatabase()
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const pairs = await Promise.all(LIVING_TEAM_KINDS.map(async kind => {
      const value = await resultOf(store.get(kind + ':name'))
      return [kind, typeof value === 'string' ? value : undefined] as const
    }))
    return Object.fromEntries(pairs.filter((pair): pair is readonly [LivingTeamKind, string] => pair[1] !== undefined))
  } finally { db.close() }
}
/** Save one or all names in a single transaction after strict validation. */
export async function saveTeamNames(changes: TeamDisplayNames): Promise<void> {
  const pairs = Object.entries(changes).map(([id, raw]) => {
    validKind(id)
    if (typeof raw !== 'string') throw new Error('Nombre del equipo inválido.')
    return [id, normalizeTeamName(raw)] as const
  })
  if (pairs.length === 0) return
  const previous = await readTeamNames()
  const merged: TeamDisplayNames = { ...previous, ...Object.fromEntries(pairs) }
  const labels = new Set<string>()
  for (const kind of LIVING_TEAM_KINDS) {
    const normalized = comparisonKey(merged[kind] ?? DEFAULT_TEAM_NAMES[kind])
    if (labels.has(normalized)) throw new Error('Dos integrantes no pueden compartir el mismo nombre visible.')
    labels.add(normalized)
  }
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [kind, name] of pairs) store.put(name, kind + ':name')
    await complete(tx)
  } finally { db.close() }
  notify()
}
/** Reset a customized name to its public default, without touching the avatar. */
export async function resetTeamName(kind: LivingTeamKind): Promise<void> {
  validKind(kind)
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(kind + ':name')
    await complete(tx)
  } finally { db.close() }
  notify()
}
export async function readTeamPortrait(kind: LivingTeamKind): Promise<Blob | undefined> {
  validKind(kind)
  const db = await openDatabase()
  try {
    const value: unknown = await resultOf(db.transaction(STORE, 'readonly').objectStore(STORE).get(kind + ':portrait'))
    return value instanceof Blob && value.type === 'image/webp' ? value : undefined
  } finally { db.close() }
}
export async function saveTeamPortrait(kind: LivingTeamKind, portrait: Blob): Promise<void> {
  validKind(kind)
  if (portrait.type !== 'image/webp' || portrait.size === 0 || portrait.size > MAX_IMAGE) throw new Error('Se necesita un retrato WebP validado.')
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(portrait, kind + ':portrait')
    await complete(tx)
  } finally { db.close() }
  notify()
}
export async function resetTeamPortrait(kind: LivingTeamKind): Promise<void> {
  validKind(kind)
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(kind + ':portrait')
    await complete(tx)
  } finally { db.close() }
  notify()
}
export function subscribeTeamProfiles(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, listener)
  window.addEventListener('focus', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('focus', listener)
  }
}
/** Strict raster decode, bounded square crop and metadata-stripped WebP. */
export async function normalizeTeamPortrait(image: Blob): Promise<Blob> {
  if (image.size === 0 || image.size > MAX_IMAGE ||
    !['image/jpeg','image/png','image/webp'].includes(image.type)) {
    throw new Error('Selecciona un JPG, PNG o WebP de máximo 8 MB.')
  }
  const header = new Uint8Array(await image.slice(0, 16).arrayBuffer())
  const valid = (header[0] === 255 && header[1] === 216 && header[2] === 255)
    || (header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71)
    || (header[0] === 82 && header[1] === 73 && header[2] === 70 && header[3] === 70
      && header[8] === 87 && header[9] === 69 && header[10] === 66 && header[11] === 80)
  if (!valid) throw new Error('El archivo no contiene una imagen raster válida.')
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width < 64 || bitmap.height < 64 || bitmap.width * bitmap.height > 40_000_000) {
      throw new Error('Las dimensiones de la imagen no son compatibles.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('El editor de imágenes no está disponible.')
    const side = Math.min(bitmap.width, bitmap.height)
    context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 512, 512)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob === null ? reject(new Error('No se pudo preparar el avatar.')) : resolve(blob), 'image/webp', .88)
    })
  } finally { bitmap.close() }
}
