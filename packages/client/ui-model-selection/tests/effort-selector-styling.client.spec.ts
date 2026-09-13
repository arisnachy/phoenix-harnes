// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'gu'))]
    .map(match => match[1] ?? '')
    .join('\n')
}

describe('Effort selector styling', () => {
  it('matches the compact Codex-like card with a 28px bar and 36px thumb', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/ModelSelect.module.css'), 'utf8')

    expect(rule(css, '.effortMenu')).toMatch(/width:\s*min\(320px, calc\(100vw - 32px\)\);/u)
    expect(rule(css, '.effortMenu')).toMatch(/min-width:\s*min\(280px, calc\(100vw - 32px\)\);/u)
    expect(rule(css, '.effortMenu')).toMatch(/border-radius:\s*16px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/padding:\s*14px 18px 16px;/u)
    expect(rule(css, '.effortSelector')).toMatch(/--effort-blue:\s*var\(--dsw-static-blue-600, #2563eb\);/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-size:\s*16px;/u)
    expect(rule(css, '.effortTitle')).toMatch(/font-weight:\s*650;/u)
    expect(rule(css, '.effortModel')).toMatch(/font-size:\s*13px;/u)
    expect(rule(css, '.effortModel')).toMatch(/margin-top:\s*2px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/height:\s*36px;/u)
    expect(rule(css, '.effortSlider')).toMatch(/margin-top:\s*12px;/u)
    expect(rule(css, '.effortTrack')).toMatch(/top:\s*4px;/u)
    expect(rule(css, '.effortTrack')).toMatch(/height:\s*28px;/u)
    expect(rule(css, '.effortStops')).toMatch(/top:\s*15px;/u)
    expect(rule(css, '.effortStop')).toMatch(/width:\s*6px;/u)
    expect(rule(css, '.effortStop')).toMatch(/background:\s*var\(--dsw-alias-bg-layer-1, #fff\);/u)
    expect(rule(css, '.effortRange')).toMatch(/height:\s*36px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-runnable-track')).toMatch(/height:\s*28px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/width:\s*36px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/height:\s*36px;/u)
    expect(rule(css, '.effortRange::-webkit-slider-thumb')).toMatch(/margin-top:\s*-4px;/u)
  })
})
