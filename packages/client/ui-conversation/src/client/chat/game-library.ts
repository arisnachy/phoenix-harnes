/** Local Game Studio shelf. Stores self-contained games in IndexedDB, not in a fragile URL or localStorage quota. */
export interface LibraryGame {
  readonly id: string
  readonly title: string
  readonly html: string
  readonly updatedAt: number
}

const DB_NAME = 'phoenix-game-studio-library'
const STORE = 'games'

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('La biblioteca requiere almacenamiento local del navegador.'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    request.onerror = () => { reject(request.error ?? new Error('No se pudo abrir la biblioteca.')) }
    request.onsuccess = () => { resolve(request.result) }
    request.onblocked = () => { reject(new Error('La biblioteca está bloqueada por otra ventana.')) }
  })
}

function transact<T>(mode: IDBTransactionMode, createRequest: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    let result!: T
    let transaction: IDBTransaction
    try {
      transaction = db.transaction(STORE, mode)
      const request = createRequest(transaction.objectStore(STORE))
      request.onsuccess = () => { result = request.result }
      transaction.oncomplete = () => { db.close(); resolve(result) }
      transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('No se pudo guardar el juego.')) }
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('La operación fue cancelada.')) }
    } catch (error) {
      db.close()
      reject(error)
    }
  }))
}

export function libraryGameId(title: string): string {
  return title.trim().normalize('NFKC').toLocaleLowerCase()
}

export async function saveLibraryGame(title: string, html: string): Promise<void> {
  const game: LibraryGame = { id: libraryGameId(title), title, html, updatedAt: Date.now() }
  await transact('readwrite', store => store.put(game))
}

export async function listLibraryGames(): Promise<LibraryGame[]> {
  const games = await transact('readonly', store => store.getAll()) as LibraryGame[]
  return games.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function removeLibraryGame(id: string): Promise<void> {
  await transact('readwrite', store => store.delete(id))
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;')
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
}

/**
 * Open a game through an unprivileged sandboxed iframe inside its own window.
 * Never open untrusted game HTML directly as a blob document with Phoenix's origin.
 */
export function openGameInWindow(title: string, sandboxedHtml: string): void {
  const wrapper = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtmlText(title)}</title><style>html,body{margin:0;width:100%;height:100%;background:#101018}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe title="${escapeHtmlAttribute(title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escapeHtmlAttribute(sandboxedHtml)}"></iframe></body></html>`
  const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }))
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.click()
  // Give the browser time to load the document before releasing its object URL.
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 120_000)
}
