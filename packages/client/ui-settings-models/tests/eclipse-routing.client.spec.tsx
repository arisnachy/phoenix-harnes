// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import { EclipseRoutingPanel, existingProfile } from '../src/client/EclipseRoutingPanel.tsx'
import { selectCurrentCodexModels } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

function controllerWith(value: unknown, revision = 4) {
  const store = createSnapshotStore({
    status: 'ready' as const,
    error: null,
    credentialError: null,
    writable: true,
    rows: [],
    namespaces: new Map([['eclipse-routing', {
      ns: 'eclipse-routing', schema: {}, value, user: value, base: {}, applies: 'live' as const,
      secrets: [], revision,
    }]]),
    providerOrder: [],
  })
  return { store, load: vi.fn(async () => undefined) }
}

const catalog = [
  { provider: 'openai-codex', model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', reasoningEfforts: ['medium', 'max', 'ultra'] },
  { provider: 'openai-codex', model: 'gpt-6-luna', name: 'GPT-6 Luna', reasoningEfforts: ['low', 'none', 'max'] },
  { provider: 'openrouter', model: 'other', name: 'Other provider', reasoningEfforts: ['high'] },
  { provider: 'openai-codex', model: 'phoenix-auto', name: 'Phoenix Auto', reasoningEfforts: ['max'] },
] as const

describe('Eclipse model settings', () => {
  it('uses independent Eclipse namespace rather than Agent defaults', () => {
    const agentDefault = { provider: 'openai-codex', model: 'gpt-6-luna' }
    const eclipse = {
      mode: 'hybrid',
      planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
    }
    expect(existingProfile(eclipse, agentDefault)).toEqual({
      mode: 'hybrid', coordinator: eclipse.planner, escalationSensitivity: 'adaptive', maxTeammates: 3,
    })
    expect(existingProfile(eclipse, agentDefault)).not.toHaveProperty('planner')
  })

  it('migrates legacy Eclipse settings into the two canonical seats', () => {
    const old = { eclipse: { mode: 'manual', coordinator: { provider: 'mock', model: 'lead' } } }
    expect(existingProfile({}, old)).toEqual({
      mode: 'manual', coordinator: old.eclipse.coordinator, escalationSensitivity: 'adaptive', maxTeammates: 3,
    })
    expect(existingProfile({ mode: 'automatic' }, old)).toEqual({ mode: 'automatic', escalationSensitivity: 'adaptive', maxTeammates: 3 })
    expect(existingProfile(undefined, {})).toEqual({ mode: 'automatic', escalationSensitivity: 'adaptive', maxTeammates: 3 })
  })

  it('keeps only the newest numeric Codex tier and unknown live Codex ids', () => {
    expect(selectCurrentCodexModels([
      { provider: 'openai-codex', model: 'gpt-5.6-sol', name: 'old sol', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.3-codex', name: 'old codex', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-6-sol', name: 'sol', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-6.1-sol', name: 'new sol', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.5', name: 'old generic', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-6', name: 'generic', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.6-luna', name: 'old luna', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-6-luna', name: 'new luna', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.6-terra', name: 'old terra', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-6-terra', name: 'terra', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'codex-specialized', name: 'specialized', reasoningEfforts: ['none'] },
      { provider: 'openrouter', model: 'gpt-9-sol', name: 'wrong provider', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'phoenix-auto', name: 'virtual', reasoningEfforts: [] },
    ])).toMatchObject([
      { model: 'gpt-6.1-sol' }, { model: 'gpt-6' }, { model: 'gpt-6-luna' }, { model: 'gpt-6-terra' },
      { model: 'codex-specialized' },
    ])
  })

  it('derives the newest available generation when the live catalog has no newer major', () => {
    expect(selectCurrentCodexModels([
      { provider: 'openai-codex', model: 'gpt-5.5', name: 'generic old', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.6', name: 'generic current', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5-sol', name: 'sol old', reasoningEfforts: [] },
      { provider: 'openai-codex', model: 'gpt-5.6-sol', name: 'sol current', reasoningEfforts: [] },
    ])).toMatchObject([
      { model: 'gpt-5.6' }, { model: 'gpt-5.6-sol' },
    ])
  })

  it('renders three independent seats with unlimited strategy calls and saves canonical fields', async () => {
    const controller = controllerWith({
      mode: 'manual', planner: { provider: 'openai-codex', model: 'gpt-6.1-sol' },
      specialists: { orion: { provider: 'openai-codex', model: 'gpt-6-luna' } },
    })
    const mutate = vi.fn(async (_request: Record<string, unknown>) => ({
      result: { ok: true as const, value: {} as never },
    }))
    const loadCatalog = vi.fn(async () => catalog)
    render(<EclipseRoutingPanel controller={controller as never} api={{ settings: { mutate } } as never}
      loadCatalog={loadCatalog} t={t} />)

    expect(await screen.findByLabelText(en.eclipseRole_planner)).toBeTruthy()
    expect(screen.getByText(en.eclipseStrategyUnlimited)).toBeTruthy()
    expect(screen.getByLabelText(en.eclipseStrategy)).toBeTruthy()
    expect(screen.getByLabelText(en.eclipseStrategy).querySelectorAll('option')).toHaveLength(3)
    expect(screen.getByLabelText(en.eclipseRole_coordinator)).toBeTruthy()
    expect(screen.getByLabelText(en.eclipseRole_subagent)).toBeTruthy()
    expect(screen.queryByLabelText(/specialist/i)).toBeNull()
    expect(screen.getAllByRole('option', { name: en.eclipseDefaultEffort })).toHaveLength(3)
    fireEvent.change(screen.getByLabelText(en.eclipseMode), { target: { value: 'hybrid' } })
    expect(screen.getAllByRole('option', { name: en.eclipseAdaptiveEffort })).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'ultra' })).toBeTruthy()
    expect(screen.getAllByRole('combobox')).toHaveLength(9)

    fireEvent.click(screen.getByRole('button', { name: en.eclipseSave }))
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ns: 'eclipse-routing', expectedRevision: 4,
      ops: expect.arrayContaining([
        { op: 'set', path: ['coordinator'], value: { provider: 'openai-codex', model: 'gpt-6.1-sol' } },
        { op: 'unset', path: ['planner'] }, { op: 'unset', path: ['specialists'] },
        { op: 'set', path: ['escalationSensitivity'], value: 'adaptive' },
      ]),
    })
  })


  it('persists distinct Sol planning and Luna execution routes without a numeric consultation cap', async () => {
    const controller = controllerWith({
      mode: 'hybrid', escalationSensitivity: 'adaptive',
      planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
      coordinator: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
      subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
    })
    const mutate = vi.fn(async () => ({ result: { ok: true as const, value: {} as never } }))
    render(<EclipseRoutingPanel controller={controller as never} api={{ settings: { mutate } } as never}
      loadCatalog={async () => catalog} t={t} />)
    expect(await screen.findByLabelText(en.eclipseRole_planner)).toHaveProperty('value',
      JSON.stringify(['openai-codex', 'gpt-6.1-sol']))
    expect(screen.getByLabelText(en.eclipseRole_coordinator)).toHaveProperty('value',
      JSON.stringify(['openai-codex', 'gpt-6-luna']))
    fireEvent.change(screen.getByLabelText(en.eclipseStrategy), { target: { value: 'quality' } })
    fireEvent.click(screen.getByRole('button', { name: en.eclipseSave }))
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce())
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ops: expect.arrayContaining([
        { op: 'set', path: ['planner'], value: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' } },
        { op: 'set', path: ['coordinator'], value: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' } },
        { op: 'set', path: ['escalationSensitivity'], value: 'quality' },
      ]),
    })
    expect(JSON.stringify(mutate.mock.calls[0]?.[0])).not.toContain('maxPlannerCalls')
  })

  it('surfaces a failed save instead of claiming the settings were stored', async () => {
    const controller = controllerWith({ mode: 'automatic' })
    const mutate = vi.fn(async () => ({ result: {
      ok: false as const, error: { message: 'settings conflict', code: 'settings-conflict' },
    } }))
    render(<EclipseRoutingPanel controller={controller as never} api={{ settings: { mutate } } as never}
      loadCatalog={async () => catalog} t={t} />)
    await screen.findByLabelText(en.eclipseRole_coordinator)
    fireEvent.click(screen.getByRole('button', { name: en.eclipseSave }))
    expect(await screen.findByText('settings conflict')).toBeTruthy()
    expect(screen.queryByText(en.eclipseSaved)).toBeNull()
  })
})
