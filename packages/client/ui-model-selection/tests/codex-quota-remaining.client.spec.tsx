// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { CodexQuotaRemaining } from '../src/client/CodexQuotaRemaining.tsx'
import type { CodexQuotaRemainingProps } from '../src/client/CodexQuotaRemaining.tsx'

afterEach(cleanup)

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

describe('CodexQuotaRemaining', () => {
  it('shows native 100% Codex availability for an OpenAI/Luna route', async () => {
    const d = directory('openai-codex')
    const auth = authorization(0)
    const view = render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('100%')).toBeTruthy()
    expect(auth.list).toHaveBeenCalledWith({})
    expect(view.container.querySelector('[style]')?.getAttribute('style')).toContain('width: 100%')
  })

  it('does not render or query Codex quota for a non-OpenAI provider', async () => {
    const d = directory('openrouter')
    const auth = authorization(0)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    await waitFor(() => { expect(d.fake.load).toHaveBeenCalledOnce() })
    expect(screen.queryByText(/%/)).toBeNull()
    expect(auth.list).not.toHaveBeenCalled()
  })

  it('follows the active provider: OpenAI shows quota, another provider hides it', async () => {
    const d = directory('openai-codex')
    const auth = authorization(26)
    render(<CodexQuotaRemaining {...propsFor(d.fake, auth)} />)

    expect(await screen.findByText('74%')).toBeTruthy()
    act(() => { d.setProvider('openrouter') })
    await waitFor(() => { expect(screen.queryByText('74%')).toBeNull() })
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
})
