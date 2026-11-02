import { describe, expect, it } from 'vitest'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import {
  adaptiveCodexReasoningEffort,
  isPhoenixAutoBoundedImplementation,
  resolveEclipseRoleRoute,
  selectEclipseAutomaticCoordinatorRoute,
  type EclipseRoutingSettings,
} from '../src/model-selection.ts'

const fallback = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('max') }

describe('Eclipse role routing', () => {
  const profile: EclipseRoutingSettings = {
    mode: 'hybrid',
    planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
    coordinator: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'high' },
  }
  it('switches Luna to Terra only for new, substantive Team evidence in automatic mode', () => {
    const automatic: EclipseRoutingSettings = {
      mode: 'automatic',
      coordinator: { provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: 'low' },
    }
    const luna = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: ReasoningEffortId('high') }
    const teamResult = { messageId: 'result-1', purpose: 'result', text: 'Se completaron las pruebas de UI.' }
    const terra = selectEclipseAutomaticCoordinatorRoute(automatic, luna, teamResult, undefined, 0)
    expect(terra).toEqual({
      provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: ReasoningEffortId('low'),
    })
    expect(selectEclipseAutomaticCoordinatorRoute(automatic, luna, undefined, undefined, 0)).toBe(luna)
    expect(selectEclipseAutomaticCoordinatorRoute(automatic, luna, teamResult, 'result-1', 1)).toBe(luna)
    expect(selectEclipseAutomaticCoordinatorRoute(automatic, luna, teamResult, 'result-1', 1, true))
      .toEqual(terra)
    expect(selectEclipseAutomaticCoordinatorRoute(automatic, luna, {
      messageId: 'result-2', purpose: 'result', text: 'Otro resultado.',
    }, 'result-1', 2)).toBe(luna)
  })

  it('keeps Sol rescues, trivial Team questions and unrelated providers out of Terra', () => {
    const config: EclipseRoutingSettings = {
      mode: 'automatic', coordinator: { provider: 'openai-codex', model: 'gpt-6.1-terra' },
    }
    const question = { messageId: 'q-1', purpose: 'question', text: '¿Una frase o dos viñetas?' }
    expect(selectEclipseAutomaticCoordinatorRoute(config, fallback, question, undefined, 0)).toBe(fallback)
    expect(selectEclipseAutomaticCoordinatorRoute(config, fallback, {
      messageId: 'block-1', purpose: 'blocker', text: 'Fallo crítico.',
    }, undefined, 0)).toBe(fallback)
    const sol = { provider: 'openai-codex', model: 'gpt-6.1-sol' }
    expect(selectEclipseAutomaticCoordinatorRoute(config, sol, {
      messageId: 'result-1', purpose: 'result', text: 'Resultado de ejecución.',
    }, undefined, 0)).toBe(sol)
    expect(selectEclipseAutomaticCoordinatorRoute({
      ...config, mode: 'hybrid',
    }, fallback, { messageId: 'result-1', purpose: 'result', text: 'Resultado.' },
    undefined, 0)).toBe(fallback)
    expect(selectEclipseAutomaticCoordinatorRoute({
      ...config, coordinator: { provider: 'other', model: 'gpt-6.1-terra' },
    }, fallback, { messageId: 'result-1', purpose: 'result', text: 'Resultado.' },
    undefined, 0)).toBe(fallback)
    expect(selectEclipseAutomaticCoordinatorRoute(config, fallback, {
      messageId: 'review-1', purpose: 'review', text: 'Hay dos resultados inconsistentes.',
    }, undefined, 0)).toEqual({ provider: 'openai-codex', model: 'gpt-6.1-terra' })
  })

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

  it('executes a self-contained tested module with Luna without a separate Sol planning turn', () => {
    const request = [
      'Construye un módulo en Python 3.11 llamado ratelimiter, sin dependencias externas.',
      'Incluye dos algoritmos con interfaz allow y retry_after, Token Bucket y Sliding Window Log.',
      'Debe ser thread-safe, con reloj inyectable y expiración de claves inactivas.',
      'Entrega código, pruebas pytest de concurrencia y expiración, README.md con ejemplos y requisitos.',
    ].join(' ')
    expect(isPhoenixAutoBoundedImplementation(request)).toBe(true)
    expect(isPhoenixAutoBoundedImplementation('Arregla router.ts y ejecuta los tests.')).toBe(false)
    expect(isPhoenixAutoBoundedImplementation(request + ' Luego haz merge a main y stable.')).toBe(false)
    expect(isPhoenixAutoBoundedImplementation(request + ' Es una migración crítica de producción.')).toBe(false)
  })
})
