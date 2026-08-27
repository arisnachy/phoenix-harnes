import type {
  ChatConversationViewNode, ConversationTimelineSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Compact user-facing phase for the currently open turn. */
export type TurnProgress = 'preparing' | 'running-tools' | 'verifying'

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

  const tools = nodes.filter(node => node.kind === 'tool-call'
    && node.location.kind === 'step'
    && node.location.turn.turn === turn.turn)
  if (tools.length === 0) return 'preparing'

  const hasRunning = tools.some((node) => {
    const root = (node.data as { root?: unknown }).root
    return root !== undefined
      && typeof root === 'object'
      && root !== null
      && !('kind' in root)
  })
  return hasRunning ? 'running-tools' : 'verifying'
}
