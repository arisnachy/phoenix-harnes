import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function css(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

function declaration(source: string, selector: string, property: string): string | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      if (part.slice(0, colon).trim() === property) return part.slice(colon + 1).trim().replace(/\s+/g, ' ')
    }
  }
  return undefined
}

describe('technical chat chrome copy isolation', () => {
  it('keeps the Tools disclosure out of ordinary transcript selection', () => {
    const source = css('../src/client/chat/ToolActivityFlow.module.css')
    expect(declaration(source, '.toggle', 'user-select')).toBe('none')
  })

  it('keeps transient Phoenix work status out of ordinary transcript selection', () => {
    const source = css('../src/client/chat/ChatView.module.css')
    expect(declaration(source, '.turnStatus', 'user-select')).toBe('none')
  })
})
