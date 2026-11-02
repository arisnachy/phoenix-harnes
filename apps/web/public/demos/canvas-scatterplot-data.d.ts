/** Type declarations for the browser-loaded Canvas2D scatterplot demo module. */
export interface ScatterPoint {
  index: number
  x: number
  y: number
  group: string
}

export const GROUPS: readonly string[]
export const POINT_COUNT: number
export function createPoints(seed: number): ScatterPoint[]
