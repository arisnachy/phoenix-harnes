// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'u'))?.[1] ?? ''
}

describe('Effort selector styling', () => {
  it('matches the roomy Phoenix-blue reference card with a thin track and large thumb', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/ModelSelect.module.css'), 'utf8')

    expect(rule(css, '.effortMenu')).toMatch(/width:\s*min\(470px, calc\(100vw - 32px\)\);/u)
    expect(rule(css, '.effortMenu')).toMatch(/border-radius:\s*26px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/padding:\s*26px 30px 32px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/--effort-blue:\s*var\(--dsw-static-blue-600, #2563eb\);/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-size:\s*22px;/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-weight:\s*700;/u)
    expect(rule(css, '.effortModel')).toMatch(/font-size:\s*18px;/u)
    expect(rule(css, '.effortModel')).toMatch(/margin-top:\s*8px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/height:\s*60px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/margin-top:\s*34px;/u)
    expect(rule(css, '.effortTrack')).toMatch(/height:\s*10px;/u)
    expect(rule(css, '.effortStop')).toMatch(/width:\s*6px;/u)
    expect(rule(css, '.effortStop')).toMatch(/background:\s*var\(--dsw-alias-bg-layer-1, #fff\);/u)
    expect(rule(css, '.effortRange')).toMatch(/height:\s*60px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-runnable-track')).toMatch(/height:\s*10px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/width:\s*56px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/height:\s*56px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/margin-top:\s*-23px;/u)
  })
})
