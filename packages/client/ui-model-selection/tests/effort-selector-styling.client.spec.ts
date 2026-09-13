// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'u'))?.[1] ?? ''
}

describe('Effort selector styling', () => {
  it('keeps the Phoenix effort selector compact and balanced beside the composer', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/ModelSelect.module.css'), 'utf8')

    expect(rule(css, '.effortMenu')).toMatch(/width:\s*min\(340px, calc\(100vw - 32px\)\);/u)
    expect(rule(css, '.effortMenu')).toMatch(/min-width:\s*min\(300px, calc\(100vw - 32px\)\);/u)
    expect(rule(css, '.effortMenu')).toMatch(/border-radius:\s*18px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/padding:\s*16px 20px 18px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/--effort-blue:\s*var\(--dsw-static-blue-600, #2563eb\);/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-size:\s*17px;/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-weight:\s*650;/u)
    expect(rule(css, '.effortModel')).toMatch(/font-size:\s*14px;/u)
    expect(rule(css, '.effortModel')).toMatch(/margin-top:\s*3px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/height:\s*40px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/margin-top:\s*16px;/u)
    expect(rule(css, '.effortTrack')).toMatch(/height:\s*8px;/u)
    expect(rule(css, '.effortStop')).toMatch(/width:\s*6px;/u)
    expect(rule(css, '.effortStop')).toMatch(/background:\s*var\(--dsw-alias-bg-layer-1, #fff\);/u)
    expect(rule(css, '.effortRange')).toMatch(/height:\s*40px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-runnable-track')).toMatch(/height:\s*8px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/width:\s*36px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/height:\s*36px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/margin-top:\s*-14px;/u)
  })
})
