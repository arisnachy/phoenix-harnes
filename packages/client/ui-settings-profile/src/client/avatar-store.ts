/** Browser-private avatar binaries: never placed in model context or settings JSON. */
export type AvatarMode = 'original' | 'portrait'
/** Stored photo, optional independently generated variant, and selected display mode. */
export interface AvatarState {
  readonly original?: Blob
  readonly portrait?: Blob
  readonly mode: AvatarMode
}
const DB_NAME = 'phoenix-user-avatar-v1'
const CHANGED = 'phoenix:user-avatar-changed'
const MAX_BYTES = 8 * 1024 * 1024
const STYLE_PROMPT = [
  'Edit the PROVIDED PHOTO of this real human. Preserve facial identity, age,',
  'features, hair, expression and proportions. Make a premium semirealistic',
  'PHOENIX team portrait: elegant warm amber lighting, refined cinematic',
  'illustration, restrained copper accents, clean light backdrop, realistic skin.',
  'No fantasy character, no role badges, no text, no other people.',
].join(' ')

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no permite almacenar fotos locales (IndexedDB).'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets')
    }
    request.onerror = () => { reject(request.error ?? new Error('No se pudo abrir el almacén de fotos.')) }
    request.onsuccess = () => { resolve(request.result) }
  })
}

async function read<T>(key: string): Promise<T | undefined> {
  const database = await db()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('assets', 'readonly')
    const request = transaction.objectStore('assets').get(key)
    request.onsuccess = () => { resolve(request.result as T | undefined) }
    request.onerror = () => { reject(request.error ?? new Error('No se pudo leer la foto local.')) }
    transaction.oncomplete = () => { database.close() }
    transaction.onerror = () => { database.close() }
  })
}

function mutate(callback: (store: IDBObjectStore) => void): Promise<void> {
  return db().then(database => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('assets', 'readwrite')
    callback(transaction.objectStore('assets'))
    transaction.oncomplete = () => { database.close(); announce(); resolve() }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('No se pudo guardar la foto.'))
    }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('No se pudo guardar la foto local.')) }
  }))
}

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

/** Load the local picture variants without touching the model context.
 * @returns Current stored photo, optional portrait, and selected mode.
 */
export async function loadAvatar(): Promise<AvatarState> {
  const [original, portrait, selected] = await Promise.all([
    read<Blob>('original'), read<Blob>('portrait'), read<AvatarMode>('mode'),
  ])
  return {
    ...(original instanceof Blob ? { original } : {}),
    ...(portrait instanceof Blob ? { portrait } : {}),
    mode: selected === 'portrait' && portrait instanceof Blob ? 'portrait' : 'original',
  }
}

/** Persist a verified raster in the browser's private binary storage.
 * @param mode - Original photo or independently generated portrait.
 * @param blob - Validated raster file without untrusted metadata.
 * @returns Settlement after the binary is committed.
 */
export async function saveAvatar(mode: AvatarMode, blob: Blob): Promise<void> {
  if (!avatarMimeFromBytes(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
    || blob.size === 0 || blob.size > MAX_BYTES) {
    throw new Error('La imagen procesada no tiene un formato válido.')
  }
  await mutate((store) => {
    store.put(blob, mode)
    store.put(mode, 'mode')
    if (mode === 'original') store.delete('portrait')
  })
}

/** Switch the visible variant without overwriting the original.
 * @param mode - Variant to display.
 * @returns Settlement after the selection is persisted.
 */
export async function selectAvatar(mode: AvatarMode): Promise<void> {
  const state = await loadAvatar()
  if (mode === 'portrait' && state.portrait === undefined) throw new Error('Todavía no existe un retrato transformado.')
  if (state.original === undefined) throw new Error('Primero debes subir una fotografía.')
  await mutate((store) => { store.put(mode, 'mode') })
}

/** Remove both images and their active selection.
 * @returns Settlement after all avatar records are deleted.
 */
export async function clearAvatar(): Promise<void> {
  await mutate((store) => { store.clear() })
}

/** Strict file-signature check; SVG and spoofed media are never accepted.
 * @param bytes - First sixteen bytes of a candidate raster.
 * @returns Verified raster MIME type, or undefined for unsupported content.
 */
export function avatarMimeFromBytes(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

/** Crop, orient and re-encode a user photo, stripping EXIF and external metadata.
 * @param file - User-supplied image file.
 * @param zoom - Magnification factor between 1 and 3.
 * @param x - Relative horizontal crop position from 0 to 100.
 * @param y - Relative vertical crop position from 0 to 100.
 * @returns Verified normalized square JPEG blob.
 */
export async function prepareAvatar(file: File, zoom: number, x: number, y: number): Promise<Blob> {
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error('La foto debe tener menos de 8 MB.')
  const magic = avatarMimeFromBytes(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  if (magic === undefined || magic !== file.type) throw new Error('Usa una foto JPG, PNG o WebP auténtica.')
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    if (image.width > 8192 || image.height > 8192 || image.width === 0 || image.height === 0) {
      throw new Error('La resolución de la foto no es compatible (máximo 8192 píxeles por lado).')
    }
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('No se pudo preparar la imagen.')
    const side = Math.min(image.width, image.height) / Math.max(1, Math.min(3, zoom))
    ctx.drawImage(image, (image.width - side) * x / 100, (image.height - side) * y / 100,
      side, side, 0, 0, 512, 512)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => { if (blob === null) reject(new Error('No se pudo codificar la foto.')); else resolve(blob) },
        'image/jpeg', 0.91)
    })
  } finally {
    image.close()
  }
}

/** Never forward user photos to any server without an explicit edit action. */
/** Guard the optional image editor against off-device photo disclosure.
 * @param raw - User-entered local OpenAI-compatible editor base URL.
 * @returns Validated HTTP loopback URL with no trailing slash.
 */
export function localEditorEndpoint(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Indica una dirección válida del editor local.') }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.protocol !== 'http:' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    throw new Error('Solo se permiten editores locales HTTP en localhost o 127.0.0.1.')
  }
  return url.toString().replace(/\/+$/u, '')
}

/** Actual image-to-image edit with an explicitly configured local editing server.
 * No fallback to text-to-image or fabricated filters.
 * @param original - Sanitized and cropped human photo.
 * @param rawBaseUrl - Local-only configured service base URL.
 * @param model - Real image-edit model supported by the service.
 * @returns Generated raster as an independent blob.
 */
export async function editAvatarWithLocalAI(
  original: Blob, rawBaseUrl: string, model: string,
): Promise<Blob> {
  const endpoint = localEditorEndpoint(rawBaseUrl)
  if (model.trim().length === 0) throw new Error('Indica el modelo de edición del proveedor local.')
  const form = new FormData()
  form.append('image', original, 'phoenix-user-photo.jpg')
  form.append('prompt', STYLE_PROMPT)
  form.append('model', model.trim())
  form.append('response_format', 'b64_json')
  const response = await fetch(`${endpoint}/images/edits`, {
    method: 'POST', mode: 'cors', credentials: 'omit',
    referrerPolicy: 'no-referrer', body: form,
  })
  if (!response.ok) throw new Error(`El editor local respondió HTTP ${response.status}.`)
  const payload = await response.json() as { data?: Array<{ b64_json?: string }> }
  const encoded = payload.data?.[0]?.b64_json
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_BYTES * 2) {
    throw new Error('El editor no devolvió una imagen editada válida.')
  }
  const decoded = atob(encoded)
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0))
  const mime = avatarMimeFromBytes(bytes)
  if (mime === undefined || bytes.length > MAX_BYTES) throw new Error('Formato de imagen editada no válido.')
  return new Blob([bytes], { type: mime })
}

/** Own and revoke the visible object URL; no long-lived base64 in localStorage.
 * @returns Cleanup for the browser appearance event listener and object URL.
 */
export function mountAvatarAppearance(): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {}
  let current: string | undefined
  let revision = 0
  const hydrate = () => {
    const ticket = ++revision
    void loadAvatar().then((state) => {
      if (revision !== ticket) return
      const image = state.mode === 'portrait' ? state.portrait : state.original
      const next = image === undefined ? undefined : URL.createObjectURL(image)
      if (current !== undefined) URL.revokeObjectURL(current)
      current = next
      if (next === undefined) {
        delete document.documentElement.dataset.phoenixUserAvatar
        document.documentElement.style.removeProperty('--phoenix-user-avatar-image')
      } else {
        document.documentElement.dataset.phoenixUserAvatar = 'ready'
        document.documentElement.style.setProperty('--phoenix-user-avatar-image', `url("${next}")`)
      }
    }).catch(() => { /* Storage can be unavailable in private browsing. */ })
  }
  window.addEventListener(CHANGED, hydrate)
  hydrate()
  return () => {
    revision += 1
    window.removeEventListener(CHANGED, hydrate)
    if (current !== undefined) URL.revokeObjectURL(current)
    document.documentElement.style.removeProperty('--phoenix-user-avatar-image')
    delete document.documentElement.dataset.phoenixUserAvatar
  }
}
