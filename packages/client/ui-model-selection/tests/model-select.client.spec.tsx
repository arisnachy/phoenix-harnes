// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@phoenix-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { isPhoenixAutoRouting, localModelBrandMark } from '../src/client/presentation.ts'
import { en, es, zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

const codexReasoning = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
    { id: 'xhigh', name: 'Extra High' },
    { id: 'max', name: 'Max' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect root menu', () => {
  it('keeps the selected model picker visible if the catalog temporarily fails', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'openai-codex', model: 'gpt-6.2-sol', reasoningEffort: 'low' },
      groups: [],
      status: 'error',
      error: 'offline',
    }))
    render(<ModelSelect
      locked={false} available directory={directory} load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)} t={t}
    />)
    const picker = screen.getByRole('button', {
      name: '选择模型，当前 GPT-6.2 Sol，推理等级 low',
    })
    expect(picker.textContent).toContain('GPT-6.2 Sol')
    expect(picker.textContent).toContain('low')
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
  })

  it('offers model and reasoning controls without the standalone AI Team link', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }))
    expect(screen.getByRole('menuitem', { name: /模型/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /推理等级/ })).toBeTruthy()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.queryByText('Equipo IA · AI Team')).toBeNull()
    expect(screen.queryByText('Supervisado')).toBeNull()
  })
})

describe('ModelSelect Codex serving speed', () => {
  it('shows Instant · Fast as a serving tier and retains manual reasoning', async () => {
    const codex = {
      provider: 'openai-codex', model: 'gpt-6.2-sol', reasoningEffort: 'high',
    }
    const catalog = [{
      id: 'openai-codex', name: 'OpenAI Codex',
      models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', reasoning: codexReasoning }],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ current: codex, groups: catalog }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection, groups: catalog }))
      return true
    })
    render(<ModelSelect
      locked={false} available directory={directory} load={vi.fn()} select={select} t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /GPT-6.2 Sol/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /速度/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Instant · Fast/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'openai-codex', model: 'gpt-6.2-sol', reasoningEffort: 'high', serviceTier: 'fast',
      })
    })
  })
})

describe('ModelSelect reasoning effort', () => {
  it('renders adapter metadata and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek V4 Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const slider = screen.getByRole('slider', { name: '选择推理等级' })
    expect(slider.getAttribute('aria-valuetext')).toBe('High')

    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.pointerUp(slider)
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek V4 Flash，推理等级 Max')
    })
  })

  it('keeps the effort card open while the slider waits for host acceptance', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
    }))
    let acceptSelection!: (accepted: boolean) => void
    const selection = new Promise<boolean>((resolve) => { acceptSelection = resolve })
    const select = vi.fn(() => selection)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /DeepSeek V4 Flash/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))

    const card = screen.getByTestId('effort-selector')
    const slider = screen.getByRole('slider', { name: '选择推理等级' })
    fireEvent.change(slider, { target: { value: '3' } })
    expect(screen.getByTestId('effort-selector')).toBe(card)
    expect(select).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'max',
    })
    expect(screen.getByTestId('effort-selector')).toBe(card)

    acceptSelection(true)
    await waitFor(() => { expect(screen.queryByTestId('effort-selector')).toBeNull() })
  })

  it('submits the provider default from the reset control and waits before closing', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
    }))
    let acceptSelection!: (accepted: boolean) => void
    const selection = new Promise<boolean>((resolve) => { acceptSelection = resolve })
    const select = vi.fn(() => selection)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    fireEvent.click(screen.getByRole('button', { name: '恢复默认推理等级' }))

    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
    })
    expect(screen.getByTestId('effort-selector')).toBeTruthy()

    acceptSelection(true)
    await waitFor(() => { expect(screen.queryByTestId('effort-selector')).toBeNull() })
  })

  it('offers provider default as the first effort position', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const slider = screen.getByRole('slider', { name: '选择推理等级' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')
    expect(slider.getAttribute('max')).toBe('1')
  })

  it('keeps the full Codex effort vocabulary supplied by the adapter', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'openai', model: 'gpt-5.6', reasoningEffort: 'high' },
      groups: [{
        id: 'openai',
        name: 'OpenAI',
        models: [{ id: 'gpt-5.6', name: 'GPT-5.6', reasoning: codexReasoning }],
      }],
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /GPT-5.6/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    const slider = screen.getByRole('slider', { name: '选择推理等级' })
    expect(slider.getAttribute('max')).toBe('5')
    expect(slider.getAttribute('aria-valuetext')).toBe('High')
  })

  it('prompts for a selection when the current model is no longer advertised', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型' })
    expect(trigger.textContent).toContain('选择模型')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByText('removed-model')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek V4 Flash' })).toBeTruthy()
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek V4 Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('presents readable names with packaged official provider marks', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'google', model: 'research' },
      groups: [
        {
          id: 'google',
          name: 'Gemini',
          models: [
            { id: 'research', name: 'Deep Research Max Preview (Apr-21-2026)' },
            { id: 'gemini', name: 'gemini-2.5-computer-use-preview-10-2025' },
          ],
        },
        {
          id: 'openai',
          name: 'OpenAI',
          models: [{ id: 'gpt', name: 'gpt-5.6' }],
        },
        {
          id: 'openrouter',
          name: 'OpenRouter',
          models: [{ id: 'route', name: 'openrouter-auto' }],
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [{ id: 'chat', name: 'deepseek-chat' }],
        },
        {
          id: 'unknown-gateway',
          name: 'Acme Gateway',
          models: [{ id: 'acme', name: 'Acme-Model' }],
        },
      ],
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /Deep Research Max/ })
    expect(trigger.getAttribute('title')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    const research = screen.getByRole('menuitemradio', { name: 'Deep Research Max' })
    expect(research.getAttribute('title')).toBeNull()
    expect(screen.getByText('Research')).toBeTruthy()
    expect(screen.getAllByText('Preview').length).toBeGreaterThan(0)
    expect(screen.getByRole('menuitemradio', { name: 'Gemini 2.5 Computer Use' })).toBeTruthy()

    // Provider groups start collapsed except the current one; expand each
    // before asserting its packaged mark.
    for (const name of ['OpenAI', 'OpenRouter', 'DeepSeek', 'Acme Gateway']) {
      fireEvent.click(screen.getByRole('menuitem', { name }))
    }

    const expectedMarks = [
      ['Gemini', 'googlegemini'],
      ['OpenAI', 'openai'],
      ['OpenRouter', 'openrouter'],
      ['DeepSeek', 'deepseek'],
    ] as const
    for (const [name, slug] of expectedMarks) {
      const logos = screen.getAllByRole('img', { name: `${name} logo` })
      const mark = logos.flatMap(logo => [...logo.querySelectorAll(`svg[data-provider-mark="${slug}"]`)]).at(0)
      expect(mark?.querySelector('path')?.getAttribute('d')).toBeTruthy()
    }
    expect(screen.queryByRole('alert')).toBeNull()

    const unknownLogo = screen.getByRole('img', { name: 'Acme Gateway logo' })
    expect(unknownLogo.querySelector('svg')).toBeNull()
    expect(unknownLogo.textContent).toBe('A')
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect popup viewport', () => {
  it('opens downward near the top and keeps the first model accessible', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /DeepSeek V4 Flash/ })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: 90, bottom: 118, left: 1000, right: 1180,
    } as DOMRect)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const menu = screen.getByRole('menu')
    expect(menu.style.top).toBe('calc(100% + 8px)')
    expect(menu.style.bottom).toBe('auto')
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek V4 Flash' })).toBeTruthy()
  })

  it('caps upward dropdown height to the available viewport space', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: /DeepSeek V4 Flash/ })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: 320, bottom: 348, left: 1000, right: 1180,
    } as DOMRect)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const menu = screen.getByRole('menu')
    expect(menu.style.bottom).toBe('calc(100% + 8px)')
    expect(parseInt(menu.style.maxHeight, 10)).toBeLessThanOrEqual(300)
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek V4 Flash' })).toBeTruthy()
  })
})

describe('ModelSelect catalog scrolling', () => {
  it('returns to the first row when a startup refresh replaces the open catalog', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const { container } = render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    const list = container.querySelector('.scrollable') as HTMLDivElement
    list.scrollTop = 96

    act(() => {
      directory.set(state({
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', reasoning },
            { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
          ],
        }],
      }))
    })

    expect(list.scrollTop).toBe(0)
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek V4 Pro' })).toBeTruthy()
  })
})

describe('ModelSelect provider accordion', () => {
  const groups = [
    {
      id: 'alpha',
      name: 'Alpha',
      models: [{ id: 'a1', name: 'Alpha-One' }],
    },
    {
      id: 'beta',
      name: 'Beta',
      models: [
        { id: 'b1', name: 'Beta-One' },
        { id: 'b2', name: 'Beta-Two' },
      ],
    },
  ]

  it('expands only the selected provider group by default and toggles groups independently', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'beta', model: 'b1' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /Beta One/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))

    // The current provider is open; every other provider starts collapsed.
    expect(screen.getByRole('menuitemradio', { name: 'Beta One' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Beta Two' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Alpha One' })).toBeNull()

    // Expanding Alpha reveals its models without hiding Beta's.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(screen.getByRole('menuitemradio', { name: 'Alpha One' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Beta One' })).toBeTruthy()

    // Collapsing Beta hides its models.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))
    expect(screen.queryByRole('menuitemradio', { name: 'Beta One' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Alpha One' })).toBeTruthy()
  })

  it('expands the first provider when the current model is no longer advertised', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'removed', model: 'removed-model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Alpha One' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Beta One' })).toBeNull()
  })
})

describe('ModelSelect searchable provider catalog', () => {
  const groups = [
    { id: 'alpha', name: 'Alpha', models: [{ id: 'a1', name: 'Alpha One' }] },
    { id: 'beta', name: 'Beta', models: [
      { id: 'b1', name: 'Beta One' },
      { id: 'b2', name: 'Beta Two' },
    ] },
  ]

  it('searches models in collapsed providers and selects the exact routed model', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'alpha', model: 'a1' },
    }))
    const select = vi.fn(async () => true)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Alpha One/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'Beta Two' })).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索模型' }), {
      target: { value: 'b2' },
    })
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Beta Two' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Alpha' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Beta Two' }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({ provider: 'beta', model: 'b2' })
    })
  })

  it('supports provider names, clearing a query, and a clear empty state', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups,
      current: { provider: 'beta', model: 'b1' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /Beta One/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const search = screen.getByRole('searchbox', { name: '搜索模型' })
    fireEvent.change(search, { target: { value: 'ALPHA' } })
    expect(screen.getByRole('menuitemradio', { name: 'Alpha One' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Beta' })).toBeNull()
    fireEvent.change(search, { target: { value: 'no-such-model' } })
    expect(screen.getByText('没有匹配的模型。')).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByRole('menuitemradio', { name: 'Beta One' })).toBeTruthy()
  })
})

describe('Fénix Eclipse is the visible name of Phoenix automatic routing', () => {
  it('keeps the same Fénix Eclipse display name across Spanish, English and Chinese', () => {
    expect(es['trigger.auto']).toBe('Fénix Eclipse')
    expect(en['trigger.auto']).toBe('Fénix Eclipse')
    expect(zh['trigger.auto']).toBe('Fénix Eclipse')
    expect(es['trigger.autoDetail']).toContain('Sol planifica')
    expect(es['trigger.autoDetail']).toContain('Luna ejecuta')
  })

  it('uses Fénix Eclipse in the trigger and menu without changing the Host selection', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix', model: 'phoenix-auto' },
      groups: [{
        id: 'phoenix',
        name: 'Phoenix',
        models: [{ id: 'phoenix-auto', name: 'Phoenix Auto' }],
      }],
    }))
    const select = vi.fn()
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    expect(screen.getByRole('button', { name: /Fénix Eclipse/ })).not.toBeNull()
    expect(screen.queryByText('Phoenix Auto')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Fénix Eclipse/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^模型/ }))
    expect(screen.getByRole('menuitemradio', { name: 'Fénix Eclipse' })).not.toBeNull()
    expect(select).not.toHaveBeenCalled()
  })
})

describe('Phoenix Local installed model branding', () => {
  it('shows the official emblem, exact names, family logos and selects an installed artifact', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix-local', model: 'ollama:gemma4:e2b' },
      groups: [{ id: 'phoenix-local', name: '🔥 Phoenix Local · Offline', models: [
        { id: 'ollama:gemma4:e2b', name: 'Gemma 4 E2B', description: 'Ollama · Local' },
        { id: 'ollama:qwen3.5:2b', name: 'Qwen 3.5 2B', description: 'Ollama · Local' },
      ] }],
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Gemma 4 E2B/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const group = screen.getByRole('menuitem', { name: 'Phoenix Local · Offline' })
    expect(group.querySelector('img[src="/phoenix-emblem.png"]')).not.toBeNull()
    expect(group.textContent).not.toContain('🔥')
    const gemma = screen.getByRole('menuitemradio', { name: 'Gemma 4 E2B' })
    const qwen = screen.getByRole('menuitemradio', { name: 'Qwen 3.5 2B' })
    expect(gemma.querySelector('svg[data-provider-mark="google"]')).not.toBeNull()
    expect(qwen.querySelector('svg[data-provider-mark="qwen"]')).not.toBeNull()
    expect(gemma.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(qwen)
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'phoenix-local', model: 'ollama:qwen3.5:2b' }) })
  })
})

describe('PHOENIX → ORIÓN model picker', () => {
  it('shows a single PHOENIX provider with the ORIÓN constellation and a stable legacy route', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix-nexus', model: 'nexus-auto' },
      groups: [
        { id: 'phoenix', name: 'Phoenix',
          models: [{ id: 'phoenix-auto', name: 'Phoenix Auto' }] },
        { id: 'phoenix-nexus', name: 'PHOENIX Nexus',
          models: [{ id: 'nexus-auto', name: 'PHOENIX Nexus' }] },
      ],
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect locked={false} available directory={directory}
      load={vi.fn()} select={select} t={t} />)

    const trigger = screen.getByRole('button', { name: /ORIÓN/ })
    expect(trigger.querySelector('svg[data-orion-mark="belt"]')).not.toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.getAllByRole('menuitem', { name: 'PHOENIX' })).toHaveLength(1)
    const group = screen.getByRole('menuitem', { name: 'PHOENIX' })
    expect(group.querySelector('img[src="/phoenix-emblem.png"]')).not.toBeNull()
    const orion = screen.getByRole('menuitemradio', { name: 'ORIÓN' })
    expect(orion.querySelector('svg[data-orion-mark="belt"]')).not.toBeNull()
    expect(orion.getAttribute('aria-checked')).toBe('true')
    const search = screen.getByRole('searchbox', { name: '搜索模型' })
    fireEvent.change(search, { target: { value: 'orion' } })
    expect(screen.getByRole('menuitemradio', { name: 'ORIÓN' })).toBeTruthy()
    fireEvent.change(search, { target: { value: '' } })
    const eclipse = screen.getByRole('menuitemradio', { name: 'Fénix Eclipse' })
    fireEvent.click(eclipse)
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'phoenix', model: 'phoenix-auto' }) })
  })

  it('sends an exact Nexus wire route when ORIÓN is selected, even in a merged PHOENIX group', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix', model: 'phoenix-auto' },
      groups: [
        { id: 'phoenix', name: 'Phoenix',
          models: [{ id: 'phoenix-auto', name: 'Phoenix Auto' }] },
        { id: 'phoenix-nexus', name: 'PHOENIX',
          models: [{ id: 'nexus-auto', name: 'ORIÓN' }] },
      ],
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect locked={false} available directory={directory}
      load={vi.fn()} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /Fénix Eclipse/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    const orion = screen.getByRole('menuitemradio', { name: 'ORIÓN' })
    fireEvent.click(orion)
    await waitFor(() => { expect(select).toHaveBeenCalledWith({ provider: 'phoenix-nexus', model: 'nexus-auto' }) })
  })

  it('displays legacy standalone Nexus catalog entries as PHOENIX → ORIÓN', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix-nexus', model: 'nexus-auto' },
      groups: [{ id: 'phoenix-nexus', name: 'PHOENIX Nexus',
        models: [{ id: 'nexus-auto', name: 'PHOENIX Nexus' }] }],
    }))
    render(<ModelSelect locked={false} available directory={directory}
      load={vi.fn()} select={vi.fn().mockResolvedValue(true)} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /ORIÓN/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.getByRole('menuitem', { name: 'PHOENIX' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'ORIÓN' })).toBeTruthy()
  })
})


describe('model presentation routing and local marks', () => {
  it('keeps Eclipse independent from Orion and ordinary model names', () => {
    expect(isPhoenixAutoRouting('PHOENIX-AUTO', 'Other')).toBe(true)
    expect(isPhoenixAutoRouting('legacy', ' Phoenix Auto ')).toBe(true)
    expect(isPhoenixAutoRouting('nexus-auto', 'ORIÓN')).toBe(false)
    expect(isPhoenixAutoRouting('ordinary', 'Phoenix')).toBe(false)
  })

  it('uses the concrete local family rather than the shared provider mark', () => {
    expect(localModelBrandMark('gemma-4', '')?.slug).toBe('google')
    expect(localModelBrandMark('local', 'Gemini')?.slug).toBe('google')
    expect(localModelBrandMark('qwen3.5', '')?.slug).toBe('qwen')
    expect(localModelBrandMark('deepseek-r1', '')?.slug).toBe('deepseek')
    expect(localModelBrandMark('llama-3', '')?.slug).toBe('meta')
    expect(localModelBrandMark('mistral', '')?.slug).toBe('mistralai')
    expect(localModelBrandMark('local', 'Mixtral')?.slug).toBe('mistralai')
    expect(localModelBrandMark('custom', 'Unknown')).toBeUndefined()
  })
})


describe('ORIÓN exit to other providers', () => {
  it('offers other provider models immediately and submits their exact wire route', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'phoenix-nexus', model: 'nexus-auto' },
      groups: [
        { id: 'phoenix-nexus', name: 'PHOENIX', models: [{ id: 'nexus-auto', name: 'ORIÓN' }] },
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }] },
        { id: 'openai-codex', name: 'OpenAI Codex', models: [{ id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol' }] },
      ],
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: /ORIÓN/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek.*Flash/i }))
    await waitFor(() => expect(select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
  })
})
