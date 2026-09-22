/**
 * Model-facing memory recall tool for PHOENIX.
 * @module @phoenix-ai/dsh-tool-session-learning
 */

import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'
import type {} from '@phoenix-ai/dsh-session-learning'
import type { CognitiveMemoryLayer } from '@phoenix-ai/dsh-session-learning'
import { filterAdaptiveSearchHits, installAdaptiveLearning } from './adaptive.ts'
import { ExperienceLearningEngine, experienceMemoryInput } from './experience.ts'
import { assessHabitExperience, formatHabitGuidance } from './habit.ts'
import { AutonomousMemoryCurator } from './autonomous-curator.ts'
import { filterProceduralSearchHits, installProceduralLearning } from './procedural.ts'
import { formatProceduralContext } from './procedural-presentation.ts'
import { formatMemorySearchResult, formatRecentMemoryContext } from './presentation.ts'
import { formatResolvedTaskReference, RecentTaskLedger } from './task-reference.ts'

/** Cordis plugin name. */
export const name = 'tool-session-learning'
/** Services required by the model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'learningMemory']

/** Tool configuration. */
export interface Config {
  /** Maximum memories returned by one call. */
  maxResults?: number
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  maxResults: z.number().step(1).min(1).default(20),
})

const MEMORY_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{
    type: 'text' as const,
    text: JSON.stringify(value),
  }],
}

/** Register provenance-aware recall, adaptive outcomes, procedural learning, and autonomous memory curation. */
export function apply(ctx: Context, config: Config): void {
  const maxResults = config.maxResults ?? 20
  if (!Number.isSafeInteger(maxResults) || maxResults < 1) throw new TypeError('maxResults must be a positive safe integer')

  const tasks = new RecentTaskLedger()
  const curator = new AutonomousMemoryCurator({
    async remember(input) {
      await ctx.learningMemory.rememberCognitive({ ...input })
    },
  })
  const experience = new ExperienceLearningEngine()
  void ctx.learningMemory.ready()
    .then(() => { experience.restore(ctx.learningMemory.allCognitiveRecords()) })
    .catch((error: unknown) => {
      ctx.logger.warn(`experience-learning: startup restore degraded: ${String(error)}`)
    })

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const eventType = String(event.type)
    const data = event.data as unknown
    const occurredAt = typeof event.time === 'number' ? event.time : Date.now()
    const eventSeq = typeof event.seq === 'number' ? event.seq : 0
    const projectId = ctx.learningMemory.currentProjectId()

    if (eventType === 'user/message') {
      const text = messageText(data)
      if (text === undefined) return
      tasks.observeUserMessage(sessionId, text, {
        occurredAt,
        ...projectId === undefined ? {} : { projectId },
      })
      if (isDirectUserMessage(data)) {
        experience.beginTask({
          sessionId,
          text,
          occurredAt,
          ...projectId === undefined ? {} : { projectId },
        })
      }
      void curator.observeUserMessage({
        text,
        sessionId,
        eventSeq,
        occurredAt,
        ...projectId === undefined ? {} : { projectId },
      }).catch((error: unknown) => {
        ctx.logger.warn(`autonomous-memory: ignored user message in ${sessionId}: ${String(error)}`)
      })
      return
    }

    if (eventType === 'assistant/message') {
      const usage = assistantUsage(data)
      if (usage !== undefined) experience.observeUsage(sessionId, usage)
      return
    }

    if (eventType === 'tool/call') {
      experience.observeToolCall(sessionId)
      return
    }

    if (eventType === 'tool/result') {
      experience.observeToolResult(sessionId, toolResultFailed(data))
      return
    }

    if (eventType === 'llm/retry-started') {
      experience.observeRetry(sessionId)
      return
    }

    if (eventType === 'goal/change' && isRecord(data) && data.operation === 'clear') {
      experience.clear(sessionId)
      return
    }

    if (eventType === 'goal/change' && isRecord(data) && data.operation === 'complete') {
      tasks.complete(sessionId, occurredAt)
      const learned = experience.completeVerified(sessionId, occurredAt)
      if (learned !== undefined) {
        void ctx.learningMemory.rememberCognitive(experienceMemoryInput(learned, {
          sessionId,
          eventSeq,
          occurredAt,
        })).catch((error: unknown) => {
          ctx.logger.warn(`experience-learning: ignored verified completion in ${sessionId}: ${String(error)}`)
        })
      }
    }
  })

  installAdaptiveLearning(ctx)
  const procedural = installProceduralLearning(ctx, tasks)
  ctx.systemPrompt.section({
    name: 'tool:session-learning',
    order: 115,
    text: 'Phoenix memory is an on-demand evidence source, not a transcript preload. Use memory_search when prior decisions, preferences, failures, procedures, or earlier work materially affect the current task. Apply relevant verified memory silently and never dump private/profile context merely to prove recall. Prefer current explicit user evidence over older memory, keep provenance/confidence in mind, and never store credentials or unverified guesses. Repeated-task learning must preserve the quality floor while reducing time and cost.',
  })
  ctx.systemPrompt.context({
    name: 'context:resolved-task-reference',
    order: 117,
    text: () => formatResolvedTaskReference(tasks.resolvedReference()),
    interpolateVariables: false,
  })
  ctx.systemPrompt.context({
    name: 'context:recent-learning-memory',
    order: 118,
    text: () => {
      const taskContext = tasks.currentTask()
      if (taskContext === undefined) return ''
      const projectId = ctx.learningMemory.currentProjectId()
      const durable = ctx.learningMemory.recallCognitive({
        query: taskContext,
        layers: ['semantic'],
        limit: 8,
        ...projectId === undefined ? {} : { projectId },
      }).slice(0, 3)
      const legacy = explicitRecallCue(taskContext) ? ctx.learningMemory.recall(2) : []
      return formatRecentMemoryContext([...legacy, ...durable])
    },
    interpolateVariables: false,
  })
  ctx.systemPrompt.context({
    name: 'context:experiential-learning-memory',
    order: 119,
    text: () => {
      const projectId = ctx.learningMemory.currentProjectId()
      const taskContext = tasks.currentTask()
      const hits = ctx.learningMemory.recallCognitive({
        query: taskContext ?? '',
        limit: 12,
        ...projectId === undefined ? {} : { projectId },
      })
      const usable = filterProceduralSearchHits(filterAdaptiveSearchHits(hits))
        .filter(hit => hit.record.confidence >= 0.8 && hit.record.importance >= 0.7)
        .slice(0, 3)
      return formatRecentMemoryContext(usable)
    },
    interpolateVariables: false,
  })
  ctx.systemPrompt.context({
    name: 'context:validated-procedures',
    order: 120,
    text: () => {
      const projectId = ctx.learningMemory.currentProjectId()
      const taskContext = tasks.currentTask()
      return formatProceduralContext(procedural.recommend({
        limit: 3,
        ...projectId === undefined ? {} : { projectId },
        ...taskContext === undefined ? {} : { taskContext },
      }))
    },
    interpolateVariables: false,
  })
  ctx.systemPrompt.context({
    name: 'context:habit-guidance',
    order: 121,
    text: () => {
      const taskContext = tasks.currentTask()
      if (taskContext === undefined) return ''
      const projectId = ctx.learningMemory.currentProjectId()
      const matched = experience.matchTask(taskContext, projectId)
      return matched === undefined ? '' : formatHabitGuidance(assessHabitExperience(matched))
    },
    interpolateVariables: false,
  })
  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search Phoenix cognitive memory with bounded provenance, layers, project, temporal, entity, confidence, and validated procedural knowledge.',
    parameters: {
      query: { type: 'string', description: 'Words to find in memory summaries or provenance. Omit to list recent memories.' },
      limit: { type: 'integer', description: 'Optional result count, capped by the configured maximum.' },
      project_id: { type: 'string', description: 'Optional project filter. Automatic recall is scoped to the current project.' },
      layer: { type: 'string', enum: ['autobiographical', 'working', 'episodic', 'semantic', 'procedural', 'prospective', 'associative', 'temporal'], description: 'Optional memory-layer filter.' },
      from: { type: 'integer', description: 'Optional inclusive Unix-millisecond lower bound.' },
      to: { type: 'integer', description: 'Optional inclusive Unix-millisecond upper bound.' },
      include_history: { type: 'boolean', description: 'Include superseded values while preserving their provenance.' },
    },
    output: MEMORY_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args) => {
      const requested = args.limit ?? maxResults
      if (!Number.isSafeInteger(requested) || requested < 1) throw new TypeError('limit must be a positive safe integer')
      const filters: {
        projectId?: string
        layers?: readonly CognitiveMemoryLayer[]
        from?: number
        to?: number
        includeHistory?: boolean
      } = {}
      if (args.project_id !== undefined) filters.projectId = args.project_id
      if (args.layer !== undefined) filters.layers = [args.layer]
      if (args.from !== undefined) filters.from = args.from
      if (args.to !== undefined) filters.to = args.to
      if (args.include_history !== undefined) filters.includeHistory = args.include_history
      const resultLimit = Math.min(requested, maxResults)
      const cognitive = ctx.learningMemory.searchCognitive(args.query ?? '', resultLimit * 4, filters)
      const records = filterProceduralSearchHits(filterAdaptiveSearchHits(cognitive)).slice(0, resultLimit)
      return Promise.resolve(formatMemorySearchResult(records))
    },
    presentCall: args => ({ card: 'generic', title: 'Search memory', kind: 'read', rawInput: args.query ?? '' }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_remember',
    description: 'Persist one bounded Phoenix preference or verified lesson with provenance from the current session.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: ['lesson', 'skill', 'preference'],
        description: 'Memory category; use preference for user choices and lesson or skill for verified learning.',
      },
      summary: { type: 'string', required: true, description: 'Short secret-free statement to retain.' },
      confidence: { type: 'number', description: 'Optional confidence from 0 to 1; defaults to 0.8.' },
    },
    output: MEMORY_OUTPUT,
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      if (execution.agent === undefined) throw new TypeError('memory_remember requires an active agent session')
      const confidence = args.confidence ?? 0.8
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new TypeError('confidence must be between 0 and 1')
      }
      const memory = await ctx.learningMemory.remember({
        sessionId: String(execution.agent.session.id),
        eventSeq: execution.agent.session.seq,
        kind: args.kind,
        summary: args.summary,
        sourceEventType: 'tool/memory_remember',
        confidence,
        occurredAt: Date.now(),
      })
      return formatMemorySearchResult([memory])
    },
    presentCall: args => ({ card: 'generic', title: 'Remember learning', kind: 'other', rawInput: args.summary }),
  }))

  ctx.tools.register(defineTool({
    name: 'memory_teach',
    description: 'Persist an explicit user-taught durable procedure as structured, secret-free procedural knowledge.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short name for the taught rule or procedure.' },
      scope: { type: 'string', required: true, description: 'Project, domain, system, or activity where this procedure applies.' },
      trigger: { type: 'string', required: true, description: 'Condition that should cause Phoenix to recall and apply the procedure.' },
      steps: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Ordered, concrete steps taught by the user. Do not include hidden reasoning or credentials.',
      },
      evidence: { type: 'string', required: true, description: 'Why this is authoritative, normally a concise reference to the user instruction or demonstration.' },
    },
    output: MEMORY_OUTPUT,
    isConcurrencySafe: () => false,
    async execute(args, execution) {
      if (execution.agent === undefined) throw new TypeError('memory_teach requires an active agent session')
      const projectId = ctx.learningMemory.currentProjectId()
      const learned = await procedural.teach({
        title: args.title,
        scope: args.scope,
        trigger: args.trigger,
        steps: args.steps,
        evidence: args.evidence,
        sessionId: String(execution.agent.session.id),
        eventSeq: execution.agent.session.seq,
        occurredAt: Date.now(),
        ...projectId === undefined ? {} : { projectId },
      })
      return JSON.stringify({
        status: learned.status,
        title: learned.title,
        scope: learned.scope,
        trigger: learned.trigger,
        steps: learned.steps,
        confidence: learned.confidence,
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Learn procedure', kind: 'other', rawInput: args.title }),
  }))
}

function explicitRecallCue(text: string): boolean {
  return /\b(previous|prior|last|earlier|before|remember|recall|anterior|previo|últim[oa]|antes|recuerda|recordar|como antes)\b/iu.test(text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageText(data: unknown): string | undefined {
  if (!isRecord(data) || !Array.isArray(data.content)) return undefined
  const parts = data.content.flatMap((part) => isRecord(part) && typeof part.text === 'string' ? [part.text] : [])
  const text = parts.join(' ').replace(/\s+/gu, ' ').trim()
  return text === '' ? undefined : text
}

function isDirectUserMessage(data: unknown): boolean {
  return isRecord(data) && isRecord(data.source) && data.source.kind === 'user'
}

function assistantUsage(data: unknown): {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
} | undefined {
  if (!isRecord(data) || !isRecord(data.usage)) return undefined
  if (typeof data.usage.inputTokens !== 'number' || typeof data.usage.outputTokens !== 'number') return undefined
  return {
    inputTokens: data.usage.inputTokens,
    outputTokens: data.usage.outputTokens,
    ...typeof data.usage.cacheReadTokens === 'number' ? { cacheReadTokens: data.usage.cacheReadTokens } : {},
    ...typeof data.usage.cacheWriteTokens === 'number' ? { cacheWriteTokens: data.usage.cacheWriteTokens } : {},
    ...typeof data.usage.reasoningTokens === 'number' ? { reasoningTokens: data.usage.reasoningTokens } : {},
  }
}

function toolResultFailed(data: unknown): boolean {
  if (!isRecord(data)) return false
  if (data.error !== undefined) return true
  if (!isRecord(data.message) || !Array.isArray(data.message.content)) return false
  return data.message.content.some(part => isRecord(part) && part.type === 'tool-result' && part.isError === true)
}
