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

/** Closed UV sphere at unit scale, outward winding and without zero-area pole faces.
 * Preview and GLB use the same geometry so exported assets look like the interactive model.
 */
export function sphereTriangles(segments = 32, rings = 20): number[] {
  const triangles: number[] = []
  const point = (latitude: number, longitude: number): [number,number,number] => [
    Math.cos(latitude) * Math.cos(longitude) * .5,
    Math.sin(latitude) * .5,
    Math.cos(latitude) * Math.sin(longitude) * .5,
  ]
  for (let j = 0; j < rings; j++) {
    const low = -Math.PI / 2 + Math.PI * j / rings
    const high = -Math.PI / 2 + Math.PI * (j + 1) / rings
    for (let i = 0; i < segments; i++) {
      const a = 2 * Math.PI * i / segments, b = 2 * Math.PI * (i + 1) / segments
      const p = point(low,a), q = point(low,b)
      const r = point(high,a), s = point(high,b)
      if (j === 0) triangles.push(...p,...r,...s)
      else if (j === rings - 1) triangles.push(...p,...r,...q)
      else triangles.push(...p,...r,...s,...p,...s,...q)
    }
  }
  return triangles
}
