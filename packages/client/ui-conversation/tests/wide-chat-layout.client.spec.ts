import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const rootCss = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
const chatCss = readFileSync(new URL('../src/client/chat/ChatView.module.css', import.meta.url), 'utf8')
const inputCss = readFileSync(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url), 'utf8')

describe('wide conversation canvas', () => {
  it('uses the free desktop width while honoring the floating KIRA inset', () => {
    expect(rootCss).toMatch(/--dsh-chat-content-width:\s*1024px/)
    expect(chatCss).toContain('var(--dsh-shell-right-overlay-inset, 0px)')
    expect(inputCss).toContain('var(--dsh-shell-right-overlay-inset, 0px)')
  })
})
