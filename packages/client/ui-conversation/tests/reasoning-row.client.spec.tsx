// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()

function flushAnimationFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    for (const callback of callbacks) callback(index)
  }
}

beforeEach(() => {
  nextAnimationFrameId = 1
  animationFrames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('auto-opens while streaming, keeps a manual collapse, and auto-collapses on settle', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')
    // Streaming phase starts expanded with the full body visible.
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).toContain('Newest reasoning tokens')

    // A manual collapse wins for the rest of the phase and restores the follower.
    fireEvent.click(view.getByText('Think'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
    const summary = view.getByText('Newest reasoning tokens')
    Object.defineProperties(summary, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
    })

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    flushAnimationFrames(2)
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(1)
    expect(summary.scrollLeft).toBe(200)
    expect(summary.getAttribute('data-follow-end')).toBe('true')

    // Settling auto-collapses and restores the settled first line.
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    flushAnimationFrames(3)
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.queryByText('运行中')).toBeNull()
    expect(summary.scrollLeft).toBe(0)
    expect(summary.hasAttribute('data-follow-end')).toBe(false)
  })

  it('expands from either Think or the reasoning summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('Think'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded Think drops the inline summary and renders plain prose, no IN card', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('Think'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })
})
