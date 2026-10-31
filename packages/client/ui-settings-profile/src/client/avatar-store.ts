/** Private, browser-local user portrait storage. Never sent to model prompts. */
export type AvatarMode = 'original' | 'styled'
export interface AvatarSnapshot {
  original?: Blob
  styled?: Blob
  mode: AvatarMode
  /** Explicit permission to attach the original photo to self-image requests. */
  referenceEnabled: boolean
}
const DATABASE = 'phoenix-user-portrait-v1'
const EVENT = 'phoenix-user-portrait-changed'
const MAX_UPLOAD = 8 * 1024 * 1024
const MAX_RASTER = 15 * 1024 * 1024
function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Private image storage is unavailable in this browser')); return }
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('portrait') }
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(request.error ?? new Error('Portrait database could not open')) }
    request.onblocked = () => { reject(new Error('Portrait database is blocked by another session')) }
  })
}
function get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => { resolve(request.result as T | undefined) }
    request.onerror = () => { reject(request.error ?? new Error('Portrait read failed')) }
  })
}
function finish(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { resolve() }
    tx.onerror = () => { reject(tx.error ?? new Error('Portrait write failed')) }
    tx.onabort = () => { reject(tx.error ?? new Error('Portrait update aborted')) }
  })
}
/** Read persisted portrait variants without retaining a database connection. */
export async function readAvatar(): Promise<AvatarSnapshot> {
  const database = await db()
  try {
    const tx = database.transaction('portrait', 'readonly')
    const store = tx.objectStore('portrait')
    const [original, styled, active, referenceEnabled] = await Promise.all([
      get<Blob>(store, 'original'), get<Blob>(store, 'styled'), get<AvatarMode>(store, 'mode'),
      get<boolean>(store, 'referenceEnabled'),
    ])
    return {
      ...(original instanceof Blob ? { original } : {}),
      ...(styled instanceof Blob ? { styled } : {}),
      mode: active === 'styled' && styled instanceof Blob ? 'styled' : 'original',
      referenceEnabled: referenceEnabled === true && original instanceof Blob,
    }
  } finally { database.close() }
}
async function write(values: {
  original?: Blob
  styled?: Blob
  mode?: AvatarMode
  referenceEnabled?: boolean
  clear?: boolean
}): Promise<void> {
  const database = await db()
  try {
    const tx = database.transaction('portrait', 'readwrite')
    const store = tx.objectStore('portrait')
    if (values.clear) store.clear()
    if (values.original !== undefined) {
      store.put(values.original, 'original')
      store.delete('styled')
      store.put('original', 'mode')
      // A replacement is a different face: require renewed sharing consent.
      store.put(false, 'referenceEnabled')
    }
    if (values.styled !== undefined) {
      store.put(values.styled, 'styled')
      store.put('styled', 'mode')
    }
    if (values.mode !== undefined) store.put(values.mode, 'mode')
    if (values.referenceEnabled !== undefined) store.put(values.referenceEnabled, 'referenceEnabled')
    await finish(tx)
    announce()
  } finally { database.close() }
}
/** This keeps the original normalized but separate from any edited variant. */
export async function storeOriginalAvatar(image: Blob): Promise<void> { await write({ original: image }) }
/** Preserve a successful AI output as a new variant, never overwrite the source photo. */
export async function storeStyledAvatar(image: Blob): Promise<void> { await write({ styled: image }) }
export async function activateAvatar(mode: AvatarMode): Promise<void> {
  const snapshot = await readAvatar()
  if (mode === 'styled' && snapshot.styled === undefined) throw new Error('No edited portrait was saved')
  if (snapshot.original === undefined) throw new Error('No portrait was saved')
  await write({ mode })
}
/** The permission is stored alongside the private photo and cleared with it. */
export async function setAvatarReferenceEnabled(enabled: boolean): Promise<void> {
  const snapshot = await readAvatar()
  if (enabled && snapshot.original === undefined) throw new Error('Guarda una fotografía antes de activar la referencia.')
  await write({ referenceEnabled: enabled })
}
export async function deleteAvatar(): Promise<void> { await write({ clear: true }) }
export function subscribeAvatar(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, listener)
  window.addEventListener('focus', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('focus', listener)
  }
}
function hasRasterSignature(b: Uint8Array): boolean {
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    || (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10)
    || (b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70
      && b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80)
}
/** Reject non-raster uploads, then decode, strip metadata and make a square 768px portrait. */
export async function normalizeAvatar(image: Blob, zoom = 1, offsetX = 0, offsetY = 0): Promise<Blob> {
  if (image.size === 0 || image.size > MAX_UPLOAD) throw new Error('Select an image under 8 MB')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type)) {
    throw new Error('Only PNG, JPEG and WebP photos are accepted')
  }
  const bytes = new Uint8Array(await image.slice(0, 16).arrayBuffer())
  if (!hasRasterSignature(bytes)) throw new Error('Invalid or unsupported image content')
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
  try {
    if (bitmap.width === 0 || bitmap.height === 0
      || bitmap.width * bitmap.height > 40_000_000) throw new Error('Image dimensions exceed the safe limit')
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 768
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('Image canvas is not available')
    const factor = Math.min(3, Math.max(1, zoom))
    const side = Math.min(bitmap.width, bitmap.height) / factor
    const x = Math.max(0, Math.min(bitmap.width - side, (bitmap.width - side) * (offsetX + 1) / 2))
    const y = Math.max(0, Math.min(bitmap.height - side, (bitmap.height - side) * (offsetY + 1) / 2))
    ctx.drawImage(bitmap, x, y, side, side, 0, 0, 768, 768)
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => { if (blob === null) reject(new Error('Image conversion failed')); else resolve(blob) }, 'image/webp', 0.9)
    })
    if (output.size > MAX_RASTER) throw new Error('Normalized portrait exceeds size limits')
    return output
  } finally { bitmap.close() }
}
export function validatedLocalEditor(value: string): string {
  const url = new URL(value.trim())
  if (url.username || url.password || url.search || url.hash
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.protocol !== 'http:') {
    throw new Error('Use an HTTP image editor on localhost only. Remote photo uploads are disabled.')
  }
  const path = url.pathname.replace(/\/+$/u, '')
  if (path !== '' && path !== '/v1' && path !== '/v1/images/edits') {
    throw new Error('La dirección del editor debe terminar en /v1 o /v1/images/edits.')
  }
  return url.origin + '/v1'
}
/** Check that a configured local editor responds before sending any photo. */
export async function probeLocalAvatarEditor(endpoint: string): Promise<void> {
  const base = validatedLocalEditor(endpoint)
  try {
    const response = await fetch(base + '/models', { method: 'GET', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('El servicio respondió HTTP ' + String(response.status))
  } catch (cause) {
    throw new Error('No fue posible contactar al editor local. Comprueba que esté iniciado y permita conexiones desde PHOENIX. ' + (cause instanceof Error ? cause.message : ''))
  }
}
/** Actual image-to-image operation, never text-to-image substitution.
 * Requires an explicitly configured local OpenAI-compatible /images/edits service.
 */
export async function editAvatarLocally(original: Blob, endpoint: string, model = 'local-image-edit'): Promise<Blob> {
  if (!/^[a-zA-Z0-9._/-]{1,120}$/u.test(model)) throw new Error('Invalid local image editing model name')
  const base = validatedLocalEditor(endpoint)
  const form = new FormData()
  form.append('image', original, 'portrait.webp')
  form.append('model', model)
  form.append('size', '1024x1024')
  form.append('response_format', 'b64_json')
  form.append('prompt',
    'Edit THIS uploaded person into a premium semi-realistic PHOENIX portrait, with warm amber lighting, subtle cinematic depth and elegant editorial styling aligned to the Kira team. Preserve the exact person, recognizable facial features, age, skin tone, expression and natural human identity. No agent name, badge, icons or text.')
  const response = await fetch(base + '/images/edits', { method: 'POST', body: form })
  if (!response.ok) throw new Error('Local image editor failed (HTTP ' + String(response.status) + ')')
  const json: unknown = await response.json()
  const payload: unknown = typeof json === 'object' && json !== null && 'data' in json ? json.data : undefined
  const first: unknown = Array.isArray(payload) ? payload[0] : undefined
  if (typeof first !== 'object' || first === null || !('b64_json' in first)
    || typeof first.b64_json !== 'string') throw new Error('Local editor did not return an edited image')
  const encoded = first.b64_json
  if (encoded.length > MAX_RASTER * 1.5) throw new Error('Edited image exceeds the size limit')
  const decoded = atob(encoded)
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0))
  if (!hasRasterSignature(bytes)) throw new Error('Local editor returned invalid image data')
  const mime = bytes[0] === 137 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : 'image/webp'
  return normalizeAvatar(new Blob([bytes], { type: mime }))
}
