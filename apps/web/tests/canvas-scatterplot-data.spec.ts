import { describe, expect, it } from 'vitest'
import { createPoints, GROUPS, POINT_COUNT } from '../public/demos/canvas-scatterplot-data.js'

type ScatterPoint = { index: number; x: number; y: number; group: string }

describe('Canvas2D scatterplot data', () => {
  it('creates exactly 100,000 finite points with stable seeded output', () => {
    const first: ScatterPoint[] = createPoints(42)
    const second: ScatterPoint[] = createPoints(42)

    expect(POINT_COUNT).toBe(100_000)
    expect(first).toHaveLength(POINT_COUNT)
    expect(first.slice(0, 3)).toEqual(second.slice(0, 3))
    expect(first.at(-1)).toEqual(second.at(-1))
    expect(first[0]?.index).toBe(0)
    expect(first.at(-1)?.index).toBe(POINT_COUNT - 1)
    expect(first.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    expect(first.every(point => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)).toBe(true)
    expect(first.every(point => GROUPS.includes(point.group))).toBe(true)
  })
})