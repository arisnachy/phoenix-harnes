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
const conversationRoot = readFileSync(
  fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.tsx', import.meta.url)),
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
  it('uses the approved 90px two-row header, not an overlapping floating tab strip', () => {
    expect(declarations('.unifiedHeader')?.get('min-height')).toBe('90px')
    expect(declarations('.unifiedHeader')?.get('grid-template-columns')).toBe('minmax(0, 1fr) auto')
    expect(css).toContain('.unifiedHeader .sessionNavRow')
    expect(declarations('.unifiedHeader .header')?.get('grid-template-rows')).toBe('34px 30px')
    expect(declarations('.unifiedHeader .titleRow')?.get('grid-template-columns')).toBe('minmax(0, 1fr) auto')
    expect(declarations('.unifiedHeader .sessionNavRow')?.get('overflow-x')).toBe('auto')
    expect(css).toContain('.unifiedHeader .crumbCurrent')
    expect(css).toContain('text-overflow: ellipsis;')
    expect(css).toContain('.unifiedHeader .headerUtilities')
    expect(css).toContain('position: static;')
    expect(css).toContain('@media (max-width: 720px)')
  })

  it('keeps all live header controls and separates hero from active sessions', () => {
    expect(css).toContain(".root[data-header-compact='true']:not([data-phase='hero']) .unifiedHeader")
    expect(css).toContain(".root[data-phase='hero'] .sessionChrome { display: none; }")
    expect(css).not.toContain('.headerBrand {')
    expect(conversationRoot).not.toContain('{hero && <span className={css.headerBrand}>PHOENIX</span>}')
    expect(conversationRoot).toContain('className={css.headerGlobal}')
    expect(css).toContain('.unifiedHeader .titleRow')
    expect(css).toContain('.unifiedHeader .headerActions')
    expect(css).toContain('.unifiedHeader .tabs')
  })

  it('collapses to one real row without discarding controls or accessibility', () => {
    const compact = ".root[data-header-compact='true']:not([data-phase='hero']) .unifiedHeader"
    expect(declarations(compact)?.get('min-height')).toBe('var(--phoenix-shell-bar-size, 72px)')
    expect(declarations(compact + ' .header')?.get('grid-template-rows')).toBe('34px')
    expect(declarations(compact + ' .sessionNavRow')?.get('display')).toBe('none')
    expect(declarations(compact + ' .headerGlobal')?.get('min-height')).toBe('36px')
    expect(css).toContain('grid-template-rows: auto;')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(conversationRoot).toContain('aria-pressed={headerPinnedOpen}')
    expect(conversationRoot).toContain("const hasDraft = (inputState?.draft ?? '').trim().length > 0")
    expect(conversationRoot).toContain('visualActive || (!hasDraft && headerAutoCompact)')
    expect(conversationRoot).not.toContain('headerHovered')
    expect(conversationRoot).not.toContain('headerFocused')
    expect(conversationRoot).toContain('[data-universal-artifact], [data-phoenix-scene3d], [data-phoenix-visual-kind]')
  })

  it('actually moves the collapsed bar to a small right-aligned tools pill on home and chat', () => {
    const compact = ".root[data-header-compact='true']:is([data-phase='hero'], [data-phase='active'], [data-phase='settling']) .unifiedHeader"
    // The compact CSS is applied to BOTH hero and active: no empty full-width header.
    expect(css).toContain(compact)
    expect(css).toContain('align-self: flex-end;')
    expect(css).toContain('width: max-content;')
    expect(css).toContain('max-width: calc(100% - 24px);')
    expect(css).toContain(".root[data-header-compact='true'] .unifiedHeader .sessionChrome")
    expect(css).toContain('display: none;')
    expect(conversationRoot).toContain("const headerCompact = !headerPinnedOpen")
    expect(conversationRoot).toContain('headerAutoCompact = hero')
    expect(conversationRoot).toContain('const firstSendPending =')
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

  it('uses Phoenix orange for the active conversation tab', () => {
    expect(declarations('.tabActive')?.get('color')).toBe('var(--dsw-alias-label-primary)')
    expect(declarations('.unifiedHeader .tabActive::after')?.get('background')).toBe('#ef5c20')
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

describe('Metallic welcome and aligned Session log controls', () => {
  it('keeps the approved Phoenix mark central, polished, and responsive without replacing the shared emblem', () => {
    expect(heroCss).toContain('/* Welcome emblem only: a larger polished gold-and-silver focal point.')
    expect(heroCss).toContain('width: 172px;')
    expect(heroCss).toContain('width: 156px;')
    expect(heroCss).toContain('saturate(1.18) contrast(1.08)')
    expect(heroCss).toContain('.fishHitbox::before')
    expect(heroCss).toContain('@media (max-width: 720px) and (max-height: 650px)')
    const mark = readFileSync(
      fileURLToPath(new URL('../src/client/skeleton/EmptyHero.tsx', import.meta.url)), 'utf8',
    )
    expect(mark).toContain("renderSlot('conversation.hero.brand.mark'")
  })

  it('aligns the Session log export and global actions only in the expanded session header', () => {
    const expanded = ".root:not([data-header-compact='true']):not([data-phase='hero']) .unifiedHeader .headerGlobal"
    expect(css).toContain(expanded)
    expect(declarations(expanded)?.get('align-self')).toBe('start')
    expect(declarations(expanded)?.get('height')).toBe('34px')
    expect(css).toContain('column-gap: 10px;')
    const exportButton = readFileSync(
      fileURLToPath(new URL('../../../session-query/session-log-export/src/client/HeaderAction.tsx', import.meta.url)), 'utf8',
    )
    expect(exportButton).toContain('aria-label="Session log"')
    expect(exportButton).toContain('request(sessionId)')
    const exportCss = readFileSync(
      fileURLToPath(new URL('../../../session-query/session-log-export/src/client/HeaderAction.module.css', import.meta.url)), 'utf8',
    )
    expect(exportCss).toContain('height: 34px;')
    expect(exportCss).toContain('@media (max-width: 720px)')
    expect(conversationRoot).toContain('className={css.headerGlobal}')
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
