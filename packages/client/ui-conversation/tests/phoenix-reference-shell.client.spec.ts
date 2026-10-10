import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const header = source('../src/client/skeleton/ConversationRoot.tsx')
const headerCss = source('../src/client/skeleton/ConversationRoot.module.css')
const chatCss = source('../src/client/chat/ChatView.module.css')
const toolFlow = source('../src/client/chat/ToolActivityFlow.tsx')

describe('Phoenix approved header and thinking reference', () => {
  it('keeps the title and controls without a separate Phoenix brand in the top bar', () => {
    expect(header).toContain('aria-label="Barra superior de la conversación"')
    expect(header).toContain('<SessionHeaderOutlet')
    expect(header).toContain('className={css.headerGlobal}')
    expect(header).not.toContain('css.headerBrand')
    expect(headerCss).toContain('.unifiedHeader .titleCluster { min-width: 0; max-width: 100%; }')
    expect(headerCss).toContain('.unifiedHeader .headerGlobal { flex-shrink: 0; }')
    expect(headerCss).toContain('text-overflow: ellipsis;')
    expect(headerCss).toContain('grid-template-rows: 34px 30px;')
  })

  it('centers only first-turn genuine preparation without affecting later messages', () => {
    expect(toolFlow).toContain("turnStatus?.progress.phase === 'preparing'")
    expect(toolFlow).toContain('hasAssistantSurface(assistant)')
    expect(toolFlow).toContain("data-centered={centered ? 'true' : undefined}")
    expect(toolFlow.match(/centered={centeredPreparing}/g)).toHaveLength(2)
    expect(chatCss).toContain(".turnStatus[data-centered='true'] {")
    expect(chatCss).toContain('align-self: center;')
    expect(chatCss).toContain('margin: clamp(60px, 9vh, 110px) auto 16px;')
    expect(chatCss).toContain("@media (max-width: 720px)")
    expect(chatCss).toContain(".turnStatus[data-centered='true'] .turnStatusText")
  })
})
