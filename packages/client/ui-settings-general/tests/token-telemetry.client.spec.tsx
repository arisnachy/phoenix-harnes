// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TokenTelemetrySnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import {
  TokenTelemetrySection,
  type TokenTelemetrySectionInjected,
  type TokenTelemetrySectionProps,
} from '../src/client/TokenTelemetrySection.tsx'
import { es, type SettingsKey } from '../src/client/locales.ts'

afterEach(cleanup)

const EMPTY: TokenTelemetrySnapshot = { enabled: true, records: [] }
const translate = (key: SettingsKey) => es[key]

function mount(methods: TokenTelemetrySectionInjected) {
  const props = { ...methods, t: translate } as unknown as TokenTelemetrySectionProps
  return render(<TokenTelemetrySection {...props} />)
}

describe('Settings → Telemetría', () => {
  it('lets the user activate collection even when the initial Host read fails', async () => {
    const readTelemetry = vi.fn().mockRejectedValue(new Error('TELEMETRY_HOST_UPDATE_REQUIRED'))
    const setTelemetry = vi.fn().mockResolvedValue(EMPTY)
    mount({ readTelemetry, setTelemetry, clearTelemetry: vi.fn().mockResolvedValue(EMPTY) })
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox.hasAttribute('disabled')).toBe(false)
    await screen.findByText(es['telemetry.hostUnavailable'])
    expect(screen.queryByText(es['telemetry.disabled'])).toBeNull()

    fireEvent.click(checkbox)
    await waitFor(() => { expect(setTelemetry).toHaveBeenCalledWith(true) })
    await waitFor(() => { expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true) })
    expect(screen.queryByText(es['telemetry.hostUnavailable'])).toBeNull()
  })

  it('does not mislabel missing Codex cached-token metrics as zero and shows reusable prefix', async () => {
    const record: TokenTelemetrySnapshot['records'][number] = {
      at: Date.now(), provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'high',
      systemChars: 100, codeSdkChars: 40, reusedSystemPrefixChars: 80, schemaChars: 30,
      historyChars: 10, humanChars: 5, assistantChars: 5, toolResultChars: 0,
      runtimeContextChars: 0, otherHistoryChars: 0, messageCount: 2, toolCount: 2,
      approximateInputTokens: 35, inputTokens: 505, outputTokens: 20,
    }
    const readTelemetry = vi.fn().mockResolvedValue({ enabled: true, records: [record] })
    mount({ readTelemetry, setTelemetry: vi.fn(), clearTelemetry: vi.fn() })
    await screen.findByText('505')
    expect(screen.getByText(es['telemetry.cachePrefix'])).toBeTruthy()
    expect(screen.getByText(es['telemetry.sdk'])).toBeTruthy()
    expect(screen.getByText(es['telemetry.cacheUnknown'])).toBeTruthy()
    expect(screen.getByText('80% ' + es['telemetry.cachePrefixReused'])).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows pending rather than 0% for the first same-model cold-start request', async () => {
    const first: TokenTelemetrySnapshot['records'][number] = {
      at: Date.now(), provider: 'codex', model: 'luna', reasoningEffort: 'high',
      systemChars: 5000, reusedSystemPrefixChars: 0, schemaChars: 200,
      historyChars: 0, humanChars: 0, assistantChars: 0, toolResultChars: 0,
      runtimeContextChars: 0, otherHistoryChars: 0, messageCount: 0,
      toolCount: 2, approximateInputTokens: 1300, inputTokens: 2000,
    }
    mount({
      readTelemetry: vi.fn().mockResolvedValue({ enabled: true, records: [first] }),
      setTelemetry: vi.fn(),
      clearTelemetry: vi.fn(),
    })
    await screen.findByText(es['telemetry.cachePrefixPending'])
    expect(screen.queryByText('0% ' + es['telemetry.cachePrefixReused'])).toBeNull()
  })

  it('shows collected real tokens and updates the checkbox after a successful Host mutation', async () => {
    const record: TokenTelemetrySnapshot['records'][number] = {
      at: Date.now(), provider: 'codex', model: 'luna', reasoningEffort: 'medium',
      systemChars: 100, schemaChars: 200, historyChars: 300, humanChars: 50,
      assistantChars: 75, toolResultChars: 100, runtimeContextChars: 25, otherHistoryChars: 50,
      messageCount: 4, toolCount: 2, approximateInputTokens: 150,
      inputTokens: 505, outputTokens: 205, cacheReadTokens: 50,
    }
    const loaded: TokenTelemetrySnapshot = { enabled: true, records: [record] }
    const readTelemetry = vi.fn().mockResolvedValue(loaded)
    const setTelemetry = vi.fn().mockResolvedValue({ ...loaded, enabled: false })
    mount({ readTelemetry, setTelemetry, clearTelemetry: vi.fn().mockResolvedValue(EMPTY) })
    await waitFor(() => { expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true) })
    expect(screen.getByText('505')).toBeTruthy()
    expect(screen.getByText('205')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => { expect(setTelemetry).toHaveBeenCalledWith(false) })
    await waitFor(() => { expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false) })
    expect(screen.getByText(es['telemetry.disabled'])).toBeTruthy()
  })
})
