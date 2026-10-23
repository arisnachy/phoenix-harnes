import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import type { ToolCallBlock } from '@phoenix-ai/dsh-client-runtime/client'
import { PhoenixLogo } from '@phoenix-ai/dsh-client-ui-primitives'
import type { AssistantChatData, ToolChatData } from '../contract/chat-nodes.ts'
import { isRunningTool, isSettledTool } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { formatRunDuration } from './message-chrome.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { MiniBrowser, type SavedAccessNotice, type SecureLoginTarget } from './MiniBrowser.tsx'
import { DesktopLive } from './DesktopLive.tsx'
import { SecureAsk } from './SecureAsk.tsx'
import type { TurnProgress } from './turn-progress.ts'
import chatCss from './ChatView.module.css'
import css from './ToolActivityFlow.module.css'

type SeatProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey'>

interface OrderedChatNode {
  readonly key: string
  readonly kind: string
  readonly data: unknown
}

interface ToolActivityFlowProps extends SeatProps {
  readonly sessionId: string
  readonly nodes: readonly OrderedChatNode[]
  /** Runtime-open browser turn, even while Kira is streaming visible prose. */
  readonly browserTurnOpen?: boolean
  /** Ordinary prompt admitted locally but not yet present in the durable transcript. */
  readonly optimisticSubmit?: {
    readonly startedAt: number
    readonly text: string
    /** Last durable node that existed when Enter was pressed; null means before the first node. */
    readonly afterNodeKey: string | null
  } | undefined
  readonly turnStatus: {
    readonly startTime: number | null
    readonly progress: TurnProgress | null
    /** Fail-safe expiry for optimistic admission-only activity; runtime activity uses null. */
    readonly expiresAfterMs: number | null
  } | undefined
}

type ActivityItem =
  | { readonly kind: 'node'; readonly key: string; readonly liveTool: boolean }
  | {
    readonly kind: 'reasoning'
    readonly key: string
    readonly sourceKey: string
    readonly text: string
    readonly running: boolean
  }

type FlowItem =
  | { readonly kind: 'desktop'; readonly key: string; readonly userKey: string }
  | { readonly kind: 'browser'; readonly key: string; readonly userKey: string; readonly tabId?: string; readonly sourceUrl?: string }
  | { readonly kind: 'browser-workspace'; readonly key: string; readonly userKey: string; readonly tabId?: string; readonly sourceUrl?: string; readonly live: boolean; readonly items: readonly FlowItem[] }
  | { readonly kind: 'node'; readonly key: string }
  | { readonly kind: 'optimistic'; readonly key: string; readonly text: string }
  | {
    readonly kind: 'activity'
    readonly key: string
    readonly anchorKey: string | undefined
    readonly items: readonly ActivityItem[]
  }
  | {
    readonly kind: 'images'
    readonly key: string
    readonly images: readonly { readonly attachment: ImageAttachmentRef }[]
  }

function imageActivity(node: OrderedChatNode): readonly { readonly attachment: ImageAttachmentRef }[] {
  if (node.kind !== 'tool-call') return []
  const root = (node.data as ToolChatData).root
  if (!isSettledTool(root)) return []
  return root.content.flatMap(block => block.type === 'image' ? [{ attachment: block.attachment }] : [])
}

function isWholeActivity(kind: string): boolean {
  return kind === 'context' || kind === 'tool-call' || kind === 'model-retry'
}

function isActionableConnectorRecovery(node: OrderedChatNode): boolean {
  if (node.kind !== 'tool-call') return false
  const root = (node.data as ToolChatData).root
  if (!isSettledTool(root) || root.isError || root.call?.name !== 'connector_list') return false
  const text = root.content
    .map(block => block.type === 'text' ? block.text : '')
    .join('')
  try {
    const parsed = JSON.parse(text) as { kind?: unknown; connectors?: unknown }
    if (parsed.kind !== 'connector_list' || !Array.isArray(parsed.connectors)) return false
    return parsed.connectors.some((value) => {
      if (typeof value !== 'object' || value === null) return false
      const candidate = value as { recommended_action?: unknown; relevant?: unknown }
      return candidate.relevant === true && candidate.recommended_action === 'connect-or-reconnect'
    })
  } catch {
    return false
  }
}

function activityNode(node: OrderedChatNode): ActivityItem {
  const liveTool = node.kind === 'tool-call'
    && isRunningTool((node.data as ToolChatData).root)
  return { kind: 'node', key: node.key, liveTool }
}

function assistantData(node: OrderedChatNode): AssistantChatData | null {
  return node.kind === 'assistant-step' ? node.data as AssistantChatData : null
}

function reasoningItems(node: OrderedChatNode, data: AssistantChatData): ActivityItem[] {
  const last = data.blocks.length - 1
  return data.blocks.flatMap((block, index) => block.kind === 'reasoning'
    ? [{
      kind: 'reasoning' as const,
      key: `${node.key}:reasoning:${index}`,
      sourceKey: node.key,
      text: block.text,
      running: data.status === 'running' && index === last,
    }]
    : [])
}

function hasAssistantSurface(data: AssistantChatData): boolean {
  if (data.status === 'interrupted') return true
  return data.blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    if (block.kind === 'text') return block.text.trim() !== ''
    return true
  })
}

/**
 * Detect a user request to navigate the web.
 * @param text - Plain text from a durable or optimistic user message.
 * @returns Whether the message requests browser navigation.
 */
export function isBrowserPrompt(text: string): boolean {
  // Natural requests may include accents, conjugations and small typos:
  // "puedes entras a la pagina..." must open the same in-chat browser
  // that Kira controls, rather than silently omitting its card.
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  // Native Windows requests are never automatic web-navigation intents even
  // when they say "entra", "abre" or mention the Desktop Live viewer.
  if (isDesktopPrompt(text)) return false
  const verb = /\b(?:abre|abres|abrir|abreme|abrirme|navega|navegas|navegar|entra|entras|entrar|ingresa|ingresas|ingresar)\b/u
  const verb2 = /\b(?:visita|visitas|visitar|accede|accedes|acceder)\b/u
  const englishVerb = /\b(?:open|browse|visit)\b/u
  const target = /\b(?:ir a|ve a|busca en|buscar en)\b|https?:\/\//u
  const webContext = /\b(?:pagina|web|sitio|portal|navegador|website|internet|url|enlace)\b|https?:\/\//u
  // "abre el archivo" is not browser navigation; a web context overrides it.
  const localObject = /\b(?:archivo|carpeta|documento|pdf|chat|conversacion|configuracion|terminal|proyecto|aplicacion|app)\b/u
  if (/\b(?:no|nunca)\s+(?:abras|abres|abrir|entres|entrar|navegues|navegar|visites|visitar)\b/u.test(normalized)) return false
  const youtubeReview = /\b(?:youtube|youtu\.be)\b/u.test(normalized)
    && /\b(?:video|tutorial|mira|ver|ve|revisa|analiza|estudia|reproduce)\b/u.test(normalized)
  return target.test(normalized) || youtubeReview
    || ((verb.test(normalized) || verb2.test(normalized) || englishVerb.test(normalized))
      && (webContext.test(normalized) || !localObject.test(normalized)))
}
function isBrowserRequest(node: OrderedChatNode): boolean {
  if (node.kind !== 'user' && node.kind !== 'steering') return false
  const payload = node.data as { content?: unknown }
  if (!Array.isArray(payload.content)) return false
  const text = payload.content.map((value: unknown) => {
    if (value === null || typeof value !== 'object') return ''
    const block = value as { type?: unknown; text?: unknown }
    return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
  }).join('')
  return isBrowserPrompt(text)
}

/**
 * Observe real MCP Chromium work during research or another broad task.
 * @param name - Tool name emitted by the active model or MCP bridge.
 * @returns Whether that tool operates on an embedded Chromium page.
 */
export function isEmbeddedNavigationTool(name: string): boolean {
  const value = name.toLowerCase()
  // MCP browser bridges add operations over time (read_page, fill_form,
  // screenshot, and similar). The namespace is the stable signal; restricting
  // this to a hand-maintained verb list made nested Code calls invisible.
  return /(?:^|[_:./-])(?:browser|chrome)(?:[_:./-]|$)/u.test(value)
}

interface EmbeddedBrowserUse {
  readonly found: boolean
  readonly tabId?: string
}

function toolCallName(block: ToolCallBlock): string | undefined {
  if ('kind' in block) return block.call?.name ?? undefined
  if ('name' in block && typeof block.name === 'string') return block.name
  if ('call' in block && block.call !== null && typeof block.call === 'object'
    && 'name' in block.call && typeof block.call.name === 'string') return block.call.name
  return undefined
}

function toolCallArguments(block: ToolCallBlock): string | undefined {
  if ('kind' in block) return block.call?.argsRaw ?? undefined
  if ('argsRaw' in block && typeof block.argsRaw === 'string') return block.argsRaw
  if ('call' in block && block.call !== null && typeof block.call === 'object'
    && 'argsRaw' in block.call && typeof block.call.argsRaw === 'string') return block.call.argsRaw
  return undefined
}

function toolCallTabId(block: ToolCallBlock): string | undefined {
  const raw = toolCallArguments(block)
  if (raw === undefined) return undefined
  try {
    const value = JSON.parse(raw) as { tabId?: unknown }
    return typeof value.tabId === 'string' && value.tabId.trim() !== '' ? value.tabId : undefined
  } catch {
    return undefined
  }
}

const MAX_EMBEDDED_BROWSER_DEPTH = 256

/**
 * Only public, credential-free HTTPS sources may be mirrored into Chromium.
 * This does not turn an HTTP fetch into a Chrome tool call: the viewport makes
 * a separate real navigation and will show its own loading/error state.
 */
export function visibleResearchSourceUrl(raw: string): string | undefined {
  if (raw.length === 0 || raw.length > 2048) return undefined
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    // Exclude IP literals, local hostnames and private/internal endpoints. A
    // publicly named site may still fail to load, which Chromium will report.
    if (!/^(?:[a-z0-9-]+\\.)+[a-z][a-z0-9-]{1,}$/iu.test(url.hostname)) return undefined
    if (url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return undefined
    if ([...url.searchParams.keys()].some(key =>
      /(?:token|api[_-]?key|password|secret|credential|signature|session|authorization)/iu.test(key))) return undefined
    url.hash = ''
    return url.href
  } catch { return undefined }
}

function fetchSourceUrl(block: ToolCallBlock): string | undefined {
  const name = toolCallName(block)?.toLowerCase()
  if (name === undefined || !/^(?:web_fetch|mcp__fetch__fetch|mcp__web__fetch|mcp__web_fetch__fetch)$/u.test(name)) return undefined
  const raw = toolCallArguments(block)
  if (raw === undefined) return undefined
  try {
    const args: unknown = JSON.parse(raw)
    if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
    const url = (args as { url?: unknown }).url
    return typeof url === 'string' ? visibleResearchSourceUrl(url) : undefined
  } catch { return undefined }
}

/** Last public source actually requested by an HTTP fetch, including nested Code calls. */
function researchSourceUse(block: ToolCallBlock): string | undefined {
  const visited = new Set<ToolCallBlock>()
  const pending: Array<{ block: ToolCallBlock; depth: number }> = [{ block, depth: 0 }]
  let latest: string | undefined
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current.block)) continue
    visited.add(current.block)
    latest = fetchSourceUrl(current.block) ?? latest
    if (current.depth >= MAX_EMBEDDED_BROWSER_DEPTH) continue
    for (let i = (current.block.subCalls ?? []).length - 1; i >= 0; i--) {
      const child = current.block.subCalls?.[i]
      if (child !== undefined) pending.push({ block: child, depth: current.depth + 1 })
    }
  }
  return latest
}

function embeddedBrowserUse(block: ToolCallBlock): EmbeddedBrowserUse {
  const visited = new Set<ToolCallBlock>()
  const pending: Array<{ readonly block: ToolCallBlock; readonly depth: number }> = [{ block, depth: 0 }]
  let found = false
  let tabId: string | undefined
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current.block)) continue
    visited.add(current.block)
    if (isEmbeddedNavigationTool(toolCallName(current.block) ?? '')) {
      found = true
      // Traverse in transcript order; the latest explicit nested target owns
      // the preview card when one parent dispatch contains several Chrome calls.
      tabId = toolCallTabId(current.block) ?? tabId
    }
    if (current.depth >= MAX_EMBEDDED_BROWSER_DEPTH) continue
    const children = current.block.subCalls ?? []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (child !== undefined) pending.push({ block: child, depth: current.depth + 1 })
    }
  }
  return found ? tabId === undefined ? { found: true } : { found: true, tabId } : { found: false }
}

function buildFlow(nodes: readonly OrderedChatNode[]): FlowItem[] {
  const flow: FlowItem[] = []
  let pending: ActivityItem[] = []
  let pendingAnchorKey: string | undefined

  const flush = (avoidAnchorKey?: string): void => {
    const first = pending[0]
    if (first === undefined) return
    const candidate = pendingAnchorKey ?? (first.kind === 'node' ? first.key : first.sourceKey)
    flow.push({
      kind: 'activity',
      key: `activity:${first.kind === 'node' ? first.key : first.sourceKey}`,
      anchorKey: candidate === avoidAnchorKey ? undefined : candidate,
      items: pending,
    })
    pending = []
    pendingAnchorKey = undefined
  }

  for (const node of nodes) {
    // Connector authorization is a user action, not background tool telemetry.
    // Keep its compact Connect/Reconnect card directly in the chat flow instead
    // of burying it inside the collapsed Tools disclosure.
    if (isActionableConnectorRecovery(node)) {
      flush()
      flow.push({ kind: 'node', key: node.key })
      continue
    }
    if (isWholeActivity(node.kind)) {
      const images = imageActivity(node)
      if (images.length > 0) {
        flush()
        flow.push({ kind: 'images', key: `images:${node.key}`, images })
      } else {
        pending.push(activityNode(node))
        pendingAnchorKey ??= node.key
      }
      continue
    }

    const assistant = assistantData(node)
    if (assistant !== null) {
      const reasoning = reasoningItems(node, assistant)
      if (reasoning.length > 0) pending.push(...reasoning)
      if (hasAssistantSurface(assistant)) {
        flow.push({ kind: 'node', key: node.key })
        flush(node.key)
      } else if (reasoning.length === 0) {
        flush()
        flow.push({ kind: 'node', key: node.key })
      }
      continue
    }

    flush()
    flow.push({ kind: 'node', key: node.key })
  }

  flush()
  return flow
}

/**
 * Insert the local user gesture at the durable boundary that existed when it
 * was sent. Building the two sides independently also prevents later tool
 * activity from being folded into a group that visually crosses the user.
 */
function buildAnchoredFlow(
  nodes: readonly OrderedChatNode[],
  optimisticSubmit: ToolActivityFlowProps['optimisticSubmit'],
): FlowItem[] {
  if (optimisticSubmit === undefined || optimisticSubmit.text === '') return buildFlow(nodes)
  const anchorIndex = optimisticSubmit.afterNodeKey === null
    ? -1
    : nodes.findIndex(node => node.key === optimisticSubmit.afterNodeKey)
  const splitAt = anchorIndex < 0
    ? (optimisticSubmit.afterNodeKey === null ? 0 : nodes.length)
    : anchorIndex + 1
  return [
    ...buildFlow(nodes.slice(0, splitAt)),
    {
      kind: 'optimistic',
      key: `optimistic-user:${optimisticSubmit.startedAt}`,
      text: optimisticSubmit.text,
    },
    ...buildFlow(nodes.slice(splitAt)),
  ]
}

/**
 * Insert independently keyed browser cards at stable transcript boundaries.
 * @param flow - Ordered render items, including optimistic messages.
 * @param nodes - Durable messages used to recognize navigation requests.
 * @returns The chat flow with browser cards after each relevant turn.
 */
export function addBrowserCards(
  flow: FlowItem[],
  nodes: readonly OrderedChatNode[],
): FlowItem[] {
  const desktopRequests = new Set(nodes.filter(isDesktopRequest).map(node => node.key))
  const requests = new Set(nodes.filter(node => !desktopRequests.has(node.key) && isBrowserRequest(node)).map(node => node.key))
  const browserTabIds = new Map<string, string>()
  const researchUrls = new Map<string, string>()
  const directChromeTurns = new Set<string>()
  let currentUserKey: string | undefined
  for (const node of nodes) {
    if (node.kind === 'user' || node.kind === 'steering') currentUserKey = node.key
    if (node.kind === 'tool-call' && currentUserKey !== undefined && !desktopRequests.has(currentUserKey)) {
      const root = (node.data as ToolChatData).root
      const browserUse = embeddedBrowserUse(root)
      if (browserUse.found) {
        requests.add(currentUserKey)
        directChromeTurns.add(currentUserKey)
        if (browserUse.tabId !== undefined) browserTabIds.set(currentUserKey, browserUse.tabId)
      }
      const sourceUrl = researchSourceUse(root)
      if (sourceUrl !== undefined) {
        requests.add(currentUserKey)
        researchUrls.set(currentUserKey, sourceUrl)
      }
    }
  }
  if (requests.size === 0 && !flow.some(item => item.kind === 'optimistic' && isBrowserPrompt(item.text))) return flow
  const result: FlowItem[] = []
  for (const item of flow) {
    result.push(item)
    // Browser is the next transcript surface after the request, not after
    // the answer. Assistant messages therefore continue below it on completion.
    if (item.kind === 'node' && requests.has(item.key)
      || item.kind === 'optimistic' && isBrowserPrompt(item.text)) {
      const tabId = browserTabIds.get(item.key)
      const sourceUrl = directChromeTurns.has(item.key) ? undefined : researchUrls.get(item.key)
      result.push({ kind: 'browser', key: 'browser:' + item.key, userKey: item.key,
        ...(tabId === undefined ? {} : { tabId }),
        ...(sourceUrl === undefined ? {} : { sourceUrl }) })
    }
  }
  return result
}

/** Explicit user requests for a real Windows application, not web browsing.
 * @param text - Latest user prompt text.
 * @returns Whether the user intends a native application viewer.
 */
export function isDesktopPrompt(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  if (/\bdesktop[\s-]*live\b/u.test(normalized)) return true
  const application = /\b(?:microsoft paint|paint|mspaint|bloc de notas|notepad|explorador de windows|calculadora|calculator|explorador de archivos|file explorer)\b/u
  const action = /\b(?:abre|abres|abrir|entra|entrar|ingresa|ingresar|inicia|ejecuta|dibuja|dibujo|trazo|traza|trabaja|controla|muestra|open|draw|launch|use|usa)\b/u
  return application.test(normalized) && action.test(normalized)
}

function isDesktopRequest(node: OrderedChatNode): boolean {
  if (node.kind !== 'user' && node.kind !== 'steering') return false
  const content = (node.data as { content?: unknown }).content
  if (!Array.isArray(content)) return false
  return isDesktopPrompt(content.map((block: unknown) =>
    block !== null && typeof block === 'object' && 'text' in block
      && typeof block.text === 'string' ? block.text : '').join(' '))
}

/** Put a real native Desktop Live status/viewport where users requested it.
 * A disconnected viewer is explicitly unavailable, never a made-up screenshot.
 * @param flow - Ordered chat items.
 * @param nodes - Durable chat messages.
 * @returns Flow with viewer cards beside relevant user prompts.
 */
export function addDesktopCards(flow: FlowItem[], nodes: readonly OrderedChatNode[]): FlowItem[] {
  const requests = new Set(nodes.filter(isDesktopRequest).map(node => node.key))
  const output: FlowItem[] = []
  for (const item of flow) {
    output.push(item)
    if (item.kind === 'node' && requests.has(item.key)
      || item.kind === 'optimistic' && isDesktopPrompt(item.text)) {
      output.push({ kind: 'desktop', key: 'desktop:' + item.key, userKey: item.key })
    }
  }
  return output
}

/**
 * Show real assistant/tool rows beside the browser ONLY while its own latest
 * turn is active. Moving the same keyed nodes (never cloning them) back into
 * the ordinary timeline on completion prevents duplicate assistant messages.
 * Later user turns must never relight an older browser's activity panel.
 */
export function groupActiveBrowserFlow(
  flow: FlowItem[],
  userKey: string,
  nodes: readonly OrderedChatNode[],
): FlowItem[] {
  const index = flow.findIndex(item => item.kind === 'browser' && item.userKey === userKey)
  if (index < 0) return flow
  const userKeys = new Set(nodes.filter(node => node.kind === 'user' || node.kind === 'steering').map(node => node.key))
  const nextTurn = flow.slice(index + 1).some(item =>
    item.kind === 'optimistic'
    || item.kind === 'browser'
    || item.kind === 'node' && userKeys.has(item.key))
  if (nextTurn) return flow
  const browser = flow[index]
  const tabId = browser?.kind === 'browser' ? browser.tabId : undefined
  const sourceUrl = browser?.kind === 'browser' ? browser.sourceUrl : undefined
  return [
    ...flow.slice(0, index),
    { kind: 'browser-workspace', key: 'browser-workspace:' + userKey, userKey,
      ...(tabId === undefined ? {} : { tabId }),
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      live: true, items: flow.slice(index + 1) },
  ]
}

function ToolActivityIcon() {
  return (
    <svg className={css.icon} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M7.4 3.4H6.2c-1 0-1.7.7-1.7 1.7v2c0 1-.5 1.7-1.5 2 1 .3 1.5 1 1.5 2v2c0 1 .7 1.7 1.7 1.7h1.2M12.6 3.4h1.2c1 0 1.7.7 1.7 1.7v2c0 1 .5 1.7 1.5 2-1 .3-1.5 1-1.5 2v2c0 1-.7 1.7-1.7 1.7h-1.2M8.1 7.2h3.8M8.1 10h3.8M8.1 12.8h3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ToolActivityChevron({ open }: { readonly open: boolean }) {
  return (
    <span className={css.chevron} data-open={open || undefined} aria-hidden="true">
      <svg className={css.chevronIcon} viewBox="0 0 12 12" data-tool-activity-chevron>
        <path
          d="M3 4.5 6 7.5 9 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

function ToolActivityGroup({
  items, anchorKey, t, ...seatProps
}: {
  readonly items: readonly ActivityItem[]
  readonly anchorKey: string | undefined
  readonly t: ChatViewSlotProps['t']
} & SeatProps) {
  const [open, setOpen] = useState(false)
  const liveTools = items.filter((item): item is Extract<ActivityItem, { kind: 'node' }> =>
    item.kind === 'node' && item.liveTool)
  const history = items.filter(item => item.kind !== 'node' || !item.liveTool)
  const hasHistory = history.length > 0

  return (
    <div
      className={css.group}
      data-chat-flow-kind="tool-activity"
      {...anchorKey === undefined ? {} : { 'data-chat-anchor-key': anchorKey }}
    >
      {liveTools.map(item => (
        <div key={`live:${item.key}`} className={css.liveTool} data-testid="live-tool-activity">
          <ChatNodeSeat
            nodeKey={item.key}
            t={t}
            {...seatProps}
          />
        </div>
      ))}
      {hasHistory && (
        <button
          type="button"
          className={css.toggle}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <ToolActivityIcon />
          <span>{t('context.tools')}</span>
          <ToolActivityChevron open={open} />
        </button>
      )}
      {open && hasHistory && (
        <div className={css.body}>
          {history.map(item => item.kind === 'node'
            ? (
              <ChatNodeSeat
                key={item.key}
                nodeKey={item.key}
                t={t}
                {...seatProps}
              />
            )
            : (
              <ReasoningRow
                key={item.key}
                text={item.text}
                running={item.running}
                t={t}
              />
            ))}
        </div>
      )}
    </div>
  )
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, progress, expiresAfterMs, t, centered = false }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  readonly startTime: number | null
  /** Safe phase and activity derived from the current chat projection. */
  readonly progress: TurnProgress
  /** Optional age ceiling for admission-only feedback. */
  readonly expiresAfterMs: number | null
  /** Use the reference hero-like position only for the first unfinished reply. */
  readonly centered?: boolean
  /** The owning view's locale seat. */
  readonly t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  const statusKey = progress.activity === 'searching'
    ? 'status.searching'
    : progress.activity === 'browsing'
      ? 'status.browsing'
      : progress.activity === 'reading'
        ? 'status.reading'
        : progress.activity === 'writing'
          ? 'status.writing'
          : progress.activity === 'executing'
            ? 'status.executing'
            : progress.phase === 'running-tools'
              ? 'status.runningTools'
              : progress.phase === 'verifying'
                ? 'status.verifying'
                : progress.phase === 'preparing'
                  ? 'status.preparing'
                  : 'status.thinking'
  const label = t(statusKey)
  const showClock = elapsedMs >= 15_000
  const technicalTitle = progress.detail === undefined || progress.detail === ''
    ? label
    : `${label} · ${progress.detail}`
  if (expiresAfterMs !== null && elapsedMs >= expiresAfterMs) return null
  return (
    <div
      className={chatCss.turnStatus}
      data-centered={centered ? 'true' : undefined}
      data-phase={progress.phase}
      data-activity={progress.activity}
      role="status"
      aria-live="polite"
      title={technicalTitle}
    >
      <span className={chatCss.phoenixActivity} data-activity={progress.activity} aria-hidden="true">
        <PhoenixLogo size={28} />
      </span>
      <span className={chatCss.turnStatusText}>
        {label.startsWith('Phoenix ') || label.startsWith('PHOENIX ')
          ? <><strong className={chatCss.turnStatusBrand}>{label.split(' ')[0]}</strong>{label.slice(label.indexOf(' '))}</>
          : label}
      </span>
      {showClock && (
        <span className={chatCss.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

/**
 * Return whether the reader is close enough to the live activity tail to resume following.
 * @param scrollTop - Current scroll offset of the sidecar's own scrollport.
 * @param scrollHeight - Total height of the sidecar's transcript.
 * @param clientHeight - Visible height of the sidecar.
 * @returns True when the newest visible text is at most 48px away.
 */
export function isAtActivityTail(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return Math.max(0, scrollHeight - clientHeight - scrollTop) <= 48
}


/** "Ahora no" is an explicit user choice; detection polling must not undo it. */
const dismissedSecureOrigins = new Map<string, Set<string>>()
function secureDismissStorageKey(sessionId: string): string {
  return 'phoenix:secure-ask-dismissed:' + sessionId
}
/** Read dismissal per conversation and site, including after re-mounts/reloads. */
export function isSecureAskDismissed(sessionId: string, origin: string): boolean {
  if (dismissedSecureOrigins.get(sessionId)?.has(origin)) return true
  try {
    const raw = window.sessionStorage.getItem(secureDismissStorageKey(sessionId))
    const saved: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(saved) && saved.includes(origin)
  } catch { return false }
}
/** Explicitly reopening a panel is the only way to clear its dismissal. */
export function setSecureAskDismissed(sessionId: string, origin: string, dismissed: boolean): void {
  const current = dismissedSecureOrigins.get(sessionId) ?? new Set<string>()
  if (dismissed) current.add(origin)
  else current.delete(origin)
  dismissedSecureOrigins.set(sessionId, current)
  try {
    const raw = window.sessionStorage.getItem(secureDismissStorageKey(sessionId))
    const saved: unknown = raw === null ? [] : JSON.parse(raw)
    const updated = new Set<string>(Array.isArray(saved)
      ? saved.filter((entry): entry is string => typeof entry === 'string') : [])
    if (dismissed) updated.add(origin)
    else updated.delete(origin)
    window.sessionStorage.setItem(secureDismissStorageKey(sessionId), JSON.stringify([...updated]))
  } catch { /* In-memory fallback still prevents reopening during this chat. */ }
}

/** Same real transcript seats as the ordinary chat, inside the temporary sidecar. */
function BrowserWorkspace({
  items, live, selected, onActivate, seatProps, turnStatus, tabId, sourceUrl, sessionId,
}: {
  readonly items: readonly FlowItem[]
  readonly sessionId: string
  readonly live: boolean
  readonly selected: boolean
  readonly tabId?: string
  readonly sourceUrl?: string
  readonly onActivate: () => void
  readonly seatProps: SeatProps
  readonly turnStatus: ToolActivityFlowProps['turnStatus']
}) {
  const [page, setPage] = useState<{ title: string; url: string } | null>(null)
  const [secureRequest, setSecureRequest] = useState<SecureLoginTarget | null>(null)
  const secureRequestRef = useRef<SecureLoginTarget | null>(null)
  const [secureRequestEpoch, setSecureRequestEpoch] = useState(0)
  const [savedAccessNotice, setSavedAccessNotice] = useState<SavedAccessNotice | null>(null)
  const handleSecureRequest = useCallback((request: SecureLoginTarget | null) => {
    if (request === null) {
      const hadRequest = secureRequestRef.current !== null
      secureRequestRef.current = null
      if (hadRequest) setSecureRequestEpoch(value => value + 1)
      setSecureRequest(null)
      return
    }
    if (request.explicit) setSecureAskDismissed(sessionId, request.origin, false)
    else if (isSecureAskDismissed(sessionId, request.origin)) return
    secureRequestRef.current = request
    setSecureRequest(request)
  }, [sessionId])
  const dismissSecureRequest = useCallback(() => {
    const current = secureRequestRef.current
    if (current !== null) {
      setSecureAskDismissed(sessionId, current.origin, true)
      secureRequestRef.current = null
      setSecureRequestEpoch(value => value + 1)
    }
    setSecureRequest(null)
  }, [sessionId])
  const handleSavedAccessNotice = useCallback((next: SavedAccessNotice | null) => {
    setSavedAccessNotice(previous => previous?.origin === next?.origin && previous?.phase === next?.phase
      ? previous : next)
  }, [])
  // Secure Ask belongs below MiniBrowser. Only real activity or a saved-access
  // notice should allocate the adjacent transcript pane.
  const showSidecar = live || savedAccessNotice !== null
  const activityRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const deliveredTopRef = useRef(0)

  // The sidecar is an independent scrollport. The outer ChatView's bottom
  // follower cannot follow streamed messages inside this nested overflow pane.
  useEffect(() => {
    if (!live) return
    const scrollport = activityRef.current
    if (scrollport === null) return
    const followLatest = (): void => {
      if (!followingRef.current) return
      scrollport.scrollTop = scrollport.scrollHeight
      deliveredTopRef.current = scrollport.scrollTop
    }
    const onScroll = (): void => {
      const floor = Math.max(0, scrollport.scrollHeight - scrollport.clientHeight)
      const movedByReader = Math.abs(scrollport.scrollTop - Math.min(deliveredTopRef.current, floor)) > 0.5
      if (movedByReader) {
        const atTail = isAtActivityTail(scrollport.scrollTop, scrollport.scrollHeight, scrollport.clientHeight)
        followingRef.current = atTail
        setFollowing(atTail)
      }
      deliveredTopRef.current = scrollport.scrollTop
    }
    scrollport.addEventListener('scroll', onScroll, { passive: true })
    // Character-data updates matter: streaming often extends an existing
    // assistant bubble without appending a new keyed React message.
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(followLatest)
    mutations?.observe(scrollport, { childList: true, subtree: true, characterData: true })
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(followLatest)
    resize?.observe(scrollport)
    followLatest()
    return () => {
      mutations?.disconnect()
      resize?.disconnect()
      scrollport.removeEventListener('scroll', onScroll)
    }
  }, [live])

  const returnToLatest = (): void => {
    const scrollport = activityRef.current
    if (scrollport === null) return
    followingRef.current = true
    setFollowing(true)
    scrollport.scrollTop = scrollport.scrollHeight
    deliveredTopRef.current = scrollport.scrollTop
  }

  return (
    <div className={css.browserWorkspace} data-browser-workspace={live ? '' : undefined}
      data-activity-open={showSidecar ? 'true' : undefined} data-chat-flow-kind="browser-workspace">
      <div className={css.browserPane}>
        <MiniBrowser key={sessionId} sessionId={sessionId} requested active={selected}
          {...live && sourceUrl !== undefined ? { sourceUrl } : {}}
          {...tabId === undefined ? {} : { initialTabId: tabId }}
          onActivate={onActivate} autoScroll={false} onPageChange={setPage}
          onSecureLoginRequest={handleSecureRequest} onSavedAccessNotice={handleSavedAccessNotice}
          secureLoginRequestEpoch={secureRequestEpoch} />
        {secureRequest !== null && <SecureAsk key={secureRequest.origin + ':' + secureRequest.tabId}
          target={secureRequest}
          onClose={dismissSecureRequest}
          onSaved={dismissSecureRequest} />}
      </div>
      {showSidecar && <aside className={css.activityPane} aria-label="Actividad del agente">
        <header className={css.activityHeader}>
          <strong>Actividad del agente</strong>
          <span className={css.livePill}><span aria-hidden="true" /> En vivo</span>
        </header>
        {sourceUrl !== undefined && live && (
          <div className={css.pageInfo} role="status">
            <span className={css.pageCaption}>Fuente de investigación</span>
            <span>La fuente consultada por fetch se abre por separado en Chromium. La vista no sustituye ni confirma el resultado de fetch.</span>
          </div>
        )}
        {page !== null && (
          <div className={css.pageInfo}>
            <span className={css.pageCaption}>Pestaña en uso</span>
            <strong title={page.title}>{page.title || 'Página actual'}</strong>
            <span className={css.pageUrl} title={page.url}>{page.url}</span>
          </div>
        )}
        {savedAccessNotice !== null && <div className={css.pageInfo} role="status" aria-live="polite">
          <strong>Kira · Acceso guardado</strong>
          <span>{savedAccessNotice.phase === 'using'
            ? 'Ya tengo un acceso registrado para ' + savedAccessNotice.origin + '. Voy a utilizarlo para iniciar sesión y comprobaré si la página confirma el acceso.'
            : savedAccessNotice.phase === 'available'
              ? 'Ya existe un acceso cifrado para ' + savedAccessNotice.origin + '. Lo conservaré y, cuando la página lo requiera, podré utilizarlo con la autorización correspondiente.'
              : savedAccessNotice.phase === 'related'
                ? 'Encontré un acceso cifrado de un módulo relacionado. La página principal utiliza otro dominio. Puedes autorizar su reutilización desde Acceso seguro sin escribir de nuevo la contraseña.'
                : savedAccessNotice.phase === 'vault-unavailable'
                  ? 'No pude consultar los accesos guardados para ' + savedAccessNotice.origin + '. No te pediré las credenciales otra vez hasta recuperar la bóveda.'
                  : 'Tengo un acceso registrado para ' + savedAccessNotice.origin + ', pero no puedo confirmar el inicio de sesión. Puedes revisar el acceso guardado.'}</span>
        </div>}
        <div ref={activityRef} className={css.activityMessages} aria-live="polite" aria-relevant="additions text">
          {items.map(item => (
            <Fragment key={item.key}>
              {item.kind === 'node'
                ? <ChatNodeSeat nodeKey={item.key} {...seatProps} />
                : item.kind === 'activity'
                  ? <ToolActivityGroup items={item.items} anchorKey={item.anchorKey} {...seatProps} />
                  : item.kind === 'images'
                    ? <div data-chat-flow-kind="generated-image">
                      {seatProps.renderMessageImages({ images: item.images, align: 'start' })}
                    </div>
                    : item.kind === 'optimistic'
                      ? <PendingSteeringBubble
                        content={[{ type: 'text', text: item.text }]}
                        renderMessageImages={seatProps.renderMessageImages}
                        t={seatProps.t}
                      />
                      : null}
            </Fragment>
          ))}
          {turnStatus?.progress != null && (
            <TurnStatus startTime={turnStatus.startTime} progress={turnStatus.progress}
              expiresAfterMs={turnStatus.expiresAfterMs} t={seatProps.t} />
          )}
        </div>
        {!following && <button type="button" className={css.followLatest}
          onClick={returnToLatest} aria-label="Ir a la última conversación de Kira">
          ↓ Ir a lo más reciente
        </button>}
      </aside>}
    </div>
  )
}

/**
 * Render ordered chat nodes while collapsing model-internal/tool activity into one disclosure.
 * Visible assistant prose precedes its technical activity, and the running status precedes a trailing Tools group.
 * An ordinary locally admitted send stays at its send-time transcript boundary until its durable user/steering node arrives.
 * Running Tool rows stay live above the disclosure and join history once settled.
 * @param props - Ordered nodes plus the ordinary ChatNodeSeat owner/runtime props.
 * @returns The grouped transcript flow.
 */
export function ToolActivityFlow({ nodes, optimisticSubmit, turnStatus, browserTurnOpen, sessionId, ...seatProps }: ToolActivityFlowProps) {
  const ordinaryFlow = useMemo(() => addDesktopCards(addBrowserCards(buildAnchoredFlow(nodes, optimisticSubmit), nodes), nodes), [nodes, optimisticSubmit])
  const browserKeys = ordinaryFlow.filter(item => item.kind === 'browser').map(item => item.userKey)
  const [selectedBrowserKey, setSelectedBrowserKey] = useState<string | undefined>()
  const newestBrowserKey = browserKeys.at(-1)
  const [lastBrowserKey, setLastBrowserKey] = useState<string | undefined>()
  useEffect(() => {
    if (newestBrowserKey !== lastBrowserKey) {
      setLastBrowserKey(newestBrowserKey)
      setSelectedBrowserKey(newestBrowserKey)
    }
  }, [newestBrowserKey, lastBrowserKey])
  const activeBrowserKey = selectedBrowserKey ?? newestBrowserKey
  const latestDesktopKey = ordinaryFlow.filter(item => item.kind === 'desktop').at(-1)?.key
  const browserTurnRunning = browserTurnOpen ?? (turnStatus?.progress != null)
  const flow = useMemo(() => {
    const grouped = browserTurnRunning && newestBrowserKey !== undefined
      ? groupActiveBrowserFlow(ordinaryFlow, newestBrowserKey, nodes)
      : ordinaryFlow
    // Keep every browser mounted under the SAME React key as the sidecar opens
    // and closes. Changing layouts must never recreate the CDP tab/session.
    return grouped.map(item => item.kind === 'browser'
      ? { kind: 'browser-workspace' as const, key: 'browser-workspace:' + item.userKey,
        userKey: item.userKey, ...(item.tabId === undefined ? {} : { tabId: item.tabId }),
        ...(item.sourceUrl === undefined ? {} : { sourceUrl: item.sourceUrl }), live: false, items: [] }
      : item)
  }, [ordinaryFlow, newestBrowserKey, nodes, browserTurnRunning])
  const hasBrowserWorkspace = flow.some(item => item.kind === 'browser-workspace' && item.live)
  // The screenshot-like centered preparation state is confined to a blank
  // conversation's first pending answer, never to a continuing transcript.
  const centeredPreparing = turnStatus?.progress?.phase === 'preparing'
    && nodes.filter(node => node.kind === 'user' || node.kind === 'steering').length <= 1
    && !nodes.some((node) => {
      const assistant = assistantData(node)
      return node.kind === 'hardness-artifact'
        || (assistant !== null && hasAssistantSurface(assistant))
    })
    && (nodes.some(node => node.kind === 'user' || node.kind === 'steering')
      || flow.some(item => item.kind === 'optimistic'))
  const statusBeforeIndex = turnStatus === undefined || flow.at(-1)?.kind !== 'activity'
    ? -1
    : flow.length - 1
  return (
    <>
      {flow.map((item, index) => (
        <Fragment key={sessionId + ':' + item.key}>
          {!hasBrowserWorkspace && turnStatus !== undefined && turnStatus.progress !== null && index === statusBeforeIndex && (
            <TurnStatus
              startTime={turnStatus.startTime}
              progress={turnStatus.progress}
              expiresAfterMs={turnStatus.expiresAfterMs}
              centered={centeredPreparing}
              t={seatProps.t}
            />
          )}
          {item.kind === 'desktop'
            ? <DesktopLive sessionId={sessionId} active={item.key === latestDesktopKey} />
            : item.kind === 'browser-workspace'
            ? <BrowserWorkspace
              sessionId={sessionId}
              live={item.live}
              items={item.items}
              {...item.tabId === undefined ? {} : { tabId: item.tabId }}
              {...item.sourceUrl === undefined ? {} : { sourceUrl: item.sourceUrl }}
              selected={item.userKey === activeBrowserKey}
              onActivate={() => { setSelectedBrowserKey(item.userKey) }}
              seatProps={seatProps}
              turnStatus={turnStatus}
            />
            : item.kind === 'node'
              ? <ChatNodeSeat nodeKey={item.key} {...seatProps} />
              : item.kind === 'optimistic'
                ? (
                  <PendingSteeringBubble
                    content={[{ type: 'text', text: item.text }]}
                    renderMessageImages={seatProps.renderMessageImages}
                    t={seatProps.t}
                  />
                )
                : item.kind === 'images'
                  ? (
                    <div data-chat-flow-kind="generated-image">
                      {seatProps.renderMessageImages({ images: item.images, align: 'start' })}
                    </div>
                  )
                  : (
                    <ToolActivityGroup
                      items={item.items}
                      anchorKey={item.anchorKey}
                      {...seatProps}
                    />
                  )}
        </Fragment>
      ))}
      {!hasBrowserWorkspace && turnStatus !== undefined && turnStatus.progress !== null && statusBeforeIndex === -1 && (
        <TurnStatus
          startTime={turnStatus.startTime}
          progress={turnStatus.progress}
          expiresAfterMs={turnStatus.expiresAfterMs}
          centered={centeredPreparing}
          t={seatProps.t}
        />
      )}
    </>
  )
}
