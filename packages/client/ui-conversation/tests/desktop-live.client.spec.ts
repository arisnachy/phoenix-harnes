import { describe, expect, it } from 'vitest'
import { addDesktopCards, isDesktopPrompt } from '../src/client/chat/ToolActivityFlow.tsx'

describe('Desktop Live transcript visibility', () => {
  it('detects Paint and explicit Desktop Live without treating browser tasks as desktop', () => {
    expect(isDesktopPrompt('Abre Microsoft Paint, dibuja una casa y muéstrame Desktop Live')).toBe(true)
    expect(isDesktopPrompt('Abre el Bloc de notas y escribe hola')).toBe(true)
    expect(isDesktopPrompt('Abre una página en Chrome')).toBe(false)
    expect(isDesktopPrompt('Genera un informe científico con gráficos')).toBe(false)
  })

  it('shows a native viewer only beside its own user turn', () => {
    const first = { key: 'user-1', kind: 'user', data: { content: [{ type: 'text', text: 'Abre Paint y dibuja' }] } }
    const second = { key: 'user-2', kind: 'user', data: { content: [{ type: 'text', text: 'Hola' }] } }
    const output = addDesktopCards([
      { kind: 'node', key: 'user-1' }, { kind: 'node', key: 'user-2' },
    ], [first, second])
    expect(output.map(x => x.key)).toEqual(['user-1', 'desktop:user-1', 'user-2'])
  })
})
