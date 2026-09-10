import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
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

describe('ConversationRoot premium header', () => {
  it('uses compact shell geometry', () => {
    expect(declarations('.header')?.get('padding')).toBe('8px 16px 0')
    expect(declarations('.titleRow')?.get('min-height')).toBe('36px')
    expect(declarations('.titleCluster')?.get('gap')).toBe('6px')
    expect(declarations('.crumb')?.get('border-radius')).toBe('8px')
    expect(declarations('.crumb')?.get('padding')).toBe('4px 6px')
    expect(declarations('.headerActions')?.get('gap')).toBe('4px')
    expect(declarations('.headerUtilities')?.get('gap')).toBe('4px')
    expect(declarations('.headerUtilities')?.get('margin-left')).toBe('12px')
    expect(declarations('.tabs')?.get('gap')).toBe('24px')
  })

  it('keeps the selected tab monochrome-first', () => {
    expect(declarations('.tabActive')?.get('color')).toBe('var(--dsw-alias-label-primary)')
    expect(declarations('.tabActive::after')?.get('background')).toBe('var(--dsw-alias-label-primary)')
  })
})
