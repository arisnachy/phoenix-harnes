import type { Context } from '@phoenix-ai/cordis'
import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@phoenix-ai/dsh-client-runtime/client'
import type { SessionEvent } from '@phoenix-ai/dsh-session/types'
import { chatNode } from './common.ts'

/** Serializable payload accepted by the conversation-native HARDNESS artifact node. */
export type HardnessArtifactValue = string | Readonly<Record<string, unknown>>

/** Renderer-neutral kind selected from a MIME type and optional execution hint. */
export type ArtifactKind = 'json' | 'table' | 'html' | 'code' | 'markdown' | 'text' | 'image' | 'execution'

/** One artifact envelope shared by inline chat, workspace previews, and execution controls. */
export interface UniversalArtifactEnvelope {
  readonly id: string
  readonly title: string
  readonly kind: ArtifactKind
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly language?: string
  readonly executable: boolean
  readonly sourceArtifactId?: string
  readonly size: { readonly minHeight: number; readonly maxHeight: number }
  readonly result?: Readonly<Record<string, unknown>>
}

/** Select a stable renderer kind without inspecting executable content. */
function artifactKind(mime: string, data: HardnessArtifactValue): ArtifactKind {
  if (mime === 'text/html' || mime === 'application/vnd.hardness.app+html') return 'html'
  if (mime.startsWith('image/')) return 'image'
  if (mime.includes('json')) {
    if (typeof data !== 'string' && Array.isArray(data.columns) && Array.isArray(data.rows)) return 'table'
    return 'json'
  }
  if (mime.includes('markdown')) return 'markdown'
  if (mime.includes('python') || mime.includes('javascript') || mime.includes('typescript') || mime.includes('css')) return 'code'
  if (mime.startsWith('text/')) return 'text'
  return 'execution'
}

/**
 * Normalize a raw artifact into the single surface's serializable envelope.
 * @param input - Raw artifact data from a governed tool result.
 * @returns The serializable universal artifact envelope.
 */
export function normalizeHardnessArtifact(input: {
  readonly id: string
  readonly title: string
  readonly mime: string
  readonly data: HardnessArtifactValue
  readonly executable?: boolean
  readonly language?: string
  readonly sourceArtifactId?: string
  readonly result?: Readonly<Record<string, unknown>>
}): UniversalArtifactEnvelope {
  const kind = artifactKind(input.mime, input.data)
  const language = input.language
    ?? (input.mime.includes('python') ? 'python'
      : input.mime.includes('javascript') ? 'javascript'
        : input.mime.includes('typescript') ? 'typescript'
          : input.mime.includes('css') ? 'css' : undefined)
  return {
    id: input.id,
    title: input.title,
    kind,
    mime: input.mime,
    data: input.data,
    ...language === undefined ? {} : { language },
    executable: input.executable ?? (kind === 'html' || kind === 'code'),
    ...input.sourceArtifactId === undefined ? {} : { sourceArtifactId: input.sourceArtifactId },
    size: { minHeight: 160, maxHeight: 640 },
    ...input.result === undefined ? {} : { result: input.result },
  }
}

/**
 * Clamp measured content to the surface's safe responsive range.
 * @param height - Measured content height.
 * @param size - Minimum and maximum surface dimensions.
 * @returns The bounded display height.
 */
export function clampArtifactHeight(height: number, size: UniversalArtifactEnvelope['size']): number {
  return Math.round(Math.max(size.minHeight, Math.min(size.maxHeight, Number.isFinite(height) ? height : size.minHeight)))
}

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
    executable: artifact.executable === true,
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
