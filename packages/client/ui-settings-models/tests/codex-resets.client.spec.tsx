// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexResetsPanel } from '../src/client/CodexResetsPanel.tsx'
import { en, es } from '../src/client/locales.ts'

afterEach(cleanup)

describe('Codex reset controls', () => {
  it('opens only the official usage interface and never claims to redeem directly', () => {
    render(<CodexResetsPanel t={key => es[key]} />)
    const link = screen.getByRole<HTMLAnchorElement>('link', { name: es.codexResetsOpenUsage })
    expect(link.href).toBe('https://chatgpt.com/codex/settings/usage')
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
    expect(screen.getByText(es.codexResetsSafety)).toBeTruthy()
    expect(screen.getByText(es.codexResetsCli)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /activar|redeem/i })).toBeNull()
  })

  it('renders the English copy without exposing secret material', () => {
    render(<CodexResetsPanel t={key => en[key]} />)
    expect(screen.getByRole('heading', { name: en.codexResetsTitle })).toBeTruthy()
    expect(screen.getByText(en.codexResetsFallback)).toBeTruthy()
  })
})
