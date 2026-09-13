import { useMemo, useState } from 'react'
import type { ComponentProps } from 'react'
import type { AssistantChatData, ToolChatData } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './ToolActivityFlow.module.css'

type SeatProps = Omit<ComponentProps<typeof ChatNodeSeat>, 'nodeKey'>

interface OrderedChatNode {
  readonly key: string
  readonly kind: string
  readonly data: unknown
}

interface ToolActivityFlowProps extends SeatProps {
  readonly nodes: readonly OrderedChatNode[]
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
      pending.push(activityNode(node))
      pendingAnchorKey ??= node.key
      continue
    }

    const assistant = assistantData(node)
    if (assistant !== null) {
      const reasoning = reasoningItems(node, assistant)
      if (reasoning.length > 0) pending.push(...reasoning)
      if (hasAssistantSurface(assistant)) {
        flush(node.key)
        flow.push({ kind: 'node', key: node.key })
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

/**
 * Render ordered chat nodes while collapsing model-internal/tool activity into one disclosure.
 * Running Tool rows stay live above the disclosure and join history once settled.
 * @param props - Ordered nodes plus the ordinary ChatNodeSeat owner/runtime props.
 * @returns The grouped transcript flow.
 */
export function ToolActivityFlow({ nodes, ...seatProps }: ToolActivityFlowProps) {
  const flow = useMemo(() => buildFlow(nodes), [nodes])
  return (
    <>
      {flow.map(item => item.kind === 'node'
        ? <ChatNodeSeat key={item.key} nodeKey={item.key} {...seatProps} />
        : (
          <ToolActivityGroup
            key={item.key}
            items={item.items}
            anchorKey={item.anchorKey}
            {...seatProps}
          />
        ))}
    </>
  )
}
