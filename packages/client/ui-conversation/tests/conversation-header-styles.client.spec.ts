import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)),
  'utf8',
)
const heroCss = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/HeroShell.module.css', import.meta.url)),
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
  it('uses a compact conversation bar with resilient long titles', () => {
    expect(css).toContain('min-height: 56px;')
    expect(css).toContain('.unifiedHeader .crumbCurrent')
    expect(css).toContain('text-overflow: ellipsis;')
    expect(css).toContain('.unifiedHeader .headerUtilities')
    expect(css).toContain('@media (max-width: 720px)')
  })

  it('never hides active chrome and balances the hero title against global controls', () => {
    expect(css).toContain(".root[data-header-compact='true']:not([data-phase='hero']) .sessionChrome")
    expect(css).toContain(".root[data-phase='hero'] .sessionChrome { display: none; }")
    expect(css).toContain('.headerBrand {')
    expect(css).toContain('align-self: stretch;')
    expect(css).toContain('left: 50%;')
    expect(css).toContain('@media (max-width: 1400px)')
  })

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

describe('ConversationRoot UI-2 composer', () => {
  it('uses a Codex-scale responsive composer column', () => {
    expect(declarations('.root')?.get('--dsh-chat-content-width')).toBe('768px')
    expect(declarations('.root')?.get('--dsh-composer-card-max-width')).toBe('calc(var(--dsh-chat-content-width) + 32px)')
    expect(declarations('.root')?.get('--dsh-composer-side-clearance')).toBe('clamp(10px, 2vw, 18px)')
  })

  it('gives the composer a floating card and visible neutral focus treatment', () => {
    const card = declarations('.root :global([data-composer-card])')
    expect(card?.get('border-radius')).toBe('26px')
    expect(card?.get('box-shadow')).toBe('var(--dsw-shadow-lv2)')
    expect(card?.get('transition')).toContain('border-color')

    const focused = declarations('.root :global([data-composer-card]):focus-within')
    expect(focused?.get('border-color')).toBe('var(--dsw-alias-border-l2)')
    expect(focused?.get('box-shadow')).toContain('0 0 0 1px var(--dsw-alias-border-l2)')
  })

  it('keeps the active dock safe-area aware', () => {
    expect(declarations(".root[data-phase='active'] .composerSeat")?.get('padding-bottom'))
      .toBe('env(safe-area-inset-bottom)')
  })
})

describe('Centered new-session identity', () => {
  it('keeps the hero column symmetric even with the browser scroll rail visible', () => {
    expect(css).toContain('scrollbar-gutter: stable both-edges;')
    expect(css).toContain('align-items: center;')
    expect(css).toContain('margin-inline: auto;')
    expect(css).toContain("min-height: 100%;")
  })

  it('centers the mark, title and subtitle on the same width as the real composer', () => {
    expect(heroCss).toContain('place-items: center;')
    expect(heroCss).toContain('max-width: min(100%, var(--dsh-composer-card-max-width));')
    expect(heroCss).toContain('text-wrap: balance;')
    expect(heroCss).toContain('margin-inline: auto;')
  })

  it('does not alter the session composer dock or its keyboard and model slots', () => {
    expect(declarations(".root[data-phase='active'] .composerSeat")?.get('position'))
      .toBe('sticky')
    expect(css).toContain('transform: translateX(calc(0px - var(--dsh-chat-floating-overlay-axis-shift, 0px)))')
  })
})
