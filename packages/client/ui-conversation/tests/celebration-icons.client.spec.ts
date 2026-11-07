import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { annualCalendar } from '../src/client/skeleton/celebrations.ts'

const folder = resolve('apps/web/public/assets/celebrations')
const manifest = JSON.parse(readFileSync(resolve(folder, 'manifest.json'), 'utf8')) as
  { id: string; label: string; theme: string; country: string }[]

describe('PHOENIX celebration transparent ornaments', () => {
  it('covers every curated fixed and movable celebration and personal birthday', () => {
    const eventIds = new Set(manifest.map(x => x.id))
    for (const event of annualCalendar(2026)) {
      expect(eventIds.has(event.id), event.id).toBe(true)
    }
    expect(eventIds.has('birthday')).toBe(true)
    expect(eventIds.has('external-default')).toBe(true)
    expect(new Set(manifest.map(x => x.id)).size).toBe(manifest.length)
  })

  it('keeps the official emblem separate; every SVG has transparent background', () => {
    const variants = new Set<string>()
    expect(existsSync(resolve('apps/web/public/phoenix-emblem.png'))).toBe(true)
    for (const event of manifest) {
      const artwork = readFileSync(resolve(folder, event.id + '.svg'), 'utf8')
      expect(artwork).toMatch(/^<svg\s/)
      expect(artwork).toContain('viewBox="0 0 512 512"')
      expect(artwork).toContain('</svg>')
      expect(artwork).not.toContain('<image ')
      expect(artwork).not.toContain('<script')
      expect(artwork).not.toContain('<foreignObject')
      expect(artwork).not.toContain('width="100%" height="100%"')
      variants.add(artwork)
    }
    expect(variants.size).toBe(manifest.length)
  })
})
