export const POINT_COUNT = 100_000
export const GROUPS = Object.freeze(['Alpha', 'Beta', 'Gamma', 'Delta'])

/** Create a stable, evenly distributed synthetic dataset for the live demo. */
export function createPoints(seed = 42) {
  let state = (seed >>> 0) || 0x9e3779b9
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const points = new Array(POINT_COUNT)
  for (let index = 0; index < POINT_COUNT; index += 1) {
    const group = GROUPS[Math.floor(next() * GROUPS.length)] ?? GROUPS[0]
    points[index] = { index, x: next(), y: next(), group }
  }
  return points
}
