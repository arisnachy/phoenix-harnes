// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import { ReasoningRow } from '../src/client/chat/ReasoningRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

describe('ReasoningRow', () => {
  it('auto-opens while streaming, keeps a manual collapse, and auto-collapses on settle', () => {
    const view = render(
      <ReasoningRow t={t} text={'Inspect the session\nNewest reasoning tokens'} running />,
    )
    const row = view.getByRole('button')
    // Streaming phase starts expanded but exposes only a localized status.
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).toContain(zh['reasoning.body'])
    expect(view.container.textContent).not.toContain('Newest reasoning tokens')

    // A manual collapse wins for the rest of the phase.
    fireEvent.click(view.getByText(zh['reasoning.title']))
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText(zh['reasoning.running'])).toBeTruthy()

    view.rerender(
      <ReasoningRow t={t} text={'Inspect the session\nNewest reasoning tokens keep arriving'} running />,
    )

    // Settling auto-collapses and keeps the localized status.
    view.rerender(
      <ReasoningRow t={t} text={'Inspect the session\nNewest reasoning tokens keep arriving\n'} running={false} />,
    )
     expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText(zh['reasoning.hidden'])).toBeTruthy()
    expect(view.container.textContent).not.toContain('Newest reasoning tokens keep arriving')
    expect(view.queryByText('运行中')).toBeNull()
  })

  it('expands from either Think or the reasoning summary', () => {
    const view = render(
      <ReasoningRow t={t} text={'Inspect the session\nCheck persistence'} running={false} />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText(zh['reasoning.hidden']))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(zh['reasoning.body'])).toBeTruthy()

    fireEvent.click(view.getByText(zh['reasoning.title']))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded Razonamiento drops the inline summary and renders localized status, no IN card', () => {
    const view = render(
      <ReasoningRow t={t} text={'Inspect the session\nCheck persistence'} running={false} />,
    )
    fireEvent.click(view.getByText(zh['reasoning.title']))
    expect(view.getAllByText(zh['reasoning.body'])).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })
})
