// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

/** Store over a real mirror derived from the same fake wire. */
function derivedDocumentStore(api: object) {
  const wire = api as never
  return new SettingsDocumentStore(wire, new SettingsDescribeMirror(wire))
}
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

function okAuthorization(entries: unknown[]) {
  return {
    list: vi.fn(() => Promise.resolve({
      rpcId: 'authorization-list' as never,
      result: { ok: true as const, value: { entries } },
    })),
  }
}

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('renders real Codex five-hour and total remaining quotas beside Settings', async () => {
    const authorization = okAuthorization([{
      key: 'openai-codex',
      telemetry: {
        kind: 'account' as const,
        provider: 'Codex',
        primaryLimit: { usedPercent: 21, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondaryLimit: { usedPercent: 41, resetsAt: 1_800_100_000 },
      },
    }])
    const { container } = render(<TriggerContent
      {...kit}
      wide
      t={t}
      authorization={authorization as never}
    />)

    expect(await screen.findByText('79%')).toBeTruthy()
    expect(screen.getByText('59%')).toBeTruthy()
    expect(screen.getByText('5 h')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(authorization.list).toHaveBeenCalledWith({})

    const fills = container.querySelectorAll('[class*="quotaFill"]')
    expect(fills).toHaveLength(2)
    expect(fills[0]?.getAttribute('style')).toContain('width: 79%')
    expect(fills[1]?.getAttribute('style')).toContain('width: 59%')
    expect(screen.getByText('5 h').closest('[title]')?.getAttribute('title')).toContain('79% remaining')
    expect(screen.getByText('Total').closest('[title]')?.getAttribute('title')).toContain('resets')
  })

  it('recognizes Codex by telemetry provider and handles a primary-only limit without reset metadata', async () => {
    const authorization = okAuthorization([{
      key: 'custom-provider-key',
      telemetry: {
        kind: 'account' as const,
        provider: 'OpenAI Codex',
        primaryLimit: { usedPercent: 12 },
      },
    }])
    render(<TriggerContent {...kit} wide t={t} authorization={authorization as never} />)
    expect(await screen.findByText('88%')).toBeTruthy()
    expect(screen.getByText('5 h')).toBeTruthy()
    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.getByText('5 h').closest('[title]')?.getAttribute('title')).not.toContain('resets')
  })

  it('renders a secondary-only Codex quota and omits the primary meter', async () => {
    const authorization = okAuthorization([{
      key: 'openai-codex',
      telemetry: {
        kind: 'account' as const,
        provider: 'Codex',
        secondaryLimit: { usedPercent: 25 },
      },
    }])
    render(<TriggerContent {...kit} wide t={t} authorization={authorization as never} />)
    expect(await screen.findByText('75%')).toBeTruthy()
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.queryByText('5 h')).toBeNull()
  })

  it('supports non-hour primary durations and refreshes telemetry on the polling cadence', async () => {
    vi.useFakeTimers()
    const list = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'authorization-90-min' as never,
        result: {
          ok: true as const,
          value: {
            entries: [{
              key: 'openai-codex',
              telemetry: {
                kind: 'account' as const,
                provider: 'Codex',
                primaryLimit: { usedPercent: 10, windowDurationMins: 90 },
              },
            }],
          },
        },
      })
      .mockResolvedValueOnce({
        rpcId: 'authorization-30-min' as never,
        result: {
          ok: true as const,
          value: {
            entries: [{
              key: 'openai-codex',
              telemetry: {
                kind: 'account' as const,
                provider: 'Codex',
                primaryLimit: { usedPercent: 20, windowDurationMins: 30 },
              },
            }],
          },
        },
      })
    render(<TriggerContent {...kit} wide t={t} authorization={{ list } as never} />)

    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('90 min')).toBeTruthy()
    expect(screen.getByText('90%')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await Promise.resolve()
    })
    expect(screen.getByText('30 min')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('suppresses entries without Codex telemetry and Codex telemetry without limits', async () => {
    const authorization = okAuthorization([
      { key: 'missing-telemetry' },
      { key: 'other-provider', telemetry: { kind: 'account' as const, provider: 'Other' } },
      { key: 'openai-codex', telemetry: { kind: 'account' as const, provider: 'Codex' } },
    ])
    render(<TriggerContent {...kit} wide t={t} authorization={authorization as never} />)
    await waitFor(() => { expect(authorization.list).toHaveBeenCalledOnce() })
    expect(screen.queryByText('Total')).toBeNull()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('ignores a failed authorization-list result without turning Settings into an error surface', async () => {
    const list = vi.fn(() => Promise.resolve({
      rpcId: 'authorization-list-failed' as never,
      result: { ok: false as const, error: { code: 'internal' as const, message: 'no telemetry', details: {} } },
    }))
    render(<TriggerContent {...kit} wide t={t} authorization={{ list } as never} />)
    await waitFor(() => { expect(list).toHaveBeenCalledOnce() })
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('keeps sidebar chrome quiet when the telemetry transport rejects', async () => {
    const list = vi.fn(() => Promise.reject(new Error('offline')))
    render(<TriggerContent {...kit} wide t={t} authorization={{ list } as never} />)
    await waitFor(() => { expect(list).toHaveBeenCalledOnce() })
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.queryByText('Total')).toBeNull()
  })

  it('drops an in-flight telemetry response after unmount', async () => {
    let resolveList!: (value: unknown) => void
    const list = vi.fn(() => new Promise(resolve => { resolveList = resolve }))
    const view = render(<TriggerContent {...kit} wide t={t} authorization={{ list } as never} />)
    expect(list).toHaveBeenCalledOnce()
    view.unmount()
    await act(async () => {
      resolveList({
        rpcId: 'authorization-stale' as never,
        result: {
          ok: true as const,
          value: {
            entries: [{
              key: 'openai-codex',
              telemetry: {
                kind: 'account' as const,
                provider: 'Codex',
                primaryLimit: { usedPercent: 1, windowDurationMins: 300 },
              },
            }],
          },
        },
      })
      await Promise.resolve()
    })
    expect(screen.queryByText('99%')).toBeNull()
  })

  it('TriggerContent drops the label and does not poll telemetry in the rail state', () => {
    const list = vi.fn()
    const { container } = render(<TriggerContent
      {...kit}
      wide={false}
      t={t}
      authorization={{ list } as never}
    />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      rpcId: 'document-open' as never,
      result: { ok: true as const, value: { opened: true as const } },
    }))
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith({}) })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({
        rpcId: 'document-action-absent' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } },
      })
      .mockResolvedValueOnce({
        rpcId: 'document-action-ready' as never,
        result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } },
      })
    const wire = { settings: { describe, openDocument: vi.fn() } } as never
    const mirror = new SettingsDescribeMirror(wire)
    const controller = new SettingsDocumentStore(wire, mirror)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          rpcId: 'document-action' as never,
          result: {
            ok: true as const,
            value: { writable: true, hasDocument: true, namespaces: [] },
          },
        })),
        openDocument: vi.fn(() => Promise.resolve({
          rpcId: 'document-open-failed' as never,
          result: { ok: false as const, error: { code: 'internal' as const, message: 'xdg-open missing', details: {} } },
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
