// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { CodexQuotaRemaining, formatResetCountdown } from '../src/client/CodexQuotaRemaining.tsx'
import type { CodexQuotaRemainingProps } from '../src/client/CodexQuotaRemaining.tsx'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  cleanup()
})

const sid = 's1' as SessionId

function directory(initialProvider: string) {
  let provider = initialProvider
  const listeners = new Set<() => void>()
  const fake = {
    store: {
      getSnapshot: () => ({ current: { provider, model: 'model' } }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    load: vi.fn(() => Promise.resolve({
      current: { provider, model: 'model' },
      routable: true,
      groups: [],
      failures: [],
    })),
  }
  return {
    fake,
    setProvider(next: string) {
      provider = next
      for (const listener of listeners) listener()
    },
  }
}

function propsFor(fakeDirectory: object, authorization: object): CodexQuotaRemainingProps {
  return {
    wide: true,
    sessionId: sid,
    authorization,
    directoryFor: () => fakeDirectory,
  } as unknown as CodexQuotaRemainingProps
}

function authorization(usedPercent: number) {
  return {
    list: vi.fn(() => Promise.resolve({
      rpcId: 'authorization-list' as never,
      result: {
        ok: true as const,
        value: {
          entries: [{
            key: 'openai-codex',
            label: 'OpenAI Codex',
            telemetry: {
              kind: 'account' as const,
              provider: 'Codex',
              primaryLimit: { usedPercent, windowDurationMins: 300 },
            },
          }],
        },
      },
    })),
  }
}

describe('formatResetCountdown', () => {
  it('formats reset countdowns as hours/minutes and days/hours', () => {
    const nowMs = Date.parse('2026-08-27T12:00:00.000Z')
    expect(formatResetCountdown(nowMs / 1000 + (2 * 60 + 18) * 60, nowMs)).toBe('2h 18m')
    expect(formatResetCountdown(nowMs / 1000 + (4 * 24 + 6) * 60 * 60, nowMs)).toBe('4d 6h')
  })

  it('uses disponible at or after the reset instant', () => {
    const nowMs = Date.parse('2026-08-27T12:00:00.000Z')
    expect(formatResetCountdown(nowMs / 1000, nowMs)).toBe('disponible')
    expect(formatResetCountdown(nowMs / 1000 - 1, nowMs)).toBe('disponible')
  })
})

describe('CodexQuotaRemaining', () => {
  it('shows native 100% Codex availability for an OpenAI/Luna route', async () => {
    const d = directory('openai-codex')
    const auth = authorization(0)
    const view = render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('100%')).toBeTruthy()
    expect(auth.list).toHaveBeenCalledWith({})
    expect(view.container.querySelector('[style]')?.getAttribute('style')).toContain('width: 100%')
  })

  it('shows both the five-hour and weekly Codex quota windows with reset countdowns', async () => {
    const d = directory('openai-codex')
    const nowMs = Date.parse('2026-08-27T12:00:00.000Z')
    vi.spyOn(Date, 'now').mockReturnValue(nowMs)
    const auth = {
      list: vi.fn(() => Promise.resolve({
        rpcId: 'authorization-list-two-windows' as never,
        result: {
          ok: true as const,
          value: {
            entries: [{
              key: 'subagent-codex/account',
              label: 'ChatGPT / Codex',
              telemetry: {
                kind: 'account' as const,
                provider: 'Codex',
                primaryLimit: { usedPercent: 14, windowDurationMins: 300, resetsAt: nowMs / 1000 + 2 * 60 * 60 + 18 * 60 },
                secondaryLimit: { usedPercent: 9, windowDurationMins: 10080, resetsAt: nowMs / 1000 + 4 * 86400 + 6 * 60 * 60 },
              },
            }],
          },
        },
      })),
    }
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('86%')).toBeTruthy()
    expect(screen.getByText('91%')).toBeTruthy()
    expect(screen.getByTitle(/5h · 86%/)).toBeTruthy()
    expect(screen.getByTitle(/7d · 91%/)).toBeTruthy()
    expect(screen.getByText('↻ 2h 18m')).toBeTruthy()
    expect(screen.getByText('↻ 4d 6h')).toBeTruthy()
    expect(screen.getByLabelText(/5h.*86%.*2h 18m/)).toBeTruthy()
    expect(screen.getByLabelText(/7d.*91%.*4d 6h/)).toBeTruthy()
  })

  it('keeps a window visible without inventing a countdown when reset time is absent', async () => {
    const d = directory('openai-codex')
    const auth = authorization(14)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('86%')).toBeTruthy()
    expect(screen.queryByText(/↻/)).toBeNull()
  })

  it('does not render or query Codex quota for a non-OpenAI provider', async () => {
    const d = directory('openrouter')
    const auth = authorization(0)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    await waitFor(() => { expect(d.fake.load).toHaveBeenCalledOnce() })
    expect(screen.queryByText(/%/)).toBeNull()
    expect(auth.list).not.toHaveBeenCalled()
  })

  it('skips a key-only OpenAI entry and uses the later Codex telemetry entry', async () => {
    const d = directory('openai-codex')
    const auth = {
      list: vi.fn(() => Promise.resolve({
        rpcId: 'authorization-list-multiple-openai' as never,
        result: {
          ok: true as const,
          value: {
            entries: [
              { key: 'llm-pi-ai/openai', label: 'OpenAI' },
              {
                key: 'subagent-codex/account',
                label: 'ChatGPT / Codex',
                telemetry: {
                  kind: 'account' as const,
                  provider: 'Codex',
                  primaryLimit: { usedPercent: 14 },
                },
              },
            ],
          },
        },
      })),
    }
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('86%')).toBeTruthy()
  })

  it('follows the active provider: OpenAI shows quota, another provider hides it', async () => {
    const d = directory('openai-codex')
    const auth = authorization(26)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('74%')).toBeTruthy()
    act(() => { d.setProvider('openrouter') })
    await waitFor(() => { expect(screen.queryByText('74%')).toBeNull() })
  })

  it('keeps the last quota while the authorization face identity changes', async () => {
    const d = directory('openai-codex')
    const auth = authorization(26)
    const view = render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('74%')).toBeTruthy()
    const pendingAuthorization = { list: vi.fn(() => new Promise<never>(() => {})) }
    view.rerender(<CodexQuotaRemaining {...propsFor(d.fake, pendingAuthorization)} />)

    expect(screen.getByText('74%')).toBeTruthy()
  })

  it('hides unknown telemetry instead of inventing a context percentage', async () => {
    const d = directory('openai-codex')
    const auth = {
      list: vi.fn(() => Promise.resolve({
        rpcId: 'authorization-list-empty' as never,
        result: { ok: true as const, value: { entries: [] } },
      })),
    }
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    await waitFor(() => { expect(auth.list).toHaveBeenCalledOnce() })
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it.each([Number.NaN, 140])('hides invalid account telemetry: %s', async (usedPercent) => {
    const d = directory('openai-codex')
    const auth = authorization(usedPercent)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    await waitFor(() => { expect(auth.list).toHaveBeenCalledOnce() })
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('falls back to a valid secondary limit when the primary limit is invalid', async () => {
    const d = directory('openai-codex')
    const auth = {
      list: vi.fn(() => Promise.resolve({
        rpcId: 'authorization-list-fallback' as never,
        result: {
          ok: true as const,
          value: {
            entries: [{
              key: 'openai-codex',
              telemetry: {
                kind: 'account' as const,
                provider: 'Codex',
                primaryLimit: { usedPercent: Number.NaN },
                secondaryLimit: { usedPercent: 25 },
              },
            }],
          },
        },
      })),
    }
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('75%')).toBeTruthy()
  })
})
