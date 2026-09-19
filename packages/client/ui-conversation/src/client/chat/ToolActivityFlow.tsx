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
  readonly optimisticSubmit?: { readonly text: string } | undefined
  readonly turnStatus: {
    readonly startTime: number | null
    readonly progress: TurnProgress | null
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
  | { readonly kind: 'node'; readonly key: string }
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
function TurnStatus({ startTime, progress, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  readonly startTime: number | null
  /** Safe phase and activity derived from the current chat projection. */
  readonly progress: TurnProgress
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
      <span className={chatCss.turnStatusText}>{label}</span>
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
 * Running Tool rows stay live above the disclosure and join history once settled.
 * @param props - Ordered nodes plus the ordinary ChatNodeSeat owner/runtime props.
 * @returns The grouped transcript flow.
 */
export function ToolActivityFlow({ nodes, optimisticSubmit, turnStatus, ...seatProps }: ToolActivityFlowProps) {
  const flow = useMemo(() => buildFlow(nodes), [nodes])
  const hasOptimisticSubmit = optimisticSubmit !== undefined && optimisticSubmit.text !== ''
  const statusBeforeIndex = hasOptimisticSubmit || turnStatus === undefined || flow.at(-1)?.kind !== 'activity'
    ? -1
    : flow.length - 1
  return (
    <>
      {flow.map((item, index) => (
        <Fragment key={item.key}>
          {turnStatus !== undefined && turnStatus.progress !== null && index === statusBeforeIndex && (
            <TurnStatus startTime={turnStatus.startTime} progress={turnStatus.progress} t={seatProps.t} />
          )}
          {item.kind === 'node'
            ? <ChatNodeSeat nodeKey={item.key} {...seatProps} />
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
      {hasOptimisticSubmit && (
        <PendingSteeringBubble
          content={[{ type: 'text', text: optimisticSubmit.text }]}
          renderMessageImages={seatProps.renderMessageImages}
          t={seatProps.t}
        />
      )}
      {turnStatus !== undefined && turnStatus.progress !== null && statusBeforeIndex === -1 && (
        <TurnStatus startTime={turnStatus.startTime} progress={turnStatus.progress} t={seatProps.t} />
      )}
    </>
  )
}
