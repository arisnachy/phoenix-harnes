import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import {
  adaptiveCodexReasoningEffort,
  resolveEclipseRoleRoute,
  type EclipseRoutingSettings,
} from '../src/model-selection.ts'

const fallback = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') }

describe('Eclipse role routing', () => {
  const profile: EclipseRoutingSettings = {
    mode: 'hybrid',
    planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
    coordinator: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' },
  }
  it('preserves shipped routes in automatic mode or without settings', () => {
    expect(resolveEclipseRoleRoute(undefined, 'coordinator', fallback)).toEqual(fallback)
    expect(resolveEclipseRoleRoute({ ...profile, mode: 'automatic' }, 'planner', fallback)).toMatchObject({
      provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('medium'),
    })
    expect(resolveEclipseRoleRoute({ ...profile, mode: 'automatic' }, 'coordinator', fallback)).toEqual(fallback)
  })
  it('dispatches a different model and effort for each configured role', () => {
    expect(resolveEclipseRoleRoute(profile, 'planner', fallback)).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('medium'),
    })
    expect(resolveEclipseRoleRoute(profile, 'coordinator', fallback)).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(resolveEclipseRoleRoute(profile, 'subagent', fallback)).toEqual(fallback)
  })
  it('never routes a virtual model to an LLM backend', () => {
    const unsafe: EclipseRoutingSettings = { mode: 'manual', planner: { provider: 'openai-codex', model: 'phoenix-auto' } }
    expect(resolveEclipseRoleRoute(unsafe, 'planner', fallback)).toEqual(fallback)
  })
  it('rejects a non-Codex legacy route at the dispatch boundary', () => {
    const saved: EclipseRoutingSettings = { mode: 'manual', coordinator: { provider: 'mock', model: 'other' } }
    expect(resolveEclipseRoleRoute(saved, 'coordinator', fallback)).toEqual(fallback)
  })

  it('uses the coordinator route as the canonical Kira route', () => {
    const saved: EclipseRoutingSettings = {
      mode: 'hybrid',
      planner: { provider: 'openai-codex', model: 'legacy-planner', reasoningEffort: 'low' },
      coordinator: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' },
    }
    expect(resolveEclipseRoleRoute(saved, 'coordinator', fallback)).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: ReasoningEffortId('xhigh'),
    })
    expect(resolveEclipseRoleRoute({ mode: 'hybrid', coordinator: { provider: 'openai-codex', model: 'gpt-6-luna' } },
      'coordinator', fallback, 'xhigh')).toEqual({
      provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('xhigh'),
    })
  })

  it('keeps user-selected planning independent of automatic Luna Max execution', () => {
    const profile: EclipseRoutingSettings = {
      mode: 'automatic',
      planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
      coordinator: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' },
      subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
      escalationSensitivity: 'adaptive',
    }
    const sol = resolveEclipseRoleRoute(profile, 'planner', fallback)
    expect(sol.model).toBe('gpt-6.1-sol')
    expect(sol.reasoningEffort).toBe(ReasoningEffortId('medium'))
    const luna = resolveEclipseRoleRoute(profile, 'coordinator', {
      provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max'),
    })
    expect(luna.model).toBe('gpt-6-luna')
    expect(luna.reasoningEffort).toBe(ReasoningEffortId('max'))
  })

  it('selects effort from task evidence without a classifier request', () => {
    expect(adaptiveCodexReasoningEffort('Fix the broken navigation button')).toEqual(ReasoningEffortId('high'))
    expect(adaptiveCodexReasoningEffort('Implement a complex multi-step architecture migration')).toEqual(ReasoningEffortId('xhigh'))
    expect(adaptiveCodexReasoningEffort('Handle this critical security incident immediately')).toEqual(ReasoningEffortId('max'))
  })
})
