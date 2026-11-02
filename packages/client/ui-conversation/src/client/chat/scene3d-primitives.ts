/** Triangulated ring oriented in the XZ plane (Y is the torus axis).
 * Built in local unit coordinates; scene node size and rotation shape the object.
 * The same triangles must be used for the interactive preview and glTF export.
 */
export function torusTriangles(segments = 32, sides = 12): number[] {
  const vertices: number[] = []
  const majorRadius = 0.41
  const minorRadius = 0.09
  const point = (u: number, v: number): [number, number, number] => {
    const a = Math.PI * 2 * u / segments
    const b = Math.PI * 2 * v / sides
    const r = majorRadius + minorRadius * Math.cos(b)
    return [r * Math.cos(a), minorRadius * Math.sin(b), r * Math.sin(a)]
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const a = point(i, j), b = point(i + 1, j)
      const c = point(i + 1, j + 1), d = point(i, j + 1)
      vertices.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  return vertices
}
