import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/chat/UniversalArtifactSurface.module.css', import.meta.url)), 'utf8')

/**
 * Read declarations for one exact CSS selector.
 * @param selector - Exact selector text.
 * @returns The selector declarations, or undefined when absent.
 */
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

describe('UniversalArtifactSurface.module.css', () => {
  it('lets the outer surface grow with its content', () => {
    const root = declarations('.root')
    expect(root?.get('max-height')).toBeUndefined()
    expect(root?.get('overflow')).toBeUndefined()
    expect(declarations('.expanded')?.get('max-height')).toBeUndefined()
  })
})
