/**
 * Explicitly opted-in profile-photo reference for unambiguous self-image requests.
 * Only the original picture is used. No image goes to ordinary conversation turns.
 * The reference is read from the same browser-local IndexedDB store as Profile.
 */
export function isSelfImageRequest(text: string): boolean {
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
  // The user must ask for a created/edited image. Mere mention of their face is not consent.
  const action = /\b(?:crea|crear|creame|genera|generar|generame|dame|muestrame|pon|ponme|mandame|haz|hazme|dibuja|dibujame|edita|editame|transforma|transformame|ponme|colocame|retratame|fotografiame|quiero|quisiera|gustaria|create|generate|make|draw|edit|transform|put me|i want|i would like)\b/u
  if (!action.test(normalized)) return false
  // Reject queries ABOUT generating photos; those should not load private images.
  if (/\b(?:como|por que|explica|explicame|tutorial|guia|how to|what is|can you explain)\b/u.test(normalized)) return false
  const image = /\b(?:foto|imagen|retrato|selfie|fotografia|photo|picture|image|portrait|photograph)\b/u
  const identity = /\b(?:mia|mio|conmigo|salga yo|aparezca yo|este yo|yo en|de mi (?:cara|rostro|persona)|of me|myself|my face)\b/u
  if (image.test(normalized) && identity.test(normalized)) return true
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
