// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { en as commonEn } from '@phoenix-ai/dsh-client-locale/src/locales/en.ts'
import { es as commonEs } from '@phoenix-ai/dsh-client-locale/src/locales/es.ts'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import { en, es, zh } from '../src/client/locales.ts'
import { ReasoningRow, type ReasoningEvidence } from '../src/client/chat/ReasoningRow.tsx'

afterEach(cleanup)
const spanish = makeTranslate(es, commonEs)
const english = makeTranslate(en, commonEn)
const chinese = makeTranslate(zh, commonZh)
const events: ReasoningEvidence[] = [
  { name: 'web_search', state: 'running' },
  { name: 'test_runner', state: 'success' },
]

describe('ReasoningRow: verified activity and private reasoning protection', () => {
  it('discloses actual tool events only after user selection', () => {
    const view = render(<ReasoningRow t={spanish} evidence={events} running />)
    const toggle = view.getByRole('button', { name: /Razonamiento/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.textContent).not.toContain('web_search')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('web_search')
    expect(view.container.textContent).toContain('test_runner')
    expect(view.container.textContent).toContain(es['reasoning.toolRunning'])
    expect(view.container.textContent).toContain(es['reasoning.toolDone'])
    expect(view.container.querySelector('[data-reasoning-source="tool-events"]')).not.toBeNull()
  })

  it('tracks real status transitions without closing an opened disclosure', () => {
    const view = render(<ReasoningRow t={spanish} evidence={[events[0]!]} running />)
    const toggle = view.getByRole('button', { name: /Razonamiento/ })
    fireEvent.click(toggle)
    view.rerender(<ReasoningRow t={spanish} evidence={[{ name: 'web_search', state: 'error' }]} running={false} />)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain(es['reasoning.toolFailed'])
    expect(view.container.textContent).not.toContain(es['reasoning.toolRunning'])
  })

  it('does not invent a tool event if none was recorded', () => {
    const view = render(<ReasoningRow t={spanish} evidence={[]} running={false} />)
    fireEvent.click(view.getByRole('button', { name: /Razonamiento/ }))
    expect(view.container.textContent).toContain(es['reasoning.noEvents'])
    expect(view.container.querySelectorAll('li')).toHaveLength(0)
  })

  it('hides unexpected Chinese-script tool names in Spanish and English', () => {
    const input: ReasoningEvidence[] = [{ name: '搜索内部工具', state: 'success' }]
    const view = render(<ReasoningRow t={spanish} evidence={input} running={false} />)
    fireEvent.click(view.getByRole('button', { name: /Razonamiento/ }))
    expect(view.container.textContent).not.toContain(input[0]!.name)
    expect(view.container.textContent).toContain(es['reasoning.toolUnnamed'])
    view.rerender(<ReasoningRow t={english} evidence={input} running={false} />)
    expect(view.container.textContent).toContain(en['reasoning.toolUnnamed'])
    expect(view.container.textContent).not.toContain(input[0]!.name)
    view.rerender(<ReasoningRow t={chinese} evidence={input} running={false} />)
    expect(view.container.textContent).toContain(input[0]!.name)
  })

  it('does not present free-form reasoning or tool arguments as execution evidence', () => {
    const view = render(<ReasoningRow t={spanish} evidence={[{ name: 'browser_open', state: 'success' }]} running={false} />)
    fireEvent.click(view.getByRole('button', { name: /Razonamiento/ }))
    expect(view.container.textContent).not.toContain('Internal thoughts')
    expect(view.container.textContent).not.toContain('password=')
    expect(view.container.textContent).toContain('browser_open')
  })
})
