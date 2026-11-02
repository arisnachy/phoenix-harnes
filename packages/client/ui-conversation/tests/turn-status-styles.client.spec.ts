import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/chat/ChatView.module.css', import.meta.url)),
  'utf8',
)

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('PHOENIX live turn status', () => {
  it('keeps the resting copy gray and confines the sweep to text glyphs', () => {
    expect(declarations('.turnStatus')?.get('color')).toBe('var(--dsw-alias-label-secondary)')
    const text = declarations('.turnStatusText')
    expect(text?.get('background')).toContain('var(--dsw-alias-label-secondary)')
    expect(text?.get('background')).toContain('var(--dsw-static-deepseek-500)')
    expect(text?.get('background-clip')).toBe('text')
    expect(text?.get('-webkit-background-clip')).toBe('text')
    expect(text?.get('animation')).toContain('dsh-turn-status-shimmer')
    expect(declarations('.turnStatus')?.get('background')).toBeUndefined()
  })

  it('defines distinct emblem reactions for observed activities', () => {
    for (const activity of ['preparing', 'thinking', 'searching', 'browsing', 'reading', 'writing', 'executing', 'verifying']) {
      expect(css).toContain(`data-activity='${activity}'`)
    }
  })

  it('turns off sweep and emblem motion when reduced motion is requested', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.turnStatusText')
    expect(reduced).toContain('background: none')
    expect(reduced).toContain('.phoenixActivity > img')
    expect(reduced).toContain('animation: none')
  })
})
