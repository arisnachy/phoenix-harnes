/**
 * A real Chromium viewport inside the conversation, fed by the same local CDP
 * tab Kira controls. No website iframe, hidden scripts, fake screenshots or
 * model-generated browser states. Fullscreen is a larger view of SAME tab.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { Modal, PhoenixLogo } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './MiniBrowser.module.css'

type Tab = { id: string; title: string; url: string }
type Snapshot = { available: boolean; tabId?: string; url?: string; title?: string; tabs: Tab[] }
type Command = {
  type: string
  url?: string
  tabId?: string
  sessionId?: string
  x?: number
  y?: number
  deltaY?: number
  key?: string
  text?: string
  modifiers?: number
}
type QueuedAction = { request: Command; resolve: () => void }
const API = '/phoenix-mini-browser'
const HEADERS = { 'x-phoenix-mini-browser': '1' }
const BLANK: Snapshot = { available: false, tabs: [] }
const STATE_DEADLINE_MS = 4_000
const ACTION_DEADLINE_MS = 25_000
const START_DEADLINE_MS = 25_000
const FRAME_DEADLINE_MS = 2_500
const STATE_DEADLINE_MESSAGE = 'El navegador tardó demasiado en responder. Phoenix reintentará la conexión.'
const ACTION_DEADLINE_MESSAGE = 'La acción del navegador tardó demasiado en responder. Phoenix reintentará la conexión.'
const START_DEADLINE_MESSAGE = 'Chrome tardó demasiado en iniciar. Phoenix mantiene la tarjeta para que puedas reintentar manualmente.'
const FRAME_DEADLINE_MESSAGE = 'La imagen de la página tardó demasiado en llegar. Phoenix reintentará la captura.'

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Solicitud cancelada.', 'AbortError')
}

function requestIsActive(signal: AbortSignal, mountedRef: { current: boolean }): boolean {
  return !signal.aborted && mountedRef.current
}

function route(path: string, sessionId: string, tabId?: string): string {
  return API + path + '?sessionId=' + encodeURIComponent(sessionId)
    + (tabId === undefined ? '' : '&tabId=' + encodeURIComponent(tabId))
}

/** Run a browser request with one deadline covering headers and response body. */
async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number,
  timeoutMessage: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw abortError(signal)
  const controller = new AbortController()
  let timer: ReturnType<typeof window.setTimeout> | undefined
  let relay: (() => void) | undefined
  const task = operation(controller.signal)
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      controller.abort(new Error(timeoutMessage))
      reject(new Error(timeoutMessage))
    }, timeoutMs)
  })
  const cancelled = signal === undefined ? undefined : new Promise<never>((_, reject) => {
    relay = () => {
      const reason = abortError(signal)
      controller.abort(reason)
      reject(reason)
    }
    signal.addEventListener('abort', relay, { once: true })
  })
  try {
    return await Promise.race(cancelled === undefined ? [task, timeout] : [task, timeout, cancelled])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
    if (relay !== undefined) signal?.removeEventListener('abort', relay)
    controller.abort()
  }
}

async function decode<T>(response: Response): Promise<T> {
  // Host restarts, interrupted connections and 204 responses may carry no JSON.
  // Never let Response.json() expose a raw SyntaxError to the MiniBrowser UI.
  const body = await response.text()
  const fallback = response.ok
    ? 'El navegador devolvió una respuesta vacía. Phoenix reintentará la conexión.'
    : `El servidor del navegador no está disponible (HTTP ${response.status}). Phoenix reintentará la conexión.`
  if (!body.trim()) throw new Error(fallback)
  let data: unknown
  try {
    data = JSON.parse(body) as unknown
  } catch {
    throw new Error(`Respuesta incompleta del navegador (HTTP ${response.status}). Phoenix reintentará la conexión.`)
  }
  if (!response.ok) {
    const message = data !== null && typeof data === 'object' && 'error' in data
      && typeof data.error === 'string' ? data.error : fallback
    throw new Error(message)
  }
  return data as T
}
function validSnapshot(value: unknown): value is Snapshot {
  if (value === null || typeof value !== 'object') return false
  const x = value as Partial<Snapshot>
  return typeof x.available === 'boolean' && Array.isArray(x.tabs)
}
async function inspect(sessionId: string, signal?: AbortSignal, tabId?: string): Promise<Snapshot> {
  const data = await withDeadline(
    async (requestSignal) => {
      const response = await fetch(route('/state', sessionId, tabId), { headers: HEADERS, signal: requestSignal, cache: 'no-store' })
      return decode<unknown>(response)
    }, STATE_DEADLINE_MS, STATE_DEADLINE_MESSAGE, signal)
  if (!validSnapshot(data)) throw new Error('Estado de Chromium no válido.')
  return data
}
async function command(input: Command, signal?: AbortSignal): Promise<Snapshot> {
  const start = input.type === 'start'
  const data = await withDeadline(
    async (requestSignal) => {
      const response = await fetch(API + '/action', {
        method: 'POST', headers: { ...HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify(input), signal: requestSignal, cache: 'no-store',
      })
      return decode<unknown>(response)
    }, start ? START_DEADLINE_MS : ACTION_DEADLINE_MS,
    start ? START_DEADLINE_MESSAGE : ACTION_DEADLINE_MESSAGE, signal)
  if (!validSnapshot(data)) throw new Error('Respuesta de Chromium no válida.')
  return data
}
async function captureFrame(tabId: string, sessionId: string, signal?: AbortSignal): Promise<Blob> {
  return withDeadline(async (requestSignal) => {
    const response = await fetch(route('/frame', sessionId, tabId), { headers: HEADERS, signal: requestSignal, cache: 'no-store' })
    if (!response.ok) throw new Error('La imagen de la página no está disponible.')
    return response.blob()
  }, FRAME_DEADLINE_MS, FRAME_DEADLINE_MESSAGE, signal)
}
export type SecureLoginProfile = 'personal' | 'kira'
export type SecureProfileInfo = {
  id: SecureLoginProfile; saved: boolean; automatic: boolean
  source: 'dpapi' | 'legacy-vault' | 'none'
}
export type SecureStatus = {
  saved: boolean; automatic: boolean
  profile?: SecureLoginProfile; profiles?: SecureProfileInfo[]
}
export type SecureLoginField = {
  key: string
  role: 'account' | 'secret' | 'extra'
  label: string
  placeholder: string
  inputType: 'text' | 'email' | 'tel' | 'password' | 'number'
  required: boolean
}
export type SecureLoginTarget = {
  origin: string; tabId: string; saved: boolean; automatic: boolean
  diagnostic?: string; fields?: SecureLoginField[]
  /** True only when a human deliberately opens the secure login controls. */
  explicit?: boolean
  profile?: SecureLoginProfile; profiles?: SecureProfileInfo[]
}
type SecureDetection = {
  required: boolean; formVisible?: boolean; gateVisible?: boolean
  canOpenInPlace?: boolean; warningVisible?: boolean; fields?: SecureLoginField[]
}
type SecureUse = { status: string }
/** Safe human-facing status: no account names, passwords or vault values. */
export type SavedAccessNotice = {
  origin: string
  phase: 'available' | 'using' | 'needs-attention' | 'vault-unavailable'
}
function secureOrigin(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return url.origin
  } catch { /* Pending navigation. */ }
  return undefined
}
export async function secureApi<T>(path: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch('/phoenix-secure-login' + path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'x-phoenix-secure-login': '1', ...payload === undefined ? {} : { 'content-type': 'application/json' } },
    ...payload === undefined ? {} : { body: JSON.stringify(payload) },
    cache: 'no-store',
  })
  return await decode<T>(response)
}

/** Translate an image gesture into Chromium's fixed 1280 × 720 viewport. */
function point(element: HTMLImageElement, clientX: number, clientY: number) {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const scale = Math.min(rect.width / 1280, rect.height / 720)
  const shownWidth = scale * 1280
  const shownHeight = scale * 720
  const x = (clientX - rect.left - (rect.width - shownWidth) / 2) / scale
  const y = (clientY - rect.top - (rect.height - shownHeight) / 2) / scale
  if (x < 0 || y < 0 || x > 1280 || y > 720) return null
  return { x, y }
}
/** Only official YouTube watch URLs qualify for the native video/audio player. */
function youtubeId(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)
      || url.protocol !== 'https:' || url.pathname !== '/watch') return undefined
    const id = url.searchParams.get('v')
    return id !== null && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : undefined
  } catch { return undefined }
}
/** Human navigation stays in the user-controlled MiniBrowser, never in the model's context. */
export function MiniBrowser({ sessionId, requested = false, active = true, initialTabId, onActivate, autoScroll = true, onPageChange, onSecureLoginRequest, onSavedAccessNotice }: {
  sessionId: string
  requested?: boolean
  active?: boolean
  /** Bind this card to a child Chromium call's target when one was recorded. */
  initialTabId?: string
  onActivate?: () => void
  autoScroll?: boolean
  onPageChange?: (page: { title: string; url: string } | null) => void
  onSecureLoginRequest?: (request: SecureLoginTarget | null) => void
  onSavedAccessNotice?: (notice: SavedAccessNotice | null) => void
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(BLANK)
  const [enabled, setEnabled] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [address, setAddress] = useState('')
  const [typed, setTyped] = useState('')
  const attemptedLogins = useRef(new Set<string>())
  const pendingAutomaticLogin = useRef(new Map<string, number>())
  const openedLoginGates = useRef(new Set<string>())
  const [playingVideo, setPlayingVideo] = useState(false)
  const [videoSurface, setVideoSurface] = useState(true)
  const [frame, setFrame] = useState<string>()
  const [error, setError] = useState<string>()
  const [connectionError, setConnectionError] = useState<string>()
  const [captureError, setCaptureError] = useState<string>()
  const [mediaCaptureState, setMediaCaptureState] = useState<'idle' | 'recording' | 'uploading' | 'ready'>('idle')
  const [mediaCaptureMessage, setMediaCaptureMessage] = useState<string>()
  const stopMediaCapture = useRef<(() => void) | undefined>(undefined)
  const focusRef = useRef<HTMLImageElement>(null)
  const inlineRef = useRef<HTMLDivElement>(null)
  const currentTab = useRef<string | undefined>(undefined)
  const lastObservedUrl = useRef<string | undefined>(undefined)
  const mounted = useRef(true)
  const frameRef = useRef<string | undefined>(undefined)
  const frameRequest = useRef<AbortController | undefined>(undefined)
  const frameRefreshPending = useRef(false)
  const refreshFrame = useRef<(() => void) | undefined>(undefined)
  const actionRequest = useRef<AbortController | undefined>(undefined)
  const actionQueue = useRef<QueuedAction[]>([])
  const actionQueueRunning = useRef(false)
  const initialTargetTabId = initialTabId?.trim() === '' ? undefined : initialTabId?.trim()
  const followGlobal = useRef(initialTargetTabId === undefined)
  const appliedInitialTarget = useRef(initialTargetTabId)
  // Each card is bound to the Chromium target it originally displayed.
  // New browser requests never overwrite prior cards with the latest page.
  const cardTabId = useRef<string | undefined>(initialTargetTabId)
  const previousActive = useRef(active)
  const hasPage = snapshot.available && snapshot.url !== undefined && /^https?:\/\//iu.test(snapshot.url)
  const show = !dismissed && (requested || enabled || hasPage)
  const videoId = youtubeId(snapshot.url)
  const siteOrigin = secureOrigin(snapshot.url)

  // Secure Ask is re-checked while a modal appears on the SAME URL.
  // Reactive websites often reveal the password form without navigation:
  // tying detection only to snapshot.url makes the sidebar never appear.
  useEffect(() => {
    if (!siteOrigin || !snapshot.tabId || !active || dismissed) {
      onSecureLoginRequest?.(null)
      onSavedAccessNotice?.(null)
      return
    }
    const tabId = snapshot.tabId
    const pageUrl = snapshot.url
    let stopped = false
    let checking = false
    const check = async (): Promise<void> => {
      if (checking || stopped) return
      checking = true
      try {
        // Vault presence is independent of Chrome's RPC health.
        const status = await secureApi<SecureStatus>('/status?origin=' + encodeURIComponent(siteOrigin))
          .catch(() => ({ saved: false, automatic: false, unavailable: true } as SecureStatus & { unavailable: true }))
        if (stopped) return
        const detection = await secureApi<SecureDetection>('/detect', { origin: siteOrigin, tabId })
          .catch(() => undefined)
        if (stopped) return
        const key = tabId + '|' + pageUrl
        if (detection?.required === false) {
          // The site now reports that its sign-in gate is gone. Do not
          // present an enrollment form while the login is already satisfied.
          attemptedLogins.current.delete(key)
          pendingAutomaticLogin.current.delete(key)
          openedLoginGates.current.delete(key)
          onSecureLoginRequest?.(null)
          onSavedAccessNotice?.(null)
          return
        }
        // A failed Vault lookup must not be interpreted as absent credentials.
        // Never show a blank enrollment form while saved access is unknown.
        if ('unavailable' in status && status.unavailable) {
          onSavedAccessNotice?.({ origin: siteOrigin, phase: 'vault-unavailable' })
          onSecureLoginRequest?.(null)
          return
        }
        if (!detection?.required) {
          if (status.saved) {
            onSavedAccessNotice?.({ origin: siteOrigin, phase: 'needs-attention' })
            onSecureLoginRequest?.({
              origin: siteOrigin, tabId, saved: true, automatic: status.automatic,
              ...(status.profile ? { profile: status.profile } : {}),
              ...(status.profiles ? { profiles: status.profiles } : {}),
              diagnostic: 'No fue posible comprobar el acceso. Usa el acceso guardado o reintenta la conexión.',
            })
          } else {
            onSavedAccessNotice?.(null)
          }
          return
        }
        onSavedAccessNotice?.(status.saved ? {
          origin: siteOrigin, phase: status.automatic ? 'using' : 'available',
        } : null)
        // With no stored access, first expose the real same-page form so
        // Secure Ask can use its labels, input types and required extra fields.
        // A login dialog is a navigation aid, not a transaction approval.
        if (!status.saved && detection.formVisible === false && detection.canOpenInPlace
          && !openedLoginGates.current.has(key)) {
          openedLoginGates.current.add(key)
          try {
            await secureApi<SecureDetection>('/open', { origin: siteOrigin, tabId })
            if (!stopped) onSecureLoginRequest?.(null)
            return
          } catch {
            // Keep the secure manual route available if Chrome cannot expose
            // the form; do not repeat the same failed click.
          }
        }
        const request: SecureLoginTarget = {
          origin: siteOrigin, tabId, saved: status.saved, automatic: status.automatic,
          ...(status.profile ? { profile: status.profile } : {}),
          ...(status.profiles ? { profiles: status.profiles } : {}),
          ...(detection.fields?.length ? { fields: detection.fields } : {}),
          ...('unavailable' in status && status.unavailable ? {
            diagnostic: 'La bóveda local no respondió. Revisa la conexión antes de guardar un acceso nuevo.',
          } : {}),
        }
        if (status.saved && status.automatic) {
          if (!attemptedLogins.current.has(key)) {
            attemptedLogins.current.add(key)
            pendingAutomaticLogin.current.set(key, Date.now())
            onSecureLoginRequest?.(null)
            try {
              const result = await secureApi<SecureUse>('/use', { origin: siteOrigin, tabId })
              if (stopped) return
              if (result.status === 'submitted') {
                refreshFrame.current?.()
                // A click is not proof of login. Wait for a later gate
                // inspection, without showing blank credential inputs.
                return
              }
              pendingAutomaticLogin.current.delete(key)
              onSavedAccessNotice?.({ origin: siteOrigin, phase: 'needs-attention' })
              onSecureLoginRequest?.({
                ...request, diagnostic: 'No se completó el inicio automático. Puedes reintentar el acceso guardado.',
              })
              return
            } catch {
              pendingAutomaticLogin.current.delete(key)
              onSavedAccessNotice?.({ origin: siteOrigin, phase: 'needs-attention' })
              onSecureLoginRequest?.({
                ...request, diagnostic: 'Falló la conexión de inicio automático. El acceso guardado sigue disponible.',
              })
              return
            }
          }
          const started = pendingAutomaticLogin.current.get(key)
          if (started !== undefined && Date.now() - started < 8_000) {
            onSecureLoginRequest?.(null)
            return
          }
          pendingAutomaticLogin.current.delete(key)
          onSavedAccessNotice?.({ origin: siteOrigin, phase: 'needs-attention' })
          onSecureLoginRequest?.({
            ...request, diagnostic: 'No se pudo confirmar el inicio automático. Revisa el acceso guardado.',
          })
          return
        }
        if (!stopped) onSecureLoginRequest?.(request)
      } finally {
        checking = false
      }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 3_500)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [siteOrigin, snapshot.url, snapshot.tabId, active, dismissed, onSecureLoginRequest, onSavedAccessNotice])

  const pasteIntoPage = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) await run({ type: 'text', text: text.slice(0, 4096) })
    } catch { setError('No fue posible acceder al portapapeles; autoriza el pegado en Chrome.') }
  }

  // The card is mounted after the chat flow. A late CDP connection changes
  // its height without changing chat message IDs; bring the result into view
  // once instead of leaving it invisibly below the last Kira bubble.
  useEffect(() => {
    if (!autoScroll || !requested || !show || expanded || !active) return
    const element = inlineRef.current
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }, [autoScroll, requested, show, expanded, active, snapshot.tabId, snapshot.url])

  useEffect(() => {
    onPageChange?.(snapshot.available && snapshot.url
      ? { title: snapshot.title ?? '', url: snapshot.url } : null)
  }, [snapshot.available, snapshot.url, snapshot.title, onPageChange])

  const drainActions = useCallback(async (): Promise<void> => {
    if (actionQueueRunning.current) return
    actionQueueRunning.current = true
    try {
      while (actionQueue.current.length > 0 && mounted.current) {
        const queued = actionQueue.current.shift()
        if (!queued) continue
        const controller = new AbortController()
        actionRequest.current = controller
        let stopQueue = false
        try {
          setError(undefined)
          const state = await command(queued.request, controller.signal)
          if (!requestIsActive(controller.signal, mounted)) continue
          if (state.tabId !== undefined) cardTabId.current = state.tabId
          else { cardTabId.current = undefined; followGlobal.current = true }
          setSnapshot(state)
          if (queued.request.type === 'open' || queued.request.type === 'new-tab' || queued.request.type === 'start') setEnabled(true)
          refreshFrame.current?.()
        } catch (reason) {
          // A failed mutation may have reached Chrome before its response was
          // lost (including Host-side deadlines). Never replay dependent
          // gestures after any command error.
          stopQueue = true
          if (requestIsActive(controller.signal, mounted)) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        } finally {
          if (actionRequest.current === controller) actionRequest.current = undefined
          queued.resolve()
        }
        // Drop later gestures rather than replaying them out of order after an
        // error, timeout, cancellation, or unmount.
        if (stopQueue || !requestIsActive(controller.signal, mounted)) {
          for (const pending of actionQueue.current.splice(0)) pending.resolve()
          break
        }
      }
    } finally {
      actionQueueRunning.current = false
    }
  }, [])

  const run = useCallback((request: Command): Promise<void> => {
    if (!mounted.current) return Promise.resolve()
    // Capture the target at enqueue time. A later action may change the active
    // tab before this gesture reaches Chrome, but it must keep its original tab.
    const scoped = request.type === 'new-tab' || request.type === 'start'
      ? request
      : { ...request, ...request.tabId === undefined && cardTabId.current !== undefined
        ? { tabId: cardTabId.current }
        : {} }
    if (request.type === 'select-tab' && request.tabId !== undefined) {
      followGlobal.current = false
      cardTabId.current = request.tabId
    }
    return new Promise((resolve) => {
      actionQueue.current.push({ request: { ...scoped, sessionId }, resolve })
      void drainActions()
    })
  }, [drainActions, sessionId])

  useEffect(() => {
    if (!active || dismissed) return
    mounted.current = true
    const first = new AbortController()
    if (initialTargetTabId !== appliedInitialTarget.current) {
      // A child Chrome call may settle after this card mounted. Its explicit
      // target outranks any global tab inferred by the first poll.
      appliedInitialTarget.current = initialTargetTabId
      if (initialTargetTabId !== undefined) {
        followGlobal.current = false
        cardTabId.current = initialTargetTabId
      }
    }
    const reactivatedTabId = !previousActive.current ? cardTabId.current : undefined
    const reactivating = reactivatedTabId !== undefined
    if (reactivating) followGlobal.current = false
    const selection = reactivatedTabId !== undefined
      // Wait for the old target to become active BEFORE inspecting it; otherwise
      // a race with the newest tab could accidentally overwrite this card.
      ? command({ type: 'select-tab', sessionId, tabId: reactivatedTabId }, first.signal).then(() => undefined, () => undefined)
      : Promise.resolve()
    previousActive.current = active
    // A requested browser is an instruction to start the embedded Chromium,
    // not merely to show a disconnected card with a manual Connect button.
    // One poll at a time avoids competing CDP sessions during slow Windows boots.
    let polling = false
    let startAttempted = false
    const poll = async (): Promise<void> => {
      if (polling) return
      polling = true
      try {
        await selection
        if (!requestIsActive(first.signal, mounted)) return
        let state: Snapshot | undefined
        let inspectError: unknown
        try {
          state = await inspect(sessionId, first.signal, followGlobal.current ? undefined : cardTabId.current)
        } catch (reason) {
          inspectError = reason
          // Saved conversation histories can refer to targets from the old
          // globally shared Chrome. Never attach that stale ID to this chat.
          if (cardTabId.current !== undefined) {
            try {
              state = await inspect(sessionId, first.signal)
              followGlobal.current = true
              cardTabId.current = undefined
            } catch { /* Preserve the original diagnostic if the host is down. */ }
          }
        }
        if (!requestIsActive(first.signal, mounted)) return
        if (requested && (!state || !state.available) && !startAttempted) {
          // Starting Chrome is a mutation whose timeout may leave the host in
          // an unknown state. Let the user retry explicitly instead of issuing
          // the same mutation again from the polling loop.
          startAttempted = true
          state = await command({ type: 'start', sessionId }, first.signal)
        }
        if (!requestIsActive(first.signal, mounted)) return
        if (state === undefined) {
          throw inspectError instanceof Error
            ? inspectError : new Error(typeof inspectError === 'string' ? inspectError : 'Chromium no respondió.')
        }
        setConnectionError(undefined)
        if (state.tabId !== undefined) cardTabId.current = state.tabId
        else { cardTabId.current = undefined; followGlobal.current = true }
        setSnapshot(state)
      } catch (reason) {
        if (requestIsActive(first.signal, mounted)) {
          setConnectionError(reason instanceof Error ? reason.message : String(reason))
        }
      } finally {
        polling = false
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1700)
    return () => {
      mounted.current = false
      previousActive.current = false
      first.abort()
      actionRequest.current?.abort()
      for (const queued of actionQueue.current.splice(0)) queued.resolve()
      window.clearInterval(timer)
    }
  }, [active, dismissed, initialTargetTabId, requested, sessionId])

  useEffect(() => {
    if (!active || !show || !hasPage || collapsed || playingVideo) return
    const tabId = snapshot.tabId
    if (tabId === undefined) return
    let stopped = false
    const load = async () => {
      // Hidden Phoenix tabs need no expensive Chromium JPEG capture.
      // A visibility event below refreshes the frame when the user returns.
      if (document.hidden || document.visibilityState === 'hidden') return
      if (frameRequest.current !== undefined) {
        frameRefreshPending.current = true
        return
      }
      const controller = new AbortController()
      frameRequest.current = controller
      try {
        const blob = await captureFrame(tabId, sessionId, controller.signal)
        if (stopped || !mounted.current || controller.signal.aborted) return
        const next = URL.createObjectURL(blob)
        const previous = frameRef.current
        frameRef.current = next
        setFrame(next)
        setCaptureError(undefined)
        if (previous) URL.revokeObjectURL(previous)
      } catch (reason) {
        if (!stopped && !controller.signal.aborted) {
          setCaptureError(reason instanceof Error ? reason.message : String(reason))
        }
        // A failed screenshot does not discard the last successful frame,
        // the selected Chromium tab, or the user's navigation controls.
      }
      finally {
        const ownsRequest = frameRequest.current === controller
        if (ownsRequest) frameRequest.current = undefined
        if (!ownsRequest) return
        if (frameRefreshPending.current && !stopped && !controller.signal.aborted) {
          frameRefreshPending.current = false
          void load()
        } else if (stopped || controller.signal.aborted) {
          frameRefreshPending.current = false
        }
      }
    }
    const refresh = () => {
      if (!stopped) void load()
    }
    refreshFrame.current = refresh
    void load()
    // Render a live preview without competing continuously with Kira's
    // CDP form filling. UI gestures still refresh the frame on their next tick.
    const timer = window.setInterval(() => { void load() }, expanded ? 3000 : 4000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (refreshFrame.current === refresh) refreshFrame.current = undefined
      const request = frameRequest.current
      request?.abort()
      if (frameRequest.current === request) {
        frameRequest.current = undefined
      }
    }
  }, [active, show, dismissed, hasPage, snapshot.tabId, collapsed, playingVideo, expanded, sessionId])

  useEffect(() => () => {
    mounted.current = false
    actionRequest.current?.abort()
    for (const queued of actionQueue.current.splice(0)) queued.resolve()
    frameRequest.current?.abort()
    if (frameRef.current) URL.revokeObjectURL(frameRef.current)
  }, [])

  useEffect(() => {
    if (snapshot.url && snapshot.url !== 'about:blank' && snapshot.url !== lastObservedUrl.current) {
      setDismissed(false)
      setCollapsed(false)
    }
    if (snapshot.url !== lastObservedUrl.current) { setPlayingVideo(false); setVideoSurface(true) }
    lastObservedUrl.current = snapshot.url
  }, [snapshot.url])

  useEffect(() => {
    if (snapshot.tabId !== currentTab.current) {
      currentTab.current = snapshot.tabId
      setAddress(snapshot.url || '')
    } else if (snapshot.url && document.activeElement?.getAttribute('data-mini-address') !== 'true') {
      setAddress(snapshot.url)
    }
  }, [snapshot.tabId, snapshot.url])

  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement !== focusRef.current) setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('keydown', closeOnEscape) }
  }, [expanded])

  const click = (event: MouseEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    const position = point(event.currentTarget, event.clientX, event.clientY)
    event.currentTarget.focus()
    if (position) void run({ type: 'click', ...position })
  }
  const wheel = (event: WheelEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    const position = point(event.currentTarget, event.clientX, event.clientY)
    if (position) void run({ type: 'scroll', ...position, deltaY: event.deltaY })
  }
  const keyboard = (event: KeyboardEvent<HTMLImageElement>) => {
    if (!active) { onActivate?.(); return }
    if (event.key === 'F5') { event.preventDefault(); void run({ type: 'reload' }); return }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault(); void pasteIntoPage(); return
    }
    if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') return
    event.preventDefault()
    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
    void run({ type: 'key', key: event.key, modifiers })
  }

  /** Capture only after the user opens Chrome's native sharing prompt.
   * This is independent of Kira's muted headless YouTube player.
   */
  const startMediaCapture = async () => {
    if (stopMediaCapture.current) return
    let stream: MediaStream | undefined
    try {
      const mediaDevices = (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices
      if (mediaDevices === undefined || typeof mediaDevices.getDisplayMedia !== 'function'
        || typeof MediaRecorder === 'undefined') {
        throw new Error('Chrome no permite compartir pestaña desde esta sesión.')
      }
      // The browser MUST show its native tab chooser; no hidden auto-capture.
      stream = await mediaDevices.getDisplayMedia({
        video: { frameRate: 10 }, audio: true,
      })
      if (stream.getAudioTracks().length === 0) {
        throw new Error('Activa «Compartir audio de la pestaña» en el selector de Chrome.')
      }
      const format = ['video/webm;codecs=vp8,opus', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type))
      if (!format) throw new Error('Este Chrome no puede grabar video WebM.')
      const recorder = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 1_200_000 })
      const recorded: Blob[] = []
      let done = false
      const cleanup = () => {
        clearTimeout(timer)
        stream?.getTracks().forEach((track) => { track.stop() })
        stopMediaCapture.current = undefined
      }
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recorded.push(event.data) }
      recorder.onerror = () => {
        done = true
        cleanup()
        setMediaCaptureState('idle')
        setMediaCaptureMessage('Falló la grabación. Puedes intentarlo de nuevo.')
      }
      recorder.onstop = () => {
        if (done) return
        done = true
        cleanup()
        const blob = new Blob(recorded, { type: 'video/webm' })
        if (blob.size < 128 || blob.size > 24 * 1024 * 1024) {
          setMediaCaptureState('idle')
          setMediaCaptureMessage('La grabación está vacía o excede 24 MB.')
          return
        }
        setMediaCaptureState('uploading')
        void (async () => {
          try {
            const response = await fetch(API + '/capture', {
              method: 'POST', headers: { ...HEADERS, 'content-type': 'video/webm' },
              body: blob, cache: 'no-store',
            })
            const result = await decode<{ captureId: string }>(response)
            setMediaCaptureState('ready')
            setMediaCaptureMessage('Grabación recibida (' + result.captureId.slice(0, 8)
              + '). Escribe a Kira: «Analiza la grabación compartida con video_media_inspect». Solo el análisis confirma audio e imágenes.')
          } catch (error) {
            setMediaCaptureState('idle')
            setMediaCaptureMessage('No se pudo guardar la grabación: ' + String(error))
          }
        })()
      }
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => {
          if (recorder.state !== 'inactive') recorder.stop()
        }, { once: true })
      }
      recorder.start(1000)
      stopMediaCapture.current = () => {
        if (recorder.state !== 'inactive') recorder.stop()
      }
      const timer = setTimeout(() => { stopMediaCapture.current?.() }, 30_000)
      setMediaCaptureState('recording')
      setMediaCaptureMessage('Grabando hasta 30 segundos. Reproduce el video en la pestaña seleccionada.')
    } catch (error) {
      stream?.getTracks().forEach((track) => { track.stop() })
      setMediaCaptureState('idle')
      setMediaCaptureMessage(error instanceof Error ? error.message : String(error))
    }
  }

  // No browser chrome in ordinary greetings or unrelated conversations.
  // A deliberate request or an existing real Chromium tab is required.
  if (!show) return null
  const viewer = (
    <section className={css.browser} data-mini-browser data-expanded={expanded ? 'true' : undefined} aria-label="Navegador de Kira">
      <div className={css.titlebar}>
        <span className={css.brand}><PhoenixLogo size={18} /> <span>Navegador de Kira</span></span>
        <span className={css.status} data-state={!active ? 'inactive' : hasPage ? 'live' : connectionError ? 'error' : 'connecting'}>
          {!active ? 'Vista conservada' : hasPage ? 'Chrome · Página activa' : 'Chrome · Preparando página'}
        </span>
        {!active && <button type="button" title="Reactivar esta página" onClick={() => { onActivate?.() }}>↻ Reactivar</button>}
        <span className={css.grow} />
        <button type="button" title={expanded ? 'Volver al chat' : 'Ampliar navegador'} onClick={() => { setExpanded(value => !value); setCollapsed(false) }}>
          {expanded ? '↙ Volver al chat' : '⛶ Ampliar'}
        </button>
        {!expanded && <button type="button" title={collapsed ? 'Mostrar navegador' : 'Contraer navegador'} onClick={() => { setCollapsed(value => !value) }}>{collapsed ? '▢' : '−'}</button>}
        <button type="button" title="Ocultar microventana" onClick={() => { setDismissed(true); setEnabled(false); setCollapsed(true); setExpanded(false) }}>×</button>
      </div>
      {!collapsed && <>
        <div className={css.tabs} role="tablist" aria-label="Pestañas">
          {snapshot.tabs.map(tab => (
            <div className={css.tabWrap} key={tab.id}>
              <button type="button" role="tab" aria-selected={tab.id === snapshot.tabId}
                className={tab.id === snapshot.tabId ? css.activeTab : undefined}
                onClick={() => { void run({ type: 'select-tab', tabId: tab.id }) }}>{tab.title || 'Nueva pestaña'}</button>
              <button type="button" aria-label={'Cerrar pestaña ' + (tab.title || tab.id)} className={css.tabClose}
                onClick={() => { void run({ type: 'close-tab', tabId: tab.id }) }}>×</button>
            </div>
          ))}
          <button type="button" title="Nueva pestaña" onClick={() => { void run({ type: 'new-tab', url: 'https://www.google.com' }) }}>+</button>
        </div>
        <form className={css.toolbar} onSubmit={(event) => { event.preventDefault(); void run({ type: 'open', url: address }) }}>
          <button type="button" aria-label="Atrás" onClick={() => { void run({ type: 'back' }) }}>←</button>
          <button type="button" aria-label="Adelante" onClick={() => { void run({ type: 'forward' }) }}>→</button>
          <button type="button" aria-label="Recargar" onClick={() => { void run({ type: 'reload' }) }}>↻</button>
          <input data-mini-address="true" aria-label="Dirección web" type="text" spellCheck={false}
            placeholder="Buscar o escribir una dirección"
            value={address} onChange={(event) => { setAddress(event.currentTarget.value) }} />
          <button type="submit">Ir</button>
          {siteOrigin && snapshot.tabId && onSecureLoginRequest && <button type="button"
            aria-label="Abrir acceso seguro" title="Acceso seguro de Kira en el panel lateral"
            onClick={() => {
              const tabId = snapshot.tabId!
              void secureApi<SecureStatus>('/status?origin=' + encodeURIComponent(siteOrigin))
                .then(status => onSecureLoginRequest({
                  origin: siteOrigin, tabId, saved: status.saved, automatic: status.automatic, explicit: true,
                  ...(status.profile ? { profile: status.profile } : {}),
                  ...(status.profiles ? { profiles: status.profiles } : {}),
                }))
                .catch(() => {
                  onSavedAccessNotice?.({ origin: siteOrigin, phase: 'vault-unavailable' })
                  onSecureLoginRequest(null)
                })
            }}>🔐 Acceso seguro</button>}
        </form>
        {snapshot.available ? (
          <div className={css.viewport}>
            {!hasPage ? <div className={css.loading} role="status">MiniBrowser de esta conversación iniciado. Todavía no se ha comprobado ninguna página. Kira no debe afirmar que la abrió hasta verificarla.</div> : (
            videoSurface && videoId ? (
              <iframe className={css.player}
                title="Reproductor YouTube"
                src={'https://www.youtube-nocookie.com/embed/' + videoId + '?autoplay=' + (playingVideo ? '1' : '0') + '&playsinline=1'}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : frame ? <img ref={focusRef} src={frame} alt={'Página actual: ' + (snapshot.title || snapshot.url || '')}
              role="button" aria-label="Controlar página con el ratón y el teclado"
              tabIndex={0} draggable={false} onClick={click} onWheel={wheel} onKeyDown={keyboard}
              onPaste={(event) => { event.preventDefault(); const value = event.clipboardData.getData('text/plain'); if (value) void run({ type: 'text', text: value.slice(0, 4096) }) }}
              className={css.screen} /> : <div className={css.loading}>Conectando imagen del navegador…</div>)}
          </div>
        ) : (
          <div className={css.empty}>
            <p>{connectionError
              ? 'Phoenix todavía no ha conectado la vista del navegador. Puedes reintentar sin salir del chat.'
              : 'Chrome real dentro de la conversación. Kira y tú utilizáis las mismas pestañas.'}</p>
            {initialTargetTabId === undefined && <button type="button" onClick={() => { void run({ type: 'start' }) }}>Conectar navegador</button>}
          </div>
        )}
        <div className={css.mediaBar}>
          {videoId && <>
            <button type="button" onClick={() => { setVideoSurface(true); setPlayingVideo(true) }}>
              ▶ Reproducir con audio
            </button>
            <button type="button" onClick={() => { setVideoSurface(false); setPlayingVideo(false) }}>
              ◧ Ver navegador de Kira
            </button>
            <button type="button" onClick={() => { setVideoSurface(true); setPlayingVideo(false) }}>
              ▣ Ver video
            </button>
          </>}
          <button type="button" disabled={!active || mediaCaptureState === 'uploading'}
            aria-label={mediaCaptureState === 'recording' ? 'Detener captura de pestaña' : 'Compartir pestaña para Kira'}
            onClick={() => mediaCaptureState === 'recording'
              ? stopMediaCapture.current?.() : void startMediaCapture()}>
            {mediaCaptureState === 'recording' ? '■ Detener captura' : '◉ Compartir pestaña para Kira'}
          </button>
          <span>
            Kira analiza por sí misma el navegador y prueba primero las herramientas nativas de video y audio.
            Si Chrome impide capturar el audio, puedes autorizar aquí una grabación de hasta 30 segundos:
            Chrome solicitará seleccionar la pestaña y activar «Compartir audio».
          </span>
        </div>
        {mediaCaptureMessage && <p className={css.captureStatus} role="status">{mediaCaptureMessage}</p>}
        {siteOrigin && snapshot.tabId && onSecureLoginRequest && <button type="button"
          className={css.secureShortcut}
          onClick={() => {
            const tabId = snapshot.tabId as string
            void secureApi<SecureStatus>('/status?origin=' + encodeURIComponent(siteOrigin))
              .then(status => onSecureLoginRequest({
                origin: siteOrigin, tabId, saved: status.saved, automatic: status.automatic,
                explicit: true, ...(status.profile ? { profile: status.profile } : {}),
                ...(status.profiles ? { profiles: status.profiles } : {}),
              }))
              .catch(() => {
                onSavedAccessNotice?.({ origin: siteOrigin, phase: 'vault-unavailable' })
                onSecureLoginRequest(null)
              })
          }}>
          🔐 Solicitar acceso seguro
        </button>}
        <form className={css.typeRow} onSubmit={(event) => { event.preventDefault(); if (typed) { void run({ type: 'text', text: typed }); setTyped(''); focusRef.current?.focus() } }}>
          <input aria-label="Escribir en la página" placeholder="Escribe en el campo seleccionado…" value={typed} onChange={(event) => { setTyped(event.currentTarget.value) }} />
          <button type="submit" disabled={!snapshot.available || !typed}>Escribir</button>
          <button type="button" disabled={!snapshot.available} title="Pegar texto en el campo enfocado (no contraseñas)" onClick={() => { void pasteIntoPage() }}>Pegar</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Enter' }) }}>Enter</button>
          <button type="button" disabled={!snapshot.available} onClick={() => { void run({ type: 'key', key: 'Tab' }) }}>Tab</button>
        </form>
        {captureError && active && <p className={css.error} role="status">
          La página está abierta, pero su imagen todavía no está disponible: {captureError}. Phoenix reintentará la captura automáticamente.
        </p>}
        {connectionError && <p className={css.error} role="status">Conexión del navegador: {connectionError}</p>}
        {error && <p className={css.error} role="alert">{error}</p>}
        <p className={css.hint}>Haz clic en la imagen para interactuar. «Ampliar» conserva la pestaña y la sesión.</p>
      </>}
      {snapshot.available && <div className={css.externalActions}>
        <button type="button" title="Abrir esta página en Chrome completo" onClick={() => { void run({ type: 'open-external' }) }}>
          ↗ Abrir navegador completo
        </button>
      </div>}
    </section>
  )
  return <>
    {/* Keep focus signaling in-flow even when the browser is portaled fullscreen. */}
    <span hidden data-mini-browser-focus={expanded || !collapsed ? 'true' : undefined} />
    {!expanded && <div ref={inlineRef} className={css.inline}>{viewer}</div>}
    {expanded && <Modal open headless className={css.expandedDialog ?? ''} title="Navegador de Kira" onClose={() => { setExpanded(false) }}>{viewer}</Modal>}
  </>
}
