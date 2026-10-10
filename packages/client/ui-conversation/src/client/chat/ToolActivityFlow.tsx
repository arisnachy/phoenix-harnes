import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ComponentProps } from 'react'
import type { ImageAttachmentRef } from '@phoenix-ai/dsh-attachment'
import { PhoenixLogo } from '@phoenix-ai/dsh-client-ui-primitives'
import type { AssistantChatData, ToolChatData } from '../contract/chat-nodes.ts'
import { isRunningTool, isSettledTool } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { formatRunDuration } from './message-chrome.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { MiniBrowser } from './MiniBrowser.tsx'
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
  readonly nodes: readonly OrderedChatNode[]
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
  | { readonly kind: 'browser'; readonly key: string; readonly userKey: string }
  | { readonly kind: 'game-reopen'; readonly key: string; readonly gameNodeKey?: string }
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
  const verb = /\b(?:abre|abres|abrir|abreme|abrirme|navega|navegas|navegar|entra|entras|entrar|ingresa|ingresas|ingresar|visita|visitas|visitar|accede|accedes|acceder|open|browse|visit)\b/u
  const target = /\b(?:ir a|ve a|busca en|buscar en)\b|https?:\/\//u
  const webContext = /\b(?:pagina|web|sitio|portal|navegador|website|internet|url|enlace)\b|https?:\/\//u
  // "abre el archivo" is not browser navigation; a web context overrides it.
  const localObject = /\b(?:archivo|carpeta|documento|pdf|chat|conversacion|configuracion|terminal|proyecto|aplicacion|app)\b/u
  if (/\b(?:no|nunca)\s+(?:abras|abres|abrir|entres|entrar|navegues|navegar|visites|visitar)\b/u.test(normalized)) return false
  return target.test(normalized) || (verb.test(normalized) && (webContext.test(normalized) || !localObject.test(normalized)))
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
  const requests = nodes.filter(isBrowserRequest)
  if (requests.length === 0 && !flow.some(item => item.kind === 'optimistic' && isBrowserPrompt(item.text))) return flow
  const result: FlowItem[] = []
  let pendingUserKey: string | undefined
  const byKey = new Set(requests.map(n => n.key))
  const userKeys = new Set(nodes.filter(n => n.kind === 'user' || n.kind === 'steering').map(n => n.key))
  const finish = (): void => {
    if (pendingUserKey !== undefined) {
      result.push({ kind: 'browser', key: 'browser:' + pendingUserKey, userKey: pendingUserKey })
      pendingUserKey = undefined
    }
  }
  for (const item of flow) {
    // A new user turn begins after all content from the preceding turn.
    if (item.kind === 'node' && userKeys.has(item.key)) {
      finish()
      if (byKey.has(item.key)) pendingUserKey = item.key
    } else if (item.kind === 'optimistic') {
      finish()
      if (isBrowserPrompt(item.text)) pendingUserKey = item.key
    }
    result.push(item)
  }
  finish()
  return result
}

/** A return-to-game gesture is not a request for an image or a text-only link. */
export function isGameReopenPrompt(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()
  if (/\b(?:no|nunca)\s+(?:abras|abrir|muestres|mostrar|juegues|jugar)\b/u.test(normalized)) return false
  const action = /\b(?:abre|abrir|abreme|muestra|muestrame|mostrar|ensena|ensename|ver|verlo|verla|veamos|dejame|jugar|juguemos|juego|play|open|show)\b/u
  const game = /\b(?:juego|juegos|videojuego|videojuegos|game|games|game studio|pac[\s-]?man|tetris|snake|pong|arkanoid|contra|minecraft|sudoku|ajedrez)\b/u
  return action.test(normalized) && game.test(normalized)
}

function userText(node: OrderedChatNode): string {
  if (node.kind !== 'user' && node.kind !== 'steering') return ''
  const content = (node.data as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content.map((block: unknown) => {
    if (typeof block !== 'object' || block === null) return ''
    const item = block as { type?: unknown; text?: unknown }
    return item.type === 'text' && typeof item.text === 'string' ? item.text : ''
  }).join('')
}

function gameArtifact(node: OrderedChatNode): { key: string; title: string } | undefined {
  if (node.kind !== 'hardness-artifact') return undefined
  const data = node.data as { mime?: unknown; title?: unknown; data?: unknown }
  if (data.mime !== 'application/vnd.phoenix.game+html'
    || typeof data.title !== 'string' || typeof data.data !== 'string' || data.data.trim() === '') return undefined
  return { key: node.key, title: data.title }
}

function compactName(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]/gu, '')
}

/** Keep a named game request from silently opening a different existing game. */
function namedGame(text: string): string | undefined {
  const compact = compactName(text)
  return ['pacman', 'tetris', 'snake', 'pong', 'arkanoid', 'contra', 'minecraft', 'sudoku', 'ajedrez']
    .find(name => compact.includes(name))
}

/**
 * An actual previously published HTML game can be mounted again next to the
 * follow-up user gesture. Never synthesize a playable artifact from Kira's
 * prose, and never say "scroll up" for an absent game.
 *
 * If this same turn already produced a new game, its original durable
 * artifact renderer is used instead (avoid two copies of a live game).
 */
export function addGameReopenCards(
  flow: FlowItem[],
  nodes: readonly OrderedChatNode[],
): FlowItem[] {
  const indexByKey = new Map(nodes.map((node, i) => [node.key, i]))
  const output: FlowItem[] = []
  for (const item of flow) {
    output.push(item)
    const text = item.kind === 'optimistic'
      ? item.text
      : item.kind === 'node'
        ? userText(nodes[indexByKey.get(item.key) ?? -1] ?? { key: '', kind: '', data: null })
        : ''
    if (!isGameReopenPrompt(text)) continue
    const index = item.kind === 'optimistic' ? nodes.length : (indexByKey.get(item.key) ?? -1)
    if (index < 0) continue
    const nextUserOffset = nodes.slice(index + 1)
      .findIndex(node => node.kind === 'user' || node.kind === 'steering')
    const nextUser = nextUserOffset < 0 ? nodes.length : index + 1 + nextUserOffset
    if (nodes.slice(index + 1, nextUser).some(node => gameArtifact(node) !== undefined)) continue
    const previous = nodes.slice(0, index).flatMap(node => {
      const game = gameArtifact(node)
      return game === undefined ? [] : [game]
    })
    const name = namedGame(text)
    const matching = name === undefined ? previous
      : previous.filter(game => compactName(game.title).includes(name))
    output.push({
      kind: 'game-reopen',
      key: 'game-reopen:' + item.key,
      ...matching.at(-1) === undefined ? {} : { gameNodeKey: matching.at(-1)?.key },
    })
  }
  return output
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
function TurnStatus({ startTime, progress, expiresAfterMs, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  readonly startTime: number | null
  /** Safe phase and activity derived from the current chat projection. */
  readonly progress: TurnProgress
  /** Optional age ceiling for admission-only feedback. */
  readonly expiresAfterMs: number | null
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
 * Render ordered chat nodes while collapsing model-internal/tool activity into one disclosure.
 * Visible assistant prose precedes its technical activity, and the running status precedes a trailing Tools group.
 * An ordinary locally admitted send stays at its send-time transcript boundary until its durable user/steering node arrives.
 * Running Tool rows stay live above the disclosure and join history once settled.
 * @param props - Ordered nodes plus the ordinary ChatNodeSeat owner/runtime props.
 * @returns The grouped transcript flow.
 */
export function ToolActivityFlow({ nodes, optimisticSubmit, turnStatus, ...seatProps }: ToolActivityFlowProps) {
  const flow = useMemo(() => addGameReopenCards(addBrowserCards(buildAnchoredFlow(nodes, optimisticSubmit), nodes), nodes), [nodes, optimisticSubmit])
  const browserKeys = flow.filter(item => item.kind === 'browser').map(item => item.userKey)
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
  const statusBeforeIndex = turnStatus === undefined || flow.at(-1)?.kind !== 'activity'
    ? -1
    : flow.length - 1
  return (
    <>
      {flow.map((item, index) => (
        <Fragment key={item.key}>
          {turnStatus !== undefined && turnStatus.progress !== null && index === statusBeforeIndex && (
            <TurnStatus
              startTime={turnStatus.startTime}
              progress={turnStatus.progress}
              expiresAfterMs={turnStatus.expiresAfterMs}
              t={seatProps.t}
            />
          )}
          {item.kind === 'game-reopen'
            ? item.gameNodeKey === undefined
              ? <p role="status" className={chatCss.hint} data-phoenix-game-unavailable="true">
                  No hay un juego ejecutable publicado entre los mensajes disponibles. Kira debe publicarlo mediante phoenix_game; una respuesta de texto no abre el juego.
                </p>
              : <div data-phoenix-game-reopened="true">
                  <ChatNodeSeat nodeKey={item.gameNodeKey} {...seatProps} />
                </div>
            : item.kind === 'browser'
            ? <MiniBrowser
              requested
              active={item.userKey === activeBrowserKey}
              onActivate={() => { setSelectedBrowserKey(item.userKey) }}
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
      {turnStatus !== undefined && turnStatus.progress !== null && statusBeforeIndex === -1 && (
        <TurnStatus
          startTime={turnStatus.startTime}
          progress={turnStatus.progress}
          expiresAfterMs={turnStatus.expiresAfterMs}
          t={seatProps.t}
        />
      )}
    </>
  )
}
