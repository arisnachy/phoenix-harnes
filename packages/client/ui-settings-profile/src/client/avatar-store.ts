/** Browser-private avatar binaries: never placed in model context or settings JSON. */
export type AvatarMode = 'original' | 'portrait'
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
    request.onerror = () => { reject(request.error) }
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
    transaction.onabort = () => { database.close(); reject(transaction.error) }
  }))
}

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

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

export async function selectAvatar(mode: AvatarMode): Promise<void> {
  const state = await loadAvatar()
  if (mode === 'portrait' && state.portrait === undefined) throw new Error('Todavía no existe un retrato transformado.')
  if (state.original === undefined) throw new Error('Primero debes subir una fotografía.')
  await mutate(store => { store.put(mode, 'mode') })
}

export async function clearAvatar(): Promise<void> {
  await mutate(store => { store.clear() })
}

/** Strict file-signature check; rejecting SVG and mismatched extension/MIME is intentional. */
export function avatarMimeFromBytes(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return undefined
}

export async function prepareAvatar(file: File, zoom: number, x: number, y: number): Promise<Blob> {
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error('La foto debe tener menos de 8 MB.')
  const magic = avatarMimeFromBytes(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  if (magic === undefined || magic !== file.type) throw new Error('Usa una foto JPG, PNG o WebP auténtica.')
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('No se pudo preparar la imagen.')
    const side = Math.min(image.width, image.height) / Math.max(1, Math.min(3, zoom))
    ctx.drawImage(image, (image.width - side) * x / 100, (image.height - side) * y / 100,
      side, side, 0, 0, 512, 512)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => { if (blob === null) reject(new Error('No se pudo codificar la foto.')); else resolve(blob) },
        'image/jpeg', 0.91)
    })
  } finally {
    image.close()
  }
}

/** Never forward user photos to any server without an explicit edit action. */
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

/**
 * Actual image-to-image edit against an explicitly configured local OpenAI-compatible
 * /images/edits endpoint. No fallback to text-to-image or fabricated filters.
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

/** Own and revoke the current object URL; no permanent base64 string in localStorage. */
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
