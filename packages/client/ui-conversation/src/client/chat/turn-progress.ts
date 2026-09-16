import type {
  ChatConversationViewNode, ConversationTimelineSnapshot, RunningToolCall, ToolCallBlock,
} from '@phoenix-ai/dsh-client-runtime/client'
import type { AssistantChatData, ToolChatData } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

/** High-level lifecycle label shown to the user. */
export type TurnPhase = 'preparing' | 'thinking' | 'running-tools' | 'verifying'

/** Visual activity used by the PHOENIX emblem. Every value comes from observed runtime state. */
export type TurnActivity =
  | 'preparing'
  | 'thinking'
  | 'searching'
  | 'browsing'
  | 'reading'
  | 'writing'
  | 'executing'
  | 'running-tools'
  | 'verifying'

/** Compact, truthful progress for the currently open turn. */
export interface TurnProgress {
  readonly phase: TurnPhase
  readonly activity: TurnActivity
  /** Current tool identity. Arguments/results are intentionally never surfaced here. */
  readonly detail?: string
}

const TOOL_ACTIVITY_MATCHERS: readonly (readonly [TurnActivity, RegExp])[] = [
  ['verifying', /\b(vitest|test|tests|verify|verification|validate|validation|lint|typecheck|check)\b/],
  // Search wins before generic `web`, so web_search reports searching while browser_open stays browsing.
  ['searching', /\b(glob|grep|find|search|lookup|list files|scan)\b/],
  ['browsing', /\b(web|browser|url|http|https)\b/],
  ['reading', /\b(read|reader|fetch file|get file|open file|cat)\b/],
  ['writing', /\b(write|edit|patch|apply patch|create file|update file|delete file|move file|rename file)\b/],
  ['executing', /\b(bash|shell|terminal|exec|execute|run|command|powershell|spawn|npm|pnpm|node)\b/],
]

/** Classify only the tool name; never infer activity from private arguments or output. */
function toolActivity(name: string): TurnActivity {
  const normalized = name.toLowerCase().replace(/[_.:/-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return TOOL_ACTIVITY_MATCHERS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? 'running-tools'
}

/** Prefer the most recently started running child so Code Dispatch reports the work actually in flight. */
function latestRunningTool(block: ToolCallBlock): RunningToolCall | null {
  let latest = isRunningTool(block) ? block : null
  for (const child of block.subCalls) {
    const candidate = latestRunningTool(child)
    if (candidate !== null && (latest === null || candidate.time >= latest.time)) latest = candidate
  }
  return latest
}

function toolProgress(tool: RunningToolCall): TurnProgress {
  const activity = toolActivity(tool.name)
  return {
    phase: activity === 'verifying' ? 'verifying' : 'running-tools',
    activity,
    detail: tool.name,
  }
}

/**
 * Derive a safe progress label from the existing chat projection.
 * Tool arguments and result payloads are intentionally never inspected.
 * @param timeline - current conversation timeline snapshot.
 * @param nodes - visible conversation nodes to classify.
 * @returns the current safe phase, or null when no turn is open.
 */
export function turnProgress(
  timeline: ConversationTimelineSnapshot,
  nodes: readonly ChatConversationViewNode[],
): TurnProgress | null {
  const turn = [...timeline.turns.values()].find(candidate => candidate.status === 'open')
  if (turn === undefined) return null

  const stepNodes = nodes.filter(node => node.location.kind === 'step'
    && node.location.turn.turn === turn.turn)
  const tools = stepNodes.filter(node => node.kind === 'tool-call')

  let runningTool: RunningToolCall | null = null
  for (const node of tools) {
    const candidate = latestRunningTool((node.data as ToolChatData).root)
    if (candidate !== null && (runningTool === null || candidate.time >= runningTool.time)) {
      runningTool = candidate
    }
  }
  if (runningTool !== null) return toolProgress(runningTool)

  const assistant = [...stepNodes].reverse().find(node => node.kind === 'assistant-step')
  if (assistant !== undefined) {
    const data = assistant.data as AssistantChatData
    const lastBlock = data.blocks.at(-1)
    if (data.status === 'running' && lastBlock?.kind === 'reasoning') {
      return { phase: 'thinking', activity: 'thinking' }
    }
  }

  if (tools.length > 0) return { phase: 'verifying', activity: 'verifying' }
  return { phase: 'preparing', activity: 'preparing' }
}
