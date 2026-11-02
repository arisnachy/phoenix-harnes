/** Shell base styles stay independent from the dynamically loaded theme bundle. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const THEME_PACKAGE = '@phoenix-ai/dsh-client-ui-theme'
const baseCss = readFileSync(fileURLToPath(new URL('../src/base.css', import.meta.url)), 'utf8')

/**
 * Import specifiers of the sheet, in source order. Quote style and surrounding
 * whitespace are intentionally irrelevant; duplicate imports remain visible.
 * @param css - stylesheet text.
 * @returns import specifiers in declaration order.
 */
function importOrder(css: string): string[] {
  return [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier = '']) => specifier)
}

const imports = importOrder(baseCss)

describe('web shell base.css', () => {
  it('paints the modern warm Phoenix shell before plugins load', () => {
    expect(baseCss).toContain('background: var(--dsw-alias-bg-base, #f8f7f4)')
    expect(baseCss).toContain('color: var(--dsw-alias-label-primary, #272522)')
    expect(baseCss).toContain('body[data-ds-dark-theme]')
  })
  it('leaves theme styles to the dynamic ui-theme client entry', () => {
    expect(imports).toEqual([])
    expect(baseCss).not.toContain(THEME_PACKAGE)
  })
})
