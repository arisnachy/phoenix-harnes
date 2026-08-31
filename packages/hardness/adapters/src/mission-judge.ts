/** Independent, read-only structured judge for one HARDNESS mission result. */

import type { Agent } from '@phoenix-ai/dsh-agent'
import type { ContentBlock } from '@phoenix-ai/dsh-llm'
import type { ObjectJsonSchema, ToolRestriction } from '@phoenix-ai/dsh-tools'
import type { SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import type { HardnessMissionJudge, HardnessMissionJudgeInput } from './mission-orchestrator.ts'
import type { MissionJudgeDecision } from './mission-kernel.ts'

/** Structured output required from the independent mission judge. */
export const MISSION_JUDGE_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    required_changes: { type: 'array', items: { type: 'string' } },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['pass', 'fail'] },
          evidence: { type: 'array', items: { type: 'string' } },
          findings: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'verdict', 'evidence', 'findings'],
      },
    },
    quality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        summary: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } },
        findings: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'summary', 'evidence', 'findings'],
    },
  },
  required: ['verdict', 'summary', 'evidence', 'required_changes', 'criteria', 'quality'],
}

/** Read-only tools allowed to inspect mission evidence. */
export const MISSION_JUDGE_READ_ONLY_TOOLS = [
  'read',
  'read_image',
  'glob',
  'grep',
  'session_search',
  'session_event_search',
  'web_search',
  'web_fetch',
] as const

const MAX_TEXT = 2_000
const MAX_ITEMS = 8

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && value.length <= MAX_TEXT
}

function list(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS && value.every(text)
}

function unavailable(summary: string): MissionJudgeDecision {
  return { verdict: 'blocked', summary, evidence: [], requiredChanges: [], criteria: [],
    quality: { verdict: 'fail', summary: 'Judge unavailable', evidence: [], findings: [summary] } }
}

function criterion(value: unknown): MissionJudgeDecision['criteria'][number] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!text(record.id) || !text(record.verdict) || !['pass', 'fail'].includes(record.verdict)
    || !list(record.evidence) || !list(record.findings)) return undefined
  return { id: record.id, verdict: record.verdict as 'pass' | 'fail', evidence: record.evidence, findings: record.findings }
}

function quality(value: unknown): MissionJudgeDecision['quality'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!text(record.verdict) || !['pass', 'fail'].includes(record.verdict) || !text(record.summary)
    || !list(record.evidence) || !list(record.findings)) return undefined
  return { verdict: record.verdict as 'pass' | 'fail', summary: record.summary, evidence: record.evidence, findings: record.findings }
}

function readDecision(value: unknown): MissionJudgeDecision | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!text(record.verdict) || !['pass', 'needs_changes', 'blocked'].includes(record.verdict)
    || !text(record.summary) || !list(record.evidence) || !list(record.required_changes)
    || !Array.isArray(record.criteria) || record.criteria.length > MAX_ITEMS
    || !record.criteria.every(item => criterion(item) !== undefined)) return undefined
  const qualityReview = quality(record.quality)
  if (qualityReview === undefined) return undefined
  const decision: MissionJudgeDecision = {
    verdict: record.verdict as MissionJudgeDecision['verdict'],
    summary: record.summary,
    evidence: record.evidence,
    requiredChanges: record.required_changes,
    criteria: record.criteria.map(item => criterion(item) as MissionJudgeDecision['criteria'][number]),
    quality: qualityReview,
  }
  if (decision.verdict === 'pass' && decision.evidence.length === 0) return undefined
  if (decision.verdict === 'needs_changes' && decision.requiredChanges.length === 0) return undefined
  return decision
}

function renderedSummary(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, MAX_TEXT)
  } catch {
    return '[rendered output is not serializable]'
  }
}

function prompt(input: HardnessMissionJudgeInput): ContentBlock[] {
  const review = {
    need: input.need,
    goal: input.goal,
    criteria: input.criteria,
    artifactId: input.artifactId,
    artifactMime: input.artifactMime,
    rendered: renderedSummary(input.rendered),
    evidenceId: input.evidenceId,
  }
  return [{
    type: 'text',
    text: '<hardness_mission_judge>\n'
      + `Candidate: ${JSON.stringify(review)}\n\n`
      + 'Act as an implacable independent completion judge. Compare the original objective, every deliverable, '
      + 'every mandatory criterion, and the quality requirements against the actual artifact and durable evidence. '
      + 'Inspect structure, completeness, visual presentation, security, reproducibility, and relevant similar products. '
      + 'For product, UI, document, or visual requests, use web_search and web_fetch to inspect comparable work '
      + 'when the web tools are available, then require evidence that the candidate meets or exceeds the relevant bar. '
      + 'Do not accept scaffolds, mocks, partial substitutes, or untested assumptions. '
      + 'Use read-only tools only. Do not edit files, run commands, call other agents, or change mission state. '
      + 'Return pass only when every mandatory criterion and the quality gate are independently evidenced. '
      + 'Return needs_changes with a specific required_changes list when the mission can continue after repair. '
      + 'Return blocked only when an external condition prevents evaluation. Include the exact evidenceId in '
      + 'evidence when it supports the verdict.\n</hardness_mission_judge>',
  }]
}

/**
 * Create a HARDNESS judge backed by a fresh structured subagent run.
 * @param input - subagent provider and provider id used for isolated review.
 * @returns judge that produces a structured completion decision.
 */
export function createSubagentMissionJudge(input: {
  readonly subagents: Pick<SubagentRuntime, 'getProvider' | 'start'>
  readonly provider: string
}): HardnessMissionJudge {
  return async (mission: HardnessMissionJudgeInput): Promise<MissionJudgeDecision> => {
    const provider = input.subagents.getProvider(input.provider)
    if (provider === undefined) return unavailable(`HARDNESS judge provider "${input.provider}" is not registered`)
    if (!provider.capabilities.outputSchema || !provider.capabilities.toolFilter) {
      return unavailable(`HARDNESS judge provider "${input.provider}" lacks structured read-only review capability`)
    }
    const parent: Agent | undefined = mission.context.agent
    if (parent === undefined) return unavailable('HARDNESS judge requires a live parent agent')
    const toolFilter: ToolRestriction = { allow: [...MISSION_JUDGE_READ_ONLY_TOOLS] }
    let run: Awaited<ReturnType<typeof input.subagents.start>> | undefined
    try {
      run = await input.subagents.start(input.provider, {
        label: 'hardness-mission-judge',
        prompt: prompt(mission),
        parent,
        signal: mission.context.signal,
        outputSchema: MISSION_JUDGE_OUTPUT_SCHEMA,
        toolFilter,
      })
      const result = await run.result
      if (result.stopReason !== 'completed') return unavailable('HARDNESS judge did not complete its review')
      return readDecision(result.structured) ?? unavailable('HARDNESS judge returned an invalid structured verdict')
    } catch {
      return unavailable('HARDNESS judge could not be started')
    } finally {
      if (run !== undefined) await run.dispose()
    }
  }
}
