/** Runtime wiring for PHOENIX Cognitive Memory v2. */

import type { Context } from '@phoenix-ai/cordis'
import type { CognitiveMemoryLayer } from '@phoenix-ai/dsh-session-learning'
import type {} from '@phoenix-ai/dsh-system-prompt'
import { EpisodicMissionRecorder } from './episodic.ts'
import { formatDirectedMemoryContext } from './episodic-presentation.ts'
import { resolveMemoryIntent } from './memory-intent.ts'

/**
 * Install durable mission capture and intent-aware directed recall on one Cordis context.
 * @param ctx - Runtime context that owns sessions, cognitive memory, and the system prompt.
 */
export function installCognitiveMemoryV2(ctx: Context): void {
  const recorder = new EpisodicMissionRecorder({
    async remember(input) {
      await ctx.learningMemory.rememberCognitive(input)
    },
  })
  let latestUserMessage = ''

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const eventType = String(event.type)
    const data = event.data as unknown
    const eventSeq = typeof event.seq === 'number' ? event.seq : 0
    const occurredAt = typeof event.time === 'number' ? event.time : Date.now()
    const projectId = projectIdFromSession(session)

    if (eventType === 'user/message') {
      const text = messageText(data)
      if (text === undefined) return
      latestUserMessage = text
      recorder.observeUserMessage(sessionId, text, {
        occurredAt,
        ...projectId === undefined ? {} : { projectId },
      })
      return
    }

    if (eventType === 'tool/call' && isRecord(data) && typeof data.name === 'string') {
      recorder.observeToolCall(sessionId, data.name, data.arguments)
      return
    }

    if (eventType === 'tool/result') {
      recorder.observeToolResult(sessionId, data, toolResultIsError(data))
      return
    }

    if (eventType === 'goal/change' && isRecord(data)) {
      if (data.operation === 'complete') {
        void recorder.complete(sessionId, {
          eventSeq,
          occurredAt,
          verified: true,
          outcome: 'Phoenix reached verified goal completion through the configured fail-closed completion path.',
        }).catch(error => ctx.logger.warn(`episodic-memory: ignored verified completion in ${sessionId}: ${String(error)}`))
        return
      }
      if (data.operation === 'clear') {
        recorder.clear(sessionId)
        return
      }
    }

    if (eventType !== 'turn/end' || !isRecord(data) || !isRecord(data.reason)) return
    if (data.reason.kind === 'error') {
      void recorder.complete(sessionId, {
        eventSeq,
        occurredAt,
        verified: false,
        outcome: `Mission ended with an error: ${errorText(data.reason.error)}`,
      }).catch(error => ctx.logger.warn(`episodic-memory: ignored failed completion in ${sessionId}: ${String(error)}`))
      return
    }
    if (data.reason.kind === 'completed') {
      void recorder.complete(sessionId, {
        eventSeq,
        occurredAt,
        verified: false,
        outcome: 'Conversation turn completed without an explicit verified goal-completion event.',
      }).catch(error => ctx.logger.warn(`episodic-memory: ignored unverified completion in ${sessionId}: ${String(error)}`))
    }
  })

  ctx.systemPrompt.context({
    name: 'context:directed-memory-v2',
    order: 116,
    text: () => {
      if (latestUserMessage === '') return ''
      const now = Date.now()
      const intent = resolveMemoryIntent(latestUserMessage, {
        now,
        timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      })
      if (intent.kind === 'ordinary') return ''

      const filters: {
        includeCrossProject?: boolean
        layers?: readonly CognitiveMemoryLayer[]
        from?: number
        to?: number
        includeHistory?: boolean
      } = {
        includeCrossProject: intent.crossProject,
        includeHistory: false,
      }
      if (intent.layers.length > 0) filters.layers = intent.layers
      if (intent.from !== undefined) filters.from = intent.from
      if (intent.to !== undefined) filters.to = intent.to

      const hits = ctx.learningMemory.searchCognitive('', 128, filters)
      return formatDirectedMemoryContext(intent, hits)
    },
    interpolateVariables: false,
  })
}

function projectIdFromSession(session: unknown): string | undefined {
  if (!isRecord(session) || !isRecord(session.header)) return undefined
  const cwd = session.header.cwd
  if (typeof cwd === 'string' && cwd.trim() !== '') {
    const parts = cwd.replace(/\\/gu, '/').split('/').filter(Boolean)
    const project = parts.at(-1)?.trim()
    if (project !== undefined && project !== '') return project.slice(0, 256)
  }
  const preset = session.header.agentPreset
  return typeof preset === 'string' && preset.trim() !== '' ? preset.trim().slice(0, 256) : undefined
}

function messageText(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.content)) return undefined
  const parts = data.content.flatMap(part => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
  const text = parts.join(' ').replace(/\s+/gu, ' ').trim()
  return text === '' ? undefined : text
}

function toolResultIsError(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.message) || !Array.isArray(data.message.content)) return false
  return data.message.content.some(part => isRecord(part) && part.isError === true)
}

function errorText(value: unknown): string {
  if (isRecord(value) && typeof value.message === 'string' && value.message.trim() !== '') return sanitize(value.message)
  return sanitize(String(value ?? 'unknown error'))
}

function sanitize(value: string): string {
  return value
    .replace(/bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/gu, '[redacted-token]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 2_048)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
