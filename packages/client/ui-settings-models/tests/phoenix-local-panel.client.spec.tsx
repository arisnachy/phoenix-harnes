// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhoenixLocalPanel } from '../src/client/PhoenixLocalPanel.tsx'
import type { PhoenixLocalModelClient, PhoenixLocalModelSnapshot } from '../src/client/PhoenixLocalPanel.tsx'
import { localEn } from '../src/client/phoenix-local-locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof localEn): string => localEn[key]

function snapshot(overrides: Partial<PhoenixLocalModelSnapshot> = {}): PhoenixLocalModelSnapshot {
  return {
    mode: 'on-demand',
    selectedModelId: 'gemma-4-e2b-it-q4-0',
    installedModelIds: [],
    phase: 'not-installed',
    catalog: [{
      id: 'gemma-4-e2b-it-q4-0',
      displayName: 'Gemma 4 E2B-it Q4_0',
      sizeBytes: 2_841_481_184,
      estimatedRamBytes: 6_000_000_000,
      contextWindow: 131072,
      maxTokens: 2048,
      recommended: true,
    }, {
      id: 'qwen3.5-4b-q4-k-m',
      displayName: 'Qwen3.5-4B Q4_K_M',
      sizeBytes: 3_013_027_808,
      estimatedRamBytes: 8_500_000_000,
      contextWindow: 262144,
      maxTokens: 2048,
      recommended: false,
    }],
    ...overrides,
  }
}

function client(initial = snapshot()): PhoenixLocalModelClient & { calls: Record<string, ReturnType<typeof vi.fn>> } {
  let current = initial
  const calls = {
    state: vi.fn(async () => current),
    install: vi.fn(async (modelId: string) => {
      current = snapshot({ selectedModelId: modelId, installedModelIds: [modelId], phase: 'ready' })
      return current
    }),
    start: vi.fn(async () => {
      current = snapshot({ installedModelIds: [current.selectedModelId], phase: 'running' })
      return current
    }),
    stop: vi.fn(async () => {
      current = snapshot({ installedModelIds: [current.selectedModelId], phase: 'ready' })
      return current
    }),
    uninstall: vi.fn(async (modelId: string) => {
      current = snapshot({ selectedModelId: modelId, installedModelIds: [], phase: 'not-installed' })
      return current
    }),
    setMode: vi.fn(async (mode: PhoenixLocalModelSnapshot['mode']) => {
      current = snapshot({ ...current, mode })
      return current
    }),
    setDefaultModel: vi.fn(async (modelId: string) => {
      current = snapshot({ ...current, selectedModelId: modelId })
      return current
    }),
  }
  return { ...calls, calls }
}

describe('PhoenixLocalPanel', () => {
  it('loads the recommended local model and exposes lifecycle controls without a cloud key', async () => {
    const local = client()
    render(<PhoenixLocalPanel client={local} t={t} />)

    expect(await screen.findByText(localEn.title)).toBeTruthy()
    expect(screen.getByLabelText<HTMLSelectElement>(localEn.model).value).toBe('gemma-4-e2b-it-q4-0')
    expect(screen.getAllByRole('option').map(option => option.textContent)).toContain('Qwen3.5-4B Q4_K_M')
    expect(screen.getByRole('button', { name: localEn.install })).toBeTruthy()
    expect(screen.getByText(localEn.noInstalled)).toBeTruthy()
  })

  it('persists mode changes through the Host client', async () => {
    const local = client()
    render(<PhoenixLocalPanel client={local} t={t} />)
    await screen.findByText(localEn.title)

    fireEvent.change(screen.getByLabelText(localEn.mode), { target: { value: 'always-on' } })
    await waitFor(() => expect(local.calls.setMode).toHaveBeenCalledWith('always-on'))
  })

  it('installs, starts, stops, and requires confirmation before uninstalling', async () => {
    const local = client()
    render(<PhoenixLocalPanel client={local} t={t} />)
    await screen.findByText(localEn.title)

    fireEvent.click(screen.getByRole('button', { name: localEn.install }))
    await waitFor(() => expect(local.calls.install).toHaveBeenCalledWith('gemma-4-e2b-it-q4-0'))
    expect(await screen.findByRole('button', { name: localEn.start })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: localEn.start }))
    await waitFor(() => expect(local.calls.start).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: localEn.stop })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: localEn.stop }))
    await waitFor(() => expect(local.calls.stop).toHaveBeenCalledTimes(1))

    fireEvent.click(await screen.findByRole('button', { name: localEn.uninstall }))
    expect(local.calls.uninstall).not.toHaveBeenCalled()
    expect(screen.getByText(localEn.uninstallQuestion)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: localEn.uninstallConfirm }))
    await waitFor(() => expect(local.calls.uninstall).toHaveBeenCalledWith('gemma-4-e2b-it-q4-0'))
  })
})
