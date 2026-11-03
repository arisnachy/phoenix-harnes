/** Universal, subject-independent 3D composition checks.
 * Checks spatial/structural evidence only, never visual realism or physical correctness.
 */
export type Scene3DRelation =
  | 'above' | 'below' | 'on' | 'inside' | 'near'
  | 'attached' | 'left-of' | 'right-of' | 'in-front-of' | 'behind'

export interface Scene3DObjectRequirement {
  readonly id: string
  readonly minParts?: number
  readonly minTriangles?: number
  readonly animated?: boolean
}
export interface Scene3DRelationRequirement {
  readonly from: string
  readonly to: string
  readonly relation: Scene3DRelation
  /** Metres of positional tolerance (default 0.2; maximum 5). */
  readonly tolerance?: number
}
export interface Scene3DCompositionContract {
  readonly objects: readonly Scene3DObjectRequirement[]
  readonly relations?: readonly Scene3DRelationRequirement[]
}
export interface Scene3DCompositionNode {
  readonly objectId?: string
  readonly name?: string
  readonly type: string
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly vertices?: readonly number[]
}
export interface Scene3DCompositionScene {
  readonly nodes: readonly Scene3DCompositionNode[]
  readonly animations?: readonly {
    readonly tracks: readonly { readonly node: string }[]
  }[]
}
export interface Scene3DCompositionAudit {
  readonly passed: boolean
  readonly checks: number
  readonly errors: readonly string[]
}

const identifier = /^[a-z0-9_-]{1,64}$/iu
const relations: readonly string[] = [
  'above','below','on','inside','near','attached',
  'left-of','right-of','in-front-of','behind',
]

/** Parse and bound user/model requirements without trusting arbitrary code or scene claims.
 * @param value - Data-only contract from the modeling tool call.
 * @returns Sanitized, bounded requirements.
 */
export function parseScene3DCompositionContract(value: unknown): Scene3DCompositionContract {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('compositionContract debe ser un objeto.')
  }
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.objects) || data.objects.length < 1 || data.objects.length > 60) {
    throw new Error('compositionContract.objects requiere entre 1 y 60 objetos.')
  }
  const objects: Scene3DObjectRequirement[] = []
  const ids = new Set<string>()
  for (const raw of data.objects) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('Cada objeto obligatorio requiere un id.')
    }
    const object = raw as Record<string, unknown>
    if (typeof object.id !== 'string' || !identifier.test(object.id) || ids.has(object.id)) {
      throw new Error('Los identificadores de objeto deben ser válidos y únicos.')
    }
    ids.add(object.id)
    const minParts = object.minParts
    const minTriangles = object.minTriangles
    if (minParts !== undefined && (!Number.isInteger(minParts) || (minParts as number) < 1
      || (minParts as number) > 150)) throw new Error('minParts debe estar entre 1 y 150.')
    if (minTriangles !== undefined && (!Number.isInteger(minTriangles)
      || (minTriangles as number) < 0 || (minTriangles as number) > 20_000)) {
      throw new Error('minTriangles debe estar entre 0 y 20000.')
    }
    if (object.animated !== undefined && typeof object.animated !== 'boolean') {
      throw new Error('animated debe ser boolean.')
    }
    objects.push({
      id: object.id,
      ...(minParts === undefined ? {} : { minParts: minParts as number }),
      ...(minTriangles === undefined ? {} : { minTriangles: minTriangles as number }),
      ...(object.animated === undefined ? {} : { animated: object.animated as boolean }),
    })
  }
  if (data.relations !== undefined && (!Array.isArray(data.relations) || data.relations.length > 100)) {
    throw new Error('compositionContract.relations admite hasta 100 relaciones.')
  }
  const edges: Scene3DRelationRequirement[] = []
  for (const raw of (data.relations ?? []) as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('Relación 3D inválida.')
    }
    const edge = raw as Record<string, unknown>
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string'
      || edge.from === edge.to || !ids.has(edge.from) || !ids.has(edge.to)
      || !relations.includes(String(edge.relation))) {
      throw new Error('Las relaciones deben conectar objetos distintos declarados en el contrato.')
    }
    if (edge.tolerance !== undefined && (typeof edge.tolerance !== 'number'
      || !Number.isFinite(edge.tolerance) || edge.tolerance < 0 || edge.tolerance > 5)) {
      throw new Error('La tolerancia espacial debe estar entre 0 y 5 metros.')
    }
    edges.push({
      from: edge.from, to: edge.to, relation: edge.relation as Scene3DRelation,
      ...(edge.tolerance === undefined ? {} : { tolerance: edge.tolerance }),
    })
  }
  return { objects, ...(data.relations === undefined ? {} : { relations: edges }) }
}

type Vector = readonly [number, number, number]
interface Bounds { readonly min: Vector; readonly max: Vector; readonly center: Vector }
function bounds(nodes: readonly Scene3DCompositionNode[]): Bounds {
  const min: number[] = [Infinity, Infinity, Infinity]
  const max: number[] = [-Infinity, -Infinity, -Infinity]
  for (const node of nodes) for (let i = 0; i < 3; i++) {
    // Conservative AABB proxy. Node rotation and actual mesh topology require renderer-side QA.
    min[i] = Math.min(min[i]!, node.position[i]! - node.size[i]! / 2)
    max[i] = Math.max(max[i]!, node.position[i]! + node.size[i]! / 2)
  }
  return {
    min: [min[0]!,min[1]!,min[2]!],
    max: [max[0]!,max[1]!,max[2]!],
    center: [(min[0]!+max[0]!)/2,(min[1]!+max[1]!)/2,(min[2]!+max[2]!)/2],
  }
}
function gap(a: Bounds, b: Bounds, axis: number): number {
  return Math.max(0, a.min[axis]! - b.max[axis]!, b.min[axis]! - a.max[axis]!)
}
function overlaps(a: Bounds, b: Bounds, axis: number, tolerance: number): boolean {
  return gap(a,b,axis) <= tolerance
}
function conforms(a: Bounds, b: Bounds, relation: Scene3DRelation, tolerance: number): boolean {
  const horizontal = overlaps(a,b,0,tolerance) && overlaps(a,b,2,tolerance)
  switch (relation) {
    case 'on': return horizontal && Math.abs(a.min[1] - b.max[1]) <= tolerance
    case 'above': return horizontal && a.center[1] > b.center[1] + tolerance
    case 'below': return horizontal && a.center[1] < b.center[1] - tolerance
    case 'inside': return [0,1,2].every(i =>
      a.min[i]! >= b.min[i]! - tolerance && a.max[i]! <= b.max[i]! + tolerance)
    case 'near': return Math.hypot(gap(a,b,0),gap(a,b,1),gap(a,b,2)) <= Math.max(1,tolerance)
    case 'attached': return Math.hypot(gap(a,b,0),gap(a,b,1),gap(a,b,2)) <= tolerance
    case 'left-of': return a.center[0] < b.center[0] - tolerance
    case 'right-of': return a.center[0] > b.center[0] + tolerance
    // Positive Z is the forward axis in PHOENIX's native 3D scene conventions.
    case 'in-front-of': return a.center[2] > b.center[2] + tolerance
    case 'behind': return a.center[2] < b.center[2] - tolerance
  }
}

/** Verify arbitrary required parts, approximate object relations and animation targets.
 * @param scene - Already normalized portable scene.
 * @param contract - Parsed semantic object graph contract.
 * @returns Evidence-based structural admission; not photorealism or topology certification.
 */
export function auditScene3DComposition(scene: Scene3DCompositionScene,
  contract: Scene3DCompositionContract): Scene3DCompositionAudit {
  const errors: string[] = []
  const groups = new Map<string, Scene3DCompositionNode[]>()
  for (const node of scene.nodes) if (node.objectId !== undefined) {
    const nodes = groups.get(node.objectId) ?? []
    nodes.push(node)
    groups.set(node.objectId, nodes)
  }
  const tracks = new Set(scene.animations?.flatMap(clip => clip.tracks.map(track => track.node)) ?? [])
  const objectCount = contract.objects.length
  for (const object of contract.objects) {
    const nodes = groups.get(object.id) ?? []
    if (nodes.length === 0) { errors.push(`Falta el objeto obligatorio ${object.id}.`); continue }
    if (nodes.length < (object.minParts ?? 1)) {
      errors.push(`El objeto ${object.id} necesita ${object.minParts} piezas, tiene ${nodes.length}.`)
    }
    const triangles = nodes.reduce((count,node) =>
      count + (node.type === 'mesh' ? Math.floor((node.vertices?.length ?? 0)/9) : 0), 0)
    if (triangles < (object.minTriangles ?? 0)) {
      errors.push(`El objeto ${object.id} necesita al menos ${object.minTriangles} triángulos de malla.`)
    }
    if (object.animated === true && !nodes.some(node => node.name !== undefined && tracks.has(node.name))) {
      errors.push(`El objeto ${object.id} necesita animación verificable.`)
    }
  }
  const cached = new Map<string, Bounds>()
  const getBounds = (id: string): Bounds | undefined => {
    if (cached.has(id)) return cached.get(id)
    const nodes=groups.get(id)
    if (nodes===undefined||nodes.length===0) return undefined
    const box=bounds(nodes)
    cached.set(id,box)
    return box
  }
  for (const edge of contract.relations ?? []) {
    const from=getBounds(edge.from),to=getBounds(edge.to)
    if (from===undefined||to===undefined) continue
    if (!conforms(from,to,edge.relation,edge.tolerance ?? .2)) {
      errors.push(`Relación espacial incumplida: ${edge.from} ${edge.relation} ${edge.to}.`)
    }
  }
  return { passed:errors.length===0,checks:objectCount+(contract.relations?.length??0),errors }
}
