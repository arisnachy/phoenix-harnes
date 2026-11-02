import type { Scene } from './scene3d-tool.ts'

type PelicanNode = Scene['nodes'][number]
type PelicanRing = readonly [z: number, y: number, radiusX: number, radiusY: number]

/** A closed triangular surface following bill and throat-pouch cross sections. */
function tube(rings: readonly PelicanRing[]): number[] {
  const slices = 16
  const sections = rings.map(([z, y, rx, ry]) =>
    Array.from({ length: slices }, (_, i): [number, number, number] => {
      const angle = 2 * Math.PI * i / slices
      return [rx * Math.cos(angle), y + ry * Math.sin(angle), z]
    }))
  const result: number[] = []
  const triangle = (a: readonly number[], b: readonly number[], c: readonly number[]): void => {
    result.push(...a, ...b, ...c)
  }
  for (let i = 0; i + 1 < sections.length; i++) {
    const current = sections[i]!, next = sections[i + 1]!
    for (let j = 0; j < slices; j++) {
      const k = (j + 1) % slices
      triangle(current[j]!, current[k]!, next[k]!)
      triangle(current[j]!, next[k]!, next[j]!)
    }
  }
  const first = sections[0]!, last = sections[sections.length - 1]!
  for (let j = 0; j < slices; j++) {
    const k = (j + 1) % slices
    triangle([0, rings[0]![1], rings[0]![0]], first[k]!, first[j]!)
    triangle([0, rings[rings.length - 1]![1], rings[rings.length - 1]![0]], last[j]!, last[k]!)
  }
  return result
}

/** Self-contained anatomical 3D illustration, not a photogrammetric reconstruction. */
export function pelicanScene(): Scene {
  const nodes: PelicanNode[] = []
  const piece = (type: PelicanNode['type'], name: string, position: [number, number, number],
    size: [number, number, number], color: string, extras: Partial<PelicanNode> = {}): void => {
    nodes.push({ type, name, position, size, color, ...extras })
  }
  piece('sphere', 'Cuerpo ovalado blanco', [0, 1.5, -0.55], [1.35, 1.3, 1.95], '#f3f1e9')
  piece('sphere', 'Pecho', [0, 1.75, 0.23], [0.92, 1.24, 1.18], '#f8f6ef')
  piece('sphere', 'Cuello curvo', [0, 2.12, 0.38], [0.52, 1.18, 0.57], '#f6f3ec',
    { rotation: [-20, 0, 0] })
  piece('sphere', 'Cabeza de pelícano', [0, 2.77, 0.66], [0.66, 0.62, 0.66], '#fbf9f2')
  piece('mesh', 'Pico largo superior', [0, 2.61, 0.92], [1, 1, 1], '#e8a43e', {
    vertices: tube([[0, 0, 0.17, 0.10], [0.45, 0.015, 0.15, 0.075],
      [1.18, -0.035, 0.10, 0.055], [1.95, -0.10, 0.018, 0.018]]),
  })
  piece('mesh', 'Bolsa gular bajo el pico', [0, 2.48, 1.07], [1, 1, 1], '#e9a878', {
    vertices: tube([[0, -0.02, 0.12, 0.08], [0.45, -0.23, 0.19, 0.27],
      [0.92, -0.37, 0.22, 0.32], [1.46, -0.24, 0.16, 0.22], [1.85, -0.10, 0.025, 0.025]]),
  })
  for (const side of [-1, 1]) {
    const x = side * 0.69
    piece('sphere', side < 0 ? 'Ala izquierda' : 'Ala derecha',
      [x, 1.64, -0.74], [0.25, 0.83, 1.42], '#deded7',
      { rotation: [0, side * 11, side * 18] })
    piece('sphere', side < 0 ? 'Ojo izquierdo' : 'Ojo derecho',
      [side * 0.295, 2.86, 0.86], [0.10, 0.10, 0.10], '#191c1d')
    piece('sphere', 'Pupila brillante', [side * 0.32, 2.89, 0.91],
      [0.034, 0.034, 0.034], '#ffffff')
    piece('cylinder', 'Pata de pelícano', [side * 0.38, 0.57, -0.62],
      [0.105, 0.9, 0.105], '#de9c49')
    piece('sphere', 'Pie palmeado', [side * 0.38, 0.11, -0.39],
      [0.48, 0.14, 0.73], '#df9d4b')
    for (const offset of [-0.19, 0, 0.19]) {
      piece('cone', 'Dedos del pie palmeado',
        [side * 0.38 + offset, 0.12, -0.02], [0.10, 0.14, 0.46], '#d78f38',
        { rotation: [90, 0, 0] })
    }
  }
  for (const x of [-0.27, 0, 0.27]) {
    piece('cone', 'Plumas de la cola', [x, 1.42, -1.61],
      [0.22, 0.82, 0.2], '#e5e2db', { rotation: [-76, 0, 0] })
  }
  return { version: 1, units: 'meters', name: 'Pelícano · modelo anatómico estilizado 3D',
    background: '#f8f5ed', nodes, environment: 'daylight', camera: 'isometric' }
}
