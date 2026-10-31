/**
 * Explicitly opted-in profile-photo reference for unambiguous self-image requests.
 * Only the original picture is used. No image goes to ordinary conversation turns.
 * The reference is read from the same browser-local IndexedDB store as Profile.
 */
export function isSelfImageRequest(text: string): boolean {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  const image = '\\b(?:foto|imagen|retrato|selfie|fotografia|photo|picture|image|portrait|photograph)\\b'
  const identity = '\\b(?:mia|mio|conmigo|salga yo|aparezca yo|este yo|yo en|de mi (?:cara|rostro|persona)|of me|myself|my face)\\b'
  if (new RegExp(image + '.{0,110}' + identity, 'u').test(normalized)) return true
  if (new RegExp(identity + '.{0,70}' + image, 'u').test(normalized)) return true
  return /\b(?:ponme|colocame|dibujame|retratame|fotografiame)\s+(?:en|como|con|junto)\b/u.test(normalized)
    || /\b(?:put me in|draw me as|make me appear|generate me in)\b/u.test(normalized)
}

/** Read only when the user has deliberately enabled profile-reference sharing. */
export async function savedPhotoForSelfImageRequest(text: string): Promise<File | undefined> {
  if (!isSelfImageRequest(text) || typeof indexedDB === 'undefined') return undefined
  return new Promise<File | undefined>((resolve, reject) => {
    const open = indexedDB.open('phoenix-user-portrait-v1', 1)
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('portrait')) open.result.createObjectStore('portrait')
    }
    open.onerror = () => { reject(open.error ?? new Error('No se pudo consultar el perfil fotográfico')) }
    open.onblocked = () => { reject(new Error('El almacén fotográfico está bloqueado')) }
    open.onsuccess = () => {
      const database = open.result
      const tx = database.transaction('portrait', 'readonly')
      const store = tx.objectStore('portrait')
      const permission = store.get('referenceEnabled')
      const original = store.get('original')
      tx.oncomplete = () => {
        database.close()
        if (permission.result !== true) { resolve(undefined); return }
        if (!(original.result instanceof Blob) || original.result.type !== 'image/webp') {
          reject(new Error('La fotografía de referencia ya no está disponible. Vuelve a guardarla en Perfil.'))
          return
        }
        resolve(new File([original.result], 'referencia-original-del-usuario.webp', { type: 'image/webp' }))
      }
      tx.onerror = () => { database.close(); reject(tx.error ?? new Error('No se pudo consultar la foto privada')) }
      tx.onabort = () => { database.close(); reject(tx.error ?? new Error('Consulta fotográfica interrumpida')) }
    }
  })
}
