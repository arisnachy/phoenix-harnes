// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexResetsPanel } from '../src/client/CodexResetsPanel.tsx'
import type { CodexResetSnapshot } from '../src/client/CodexResetsPanel.tsx'
import { en, es } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = (key: keyof typeof es): string => es[key]
const snapshot: CodexResetSnapshot = {
  connected: true,
  availableCount: 2,
  credits: [{ id: 'RateLimitResetCredit_1', resetType: 'codexRateLimits', status: 'available', expiresAt: 1_900_000_000 }],
  primary: { usedPercent: 70, windowDurationMins: 300 },
  secondary: { usedPercent: 10, windowDurationMins: 10_080 },
  checkedAt: 1_800_000_000,
}

describe('Codex reset controls', () => {
  it('renders the official fallback and a disabled redemption without a trusted Host', () => {
    render(<CodexResetsPanel t={t} />)
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: es.codexResetsOpenUsage })
    expect(link.href).toBe('https://chatgpt.com/codex/settings/usage')
    expect(link.rel).toContain('noopener')
    expect(screen.getByRole('button', { name: es.codexResetsActivate })).toBeDisabled()
    expect(screen.getByText(es.codexResetsSafety)).toBeTruthy()
  })

  it('reads real snapshot and requires explicit confirmation before native redemption', async () => {
    const redeem = vi.fn(async () => ({
      outcome: 'reset' as const,
      state: { ...snapshot, availableCount: 1 },
    }))
    const client = { state: vi.fn(async () => snapshot), redeem }
    vi.stubGlobal('crypto', { randomUUID: () => '0c06dfad-a646-4f05-bf50-cab9f37f3c08' })
    render(<CodexResetsPanel t={t} client={client} />)
    await screen.findByText(`${es.codexResetsAvailable}: 2`)
    expect(redeem).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: es.codexResetsActivate }))
    expect(redeem).not.toHaveBeenCalled()
    await screen.findByText(es.codexResetsConfirmWarning)
    fireEvent.click(screen.getByRole('button', { name: es.codexResetsConfirm }))
    await waitFor(() => expect(redeem).toHaveBeenCalledTimes(1))
    expect(redeem).toHaveBeenCalledWith({
      idempotencyKey: '0c06dfad-a646-4f05-bf50-cab9f37f3c08',
      creditId: 'RateLimitResetCredit_1',
    })
    await screen.findByText(`${es.codexResetsAvailable}: 1`)
    expect(screen.getByText(es.codexResetsRedeemed)).toBeTruthy()
  })

  it('does not enable redemption when the server reports no eligible allowance', async () => {
    const client = { state: vi.fn(async () => ({
      ...snapshot, primary: { usedPercent: 10 }, secondary: { usedPercent: 20 },
    })), redeem: vi.fn() }
    render(<CodexResetsPanel t={t} client={client} />)
    await screen.findByText(`${es.codexResetsAvailable}: 2`)
    expect(screen.getByRole('button', { name: es.codexResetsActivate })).toBeDisabled()
    expect(client.redeem).not.toHaveBeenCalled()
  })

  it('shows connection failure and preserves the official manual fallback', async () => {
    const client = {
      state: vi.fn(async (): Promise<CodexResetSnapshot> => { throw new Error('server failed') }),
      redeem: vi.fn(),
    }
    render(<CodexResetsPanel t={t} client={client} />)
    await screen.findByText(es.codexResetsUnavailable)
    expect(screen.getByRole('link', { name: es.codexResetsOpenUsage })).toBeTruthy()
    expect(screen.getByRole('button', { name: es.codexResetsActivate })).toBeDisabled()
  })

  it('renders the English copy without loading account data if no client exists', () => {
    render(<CodexResetsPanel t={key => en[key]} />)
    expect(screen.getByRole('heading', { name: en.codexResetsTitle })).toBeTruthy()
    expect(screen.getByText(en.codexResetsFallback)).toBeTruthy()
  })
})
