import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { chatNode } from './common.ts'

/** Serializable payload accepted by the conversation-native HARDNESS artifact node. */
export type HardnessArtifactValue = string | Readonly<Record<string, unknown>>

/** Durable chat data projected from one settled Tool result artifact. */
export interface HardnessArtifactChatData {
  readonly artifactId: string
  readonly callId: string
  readonly mime: string
  readonly title: string
  readonly data: HardnessArtifactValue
  readonly seq: number
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** HARDNESS/tool artifact rendered as a conversation-native inline card. */
    'hardness-artifact': HardnessArtifactChatData
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function artifactFrom(match: ConversationMatch): HardnessArtifactChatData | undefined {
  if (match.event.type !== 'tool/result' || !isAppendSurfaceEvent(match.event)) return undefined
  const meta = match.event.data.meta
  if (!isRecord(meta) || !isRecord(meta.artifact)) return undefined
  const artifact = meta.artifact
  if (typeof artifact.id !== 'string' || artifact.id.trim() === '') return undefined
  if (typeof artifact.mime !== 'string' || artifact.mime.trim() === '') return undefined
  if (typeof artifact.data !== 'string' && !isRecord(artifact.data)) return undefined
  const title = typeof artifact.title === 'string' && artifact.title.trim() !== ''
    ? artifact.title.trim()
    : isRecord(artifact.data) && typeof artifact.data.title === 'string' && artifact.data.title.trim() !== ''
      ? artifact.data.title.trim()
      : 'HARDNESS result'
  return {
    artifactId: artifact.id,
    callId: String(match.event.data.message.source.callId),
    mime: artifact.mime,
    title,
    data: artifact.data,
    seq: match.event.seq,
    time: match.event.time,
  }
}

function fallbackState(context: ConversationNodeContext<HardnessArtifactChatData>): HardnessArtifactChatData | undefined {
  for (const match of context.matches) {
    const artifact = artifactFrom(match)
    if (artifact !== undefined) return artifact
  }
  return undefined
}

/** One durable inline artifact emitted by a settled Tool result. */
export const hardnessArtifactDefinition: ConversationNodeDefinition<HardnessArtifactChatData> = {
  kind: 'hardness-artifact',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) return null
    const meta = event.data.meta
    if (!isRecord(meta) || !isRecord(meta.artifact)) return null
    const artifactId = meta.artifact.id
    if (typeof artifactId !== 'string' || artifactId.trim() === '') return null
    return {
      id: `${String(event.data.message.source.callId)}:${artifactId}`,
      role: 'start',
    }
  },
  start: (_context, match) => {
    const artifact = artifactFrom(match)
    if (artifact === undefined) throw new Error('hardness-artifact start requires valid tool/result meta.artifact')
    return artifact
  },
  buildViewNode: (context) => {
    const artifact = context.state ?? fallbackState(context)
    if (artifact === undefined) return null
    return chatNode(context, 'hardness-artifact', artifact.seq + 0.01, artifact)
  },
}

/**
 * Register the HARDNESS artifact projection with the conversation event assembler.
 * @param ctx - Owning UI Conversation Cordis context.
 */
export function registerHardnessArtifactConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(hardnessArtifactDefinition)
}
