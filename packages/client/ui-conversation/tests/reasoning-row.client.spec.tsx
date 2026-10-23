// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@phoenix-ai/dsh-client-test-runtime'
import { en as commonEn } from '@phoenix-ai/dsh-client-locale/src/locales/en.ts'
import { es as commonEs } from '@phoenix-ai/dsh-client-locale/src/locales/es.ts'
import { zh as commonZh } from '@phoenix-ai/dsh-client-locale/src/locales/zh.ts'
import { en, es, zh } from '../src/client/locales.ts'
import { ReasoningRow, reasoningMatchesLocale } from '../src/client/chat/ReasoningRow.tsx'

afterEach(cleanup)

const spanish = makeTranslate(es, commonEs)
const english = makeTranslate(en, commonEn)
const chinese = makeTranslate(zh, commonZh)

describe('ReasoningRow: user-controlled provider text', () => {
  it('never shows model-emitted text until the user expands the row', () => {
    const view = render(<ReasoningRow t={spanish} text="He comprobado el registro actual." running />)
    const trigger = view.getByRole('button', { name: /Razonamiento/ })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.textContent).not.toContain('He comprobado el registro actual.')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('He comprobado el registro actual.')
    expect(view.container.querySelector('[data-reasoning-source="provider"]')).not.toBeNull()
  })

  it('updates genuine provider text without resetting a manual disclosure', () => {
    const view = render(<ReasoningRow t={spanish} text="Primera observación." running />)
    const trigger = view.getByRole('button', { name: /Razonamiento/ })
    fireEvent.click(trigger)
    view.rerender(<ReasoningRow t={spanish} text="Primera observación.\nSegunda observación." running />)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('Segunda observación.')
    view.rerender(<ReasoningRow t={spanish} text="Primera observación.\nSegunda observación." running={false} />)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.textContent).toContain('Segunda observación.')
  })

  it('blocks Chinese content when the configured language is Spanish or English', () => {
    const content = '正在分析错误原因'
    expect(reasoningMatchesLocale(content, 'es')).toBe(false)
    expect(reasoningMatchesLocale(content, 'en')).toBe(false)
    const view = render(<ReasoningRow t={spanish} text={content} running={false} />)
    fireEvent.click(view.getByRole('button', { name: /Razonamiento/ }))
    expect(view.container.textContent).not.toContain(content)
    expect(view.container.textContent).toContain(es['reasoning.unavailableLanguage'])
    view.rerender(<ReasoningRow t={english} text={content} running={false} />)
    expect(view.container.textContent).toContain(en['reasoning.unavailableLanguage'])
    expect(view.container.textContent).not.toContain(content)
  })

  it('shows native-script content only when that locale is selected', () => {
    const content = '正在分析错误原因'
    expect(reasoningMatchesLocale(content, 'zh')).toBe(true)
    const view = render(<ReasoningRow t={chinese} text={content} running={false} />)
    fireEvent.click(view.getByRole('button', { name: zh['reasoning.title'] }))
    expect(view.container.textContent).toContain(content)
  })

  it('does not invent a summary when a provider sends no text', () => {
    const view = render(<ReasoningRow t={spanish} text=" " running={false} />)
    fireEvent.click(view.getByRole('button', { name: /Razonamiento/ }))
    expect(view.container.textContent).toContain(es['reasoning.pending'])
  })
})
