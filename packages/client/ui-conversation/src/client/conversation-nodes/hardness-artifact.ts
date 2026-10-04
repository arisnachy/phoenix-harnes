import type { Context } from '@phoenix-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@phoenix-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@phoenix-ai/dsh-session/types'
import { chatNode } from './common.ts'

import type { HardnessArtifactValue } from '../artifact.ts'
export { clampArtifactHeight, normalizeHardnessArtifact } from '../artifact.ts'
export type { ArtifactKind, HardnessArtifactValue, UniversalArtifactEnvelope } from '../artifact.ts'

/** Durable chat data projected from one settled Tool result artifact. */
export interface HardnessArtifactChatData {
  readonly artifactId: string
  readonly callId: string
  readonly mime: string
  readonly title: string
  readonly data: HardnessArtifactValue
  readonly executable: boolean
  readonly language?: string
  readonly result?: Readonly<Record<string, unknown>>
  readonly seq: number
  readonly time: number
}

declare module '@phoenix-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** HARDNESS/tool artifact rendered as a conversation-native inline card. */
    'hardness-artifact': HardnessArtifactChatData
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ArtifactExecutionData {
  readonly artifactId: string
  readonly callId: string
  readonly result: Readonly<Record<string, unknown>>
}

/** Read the optional durable execution event without requiring the host adapter package in the UI bundle. */
function artifactExecutionFrom(event: SessionEvent): ArtifactExecutionData | undefined {
  if ((event.type as string) !== 'hardness/artifact' || !isRecord(event.data)) return undefined
  const data = event.data as Record<string, unknown>
  const artifactId = data.artifactId
  const callId = data.callId
  const result = data.result
  if (typeof artifactId !== 'string' || artifactId.trim() === ''
    || typeof callId !== 'string' || callId.trim() === '' || !isRecord(result)) return undefined
  return { artifactId, callId, result }
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
    executable: typeof artifact.executable === 'boolean'
      ? artifact.executable
      : artifact.mime === 'text/html' || artifact.mime === 'application/vnd.hardness.app+html',
    ...typeof artifact.language === 'string' ? { language: artifact.language } : {},
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
    const execution = artifactExecutionFrom(event)
    if (execution !== undefined) {
      return {
        id: `${execution.callId}:${execution.artifactId}`,
        role: 'update',
      }
    }
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) return null
    const meta = event.data.meta
    if (!isRecord(meta) || !isRecord(meta.artifact)) return null
    const artifactId = meta.artifact.id
    if (typeof artifactId !== 'string' || artifactId.trim() === '') return null
    return { id: `${String(event.data.message.source.callId)}:${artifactId}`, role: 'start' }
  },
  start: (_context, match) => {
    const artifact = artifactFrom(match)
    if (artifact === undefined) throw new Error('hardness-artifact start requires valid tool/result meta.artifact')
    return artifact
  },
  update: (context, match) => {
    const execution = artifactExecutionFrom(match.event)
    return execution === undefined ? context.state : { ...context.state, result: execution.result }
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
