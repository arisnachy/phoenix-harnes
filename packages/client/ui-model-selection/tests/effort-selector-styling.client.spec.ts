// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'u'))?.[1] ?? ''
}

describe('Effort selector styling', () => {
  it('keeps the Phoenix blue slider compact with a thick pill track', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/ModelSelect.module.css'), 'utf8')

    expect(rule(css, '.effortMenu')).toMatch(/border-radius:\s*18px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/padding:\s*16px 18px 18px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/--effort-blue:\s*var\(--dsw-static-blue-600, #2563eb\);/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-size:\s*16px;/u)
    expect(rule(css, '.effortModel')).toMatch(/font-size:\s*14px;/u)
    expect(rule(css, '.effortTrack')).toMatch(/height:\s*28px;/u)
    expect(rule(css, '.effortStop')).toMatch(/width:\s*6px;/u)
    expect(rule(css, '.effortStop')).toMatch(/background:\s*var\(--dsw-alias-bg-layer-1, #fff\);/u)
    expect(rule(css, '.effortRange')).toMatch(/height:\s*46px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/width:\s*42px;/u)
  })
})
