/** GNOSIS: provider-neutral semantic projection of the current tool registry.
 * No I/O, inference, new persistence, access grants or executable routing.
 */
import type { HardnessService } from '@phoenix-ai/dsh-hardness'
import { defineTool, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

type Atlas = ReturnType<HardnessService['snapshot']>
type ToolSchema = { readonly name: string; readonly description: string }
type EvidenceState = 'unverified' | 'passed' | 'failed' | 'denied' | 'conflicting' | 'stale'
type Node = {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly evidence: EvidenceState
  readonly evidenceCounts: { passed: number; failed: number; denied: number; stale: number }
  readonly dependencies: readonly string[]
  readonly unresolvedDependencies: number
  readonly source: 'visible-tool-registry'
}
type Graph = { readonly nodes: readonly Node[]; readonly index: ReadonlyMap<string, readonly string[]> }
const MAX_RESULTS = 20
const MAX_QUERY = 256
const MAX_DEPENDENCIES = 32
const STOP = new Set(['a','an','the','to','of','for','and','or','is','in','on','with','de','del','la','el','los','las','un','una','para','con','en','y','o','por','que','como','puedo','quiero','necesito','hacer','me'])
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  archivo: ['file'], archivos: ['file','files'], carpeta: ['folder','directory'],
  imagen: ['image','raster','photo'], imagenes: ['image','raster','photo'],
  buscar: ['search','find','retrieve'], busqueda: ['search','retrieve'],
  investigar: ['research','search'], investigacion: ['research'],
  grafico: ['chart','visualize','plot'], graficos: ['chart','visualize'],
  diagrama: ['diagram','graph'], voz: ['voice','speech','audio'],
  hablar: ['speak','speech','voice'], escuchar: ['audio','transcribe'],
  memoria: ['memory','learning'], recordar: ['memory','recall'],
  ventana: ['window','desktop'], ventanas: ['window','desktop'],
  pantalla: ['screen','screenshot'], navegador: ['browser'],
  documento: ['document','docx'], documentos: ['document','docx'],
  hoja: ['sheet','spreadsheet'], calculo: ['calculate','spreadsheet'],
  correo: ['email','mail'], calendario: ['calendar'], cita: ['appointment','calendar'],
  herramienta: ['tool','capability'], herramientas: ['tool','capability'],
  capacidades: ['capability','tool'], salud: ['health'], deporte: ['sports'],
  deportes: ['sports'], cuota: ['quota','usage'], cuotas: ['quota','usage'],
  modelo: ['model'], modelos: ['model'], reparar: ['repair','fix','recover'],
  verificar: ['verify','validate','check'], verificarlo: ['verify','validate'],
}
function tokens(value: string): string[] {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[a-z0-9]+/g)?.filter(word => !STOP.has(word)) ?? []
}
function safeToolName(name: string): boolean {
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,127}$/.test(name)
}
function evidenceState(counts: Node['evidenceCounts']): EvidenceState {
  if (counts.passed > 0 && (counts.failed > 0 || counts.denied > 0)) return 'conflicting'
  if (counts.failed > 0) return 'failed'
  if (counts.denied > 0) return 'denied'
  if (counts.passed > 0) return 'passed'
  return counts.stale > 0 ? 'stale' : 'unverified'
}
/** Derive only visible tool nodes; global or other-agent records cannot become nodes. */
export function buildGnosisGraph(schemas: readonly ToolSchema[], atlas: Atlas): Graph {
  const visible = new Map(schemas.filter(schema => safeToolName(schema.name)).map(schema => ['tool:' + schema.name, schema] as const))
  const descriptors = new Map(atlas.capabilities.filter(d => visible.has(d.id)).map(d => [String(d.id), d] as const))
  const counts = new Map<string, Node['evidenceCounts']>()
  for (const item of atlas.evidence) {
    const d = descriptors.get(item.capabilityId)
    if (d === undefined) continue
    const c = counts.get(d.id) ?? { passed: 0, failed: 0, denied: 0, stale: 0 }
    if (item.descriptorVersion !== d.version) c.stale += 1
    else c[item.outcome] += 1
    counts.set(d.id, c)
  }
  const index = new Map<string, readonly string[]>()
  const nodes: Node[] = []
  for (const [id, schema] of visible) {
    const d = descriptors.get(id)
    const c = counts.get(id) ?? { passed: 0, failed: 0, denied: 0, stale: 0 }
    const dependencies = [...new Set(d?.dependencies ?? [])]
    const linked = dependencies.filter(dep => visible.has(dep)).slice(0, MAX_DEPENDENCIES)
    nodes.push({ id, name: schema.name, status: d?.status ?? 'not-indexed', evidence: evidenceState(c),
      evidenceCounts: c, dependencies: linked, unresolvedDependencies: dependencies.length - linked.length,
      source: 'visible-tool-registry' })
    // Descriptions are searchable metadata, never returned or injected into prompts.
    index.set(id, [...tokens(schema.name), ...tokens(schema.name), ...tokens(schema.description.slice(0, 4096))])
  }
  nodes.sort((a,b) => a.id.localeCompare(b.id))
  return { nodes, index }
}
/** Deterministic BM25-style lexical retrieval with a small bilingual vocabulary. */
export function searchGnosis(graph: Graph, query: string, limit = 10) {
  const terms = [...new Set(tokens(query.slice(0, MAX_QUERY)).flatMap(t => [t, ...(Object.hasOwn(ALIASES, t) ? ALIASES[t] ?? [] : [])]))].slice(0, 32)
  if (terms.length === 0) return []
  const docs = graph.nodes.map(node => ({ node, words: graph.index.get(node.id) ?? [] }))
  const avg = docs.reduce((sum, doc) => sum + doc.words.length, 0) / Math.max(1, docs.length)
  const df = new Map(terms.map(term => [term, docs.filter(doc => doc.words.includes(term)).length]))
  const exact = query.trim().toLowerCase()
  return docs.map(({node,words}) => {
    let score = 0
    for (const term of terms) {
      const tf = words.filter(word => word === term).length
      if (tf === 0) continue
      const freq = df.get(term) ?? 0
      const idf = Math.log(1 + (docs.length - freq + .5) / (freq + .5))
      score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * words.length / Math.max(1, avg)))
    }
    if (node.name.toLowerCase() === exact || node.id.toLowerCase() === exact) score += 100
    return { node, score }
  }).filter(hit => hit.score > 0).sort((a,b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
    .slice(0, Math.max(1, Math.min(MAX_RESULTS, Math.trunc(limit) || 10))).map(hit => hit.node)
}
/** A candidate is not permission, a live probe, or successful execution. */
export function checkGnosis(graph: Graph, query: string) {
  const hits = searchGnosis(graph, query)
  const exact = hits.find(node => node.name === query.trim() || node.id === query.trim())
  if (exact === undefined) return { state: hits.length === 0 ? 'unknown' : 'candidates', candidates: hits }
  const blocked = ['broken','quarantined','deprecated'].includes(exact.status)
    || ['failed','denied','conflicting'].includes(exact.evidence) || exact.unresolvedDependencies > 0
  return { state: blocked ? 'recheck-required' : 'registered-not-probed', candidates: [exact] }
}
/** Traverse only declared, visible dependencies; cycles and output are bounded. */
export function traceGnosis(graph: Graph, target: string) {
  const byId = new Map(graph.nodes.map(node => [node.id,node]))
  const root = byId.get(target) ?? byId.get('tool:' + target)
  if (root === undefined) return { nodes: [], truncated: false }
  const seen = new Set<string>()
  const queue = [root]
  const nodes: Node[] = []
  while (queue.length > 0 && nodes.length < MAX_RESULTS) {
    const node = queue.shift()
    if (node === undefined || seen.has(node.id)) continue
    seen.add(node.id); nodes.push(node)
    for (const id of node.dependencies) {
      const dep = byId.get(id)
      if (dep !== undefined && !seen.has(id)) queue.push(dep)
    }
  }
  return { nodes, truncated: queue.some(node => !seen.has(node.id)) }
}

export const GNOSIS_PROTOCOL = 'GNOSIS is a provider-neutral read-only semantic view of the currently visible tool registry and exact-version HARDNESS evidence. For a non-trivial task with uncertain capability, use phoenix_gnosis search/check before guessing tool names; trace dependencies or inspect conflicts only when relevant. Reuse the returned candidates and verify live access through the actual tool and existing permission gates. Registry presence and historical passes never prove current availability, authorization, quota or completion. No results means unknown, not impossible. Do not search routinely when an exact mounted tool is already known. Do not interpret lexical scores as probabilities. GNOSIS cannot execute, certify, modify or install tools.'

export function createGnosisTool(hardness: Pick<HardnessService,'snapshot'>, schemas: () => readonly ToolSchema[]): ToolDefinition {
  return defineTool({
    name: 'phoenix_gnosis',
    description: 'Read-only GNOSIS capability graph: search visible tool names/meaning (English/Spanish), check an exact tool, trace declared dependencies, list conflicts/stale evidence, or paginate the inventory. Results never grant execution or permissions.',
    parameters: {
      operation: { type: 'string', enum: ['search','check','trace','conflicts','inspect'], required: true },
      query: { type: 'string', description: 'Search phrase or exact tool name/id; required for search, check and trace.' },
      offset: { type: 'number', description: 'Zero-based page offset for inspect/conflicts.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const graph = buildGnosisGraph(schemas(), hardness.snapshot())
      const query = (args.query ?? '').trim().slice(0, MAX_QUERY)
      const offset = Math.max(0, Math.trunc(Number.isFinite(args.offset) ? args.offset ?? 0 : 0))
      let result: unknown
      switch (args.operation) {
        case 'search': result = { candidates: searchGnosis(graph, query) }; break
        case 'check': result = checkGnosis(graph, query); break
        case 'trace': result = traceGnosis(graph, query); break
        case 'conflicts':
        case 'inspect': {
          const list = args.operation === 'conflicts' ? graph.nodes.filter(n => ['conflicting','stale','failed','denied'].includes(n.evidence) || n.unresolvedDependencies > 0) : graph.nodes
          result = { total: list.length, offset, nodes: list.slice(offset, offset + MAX_RESULTS), nextOffset: offset + MAX_RESULTS < list.length ? offset + MAX_RESULTS : null }
          break
        }
      }
      return JSON.parse(JSON.stringify({ schema: 'phoenix.gnosis.v1', authority: 'read-only-registry-metadata', privilegesGranted: false, result })) as Record<string, JsonValue>
    },
    presentCall: () => ({ card: 'generic', title: 'PHOENIX GNOSIS', kind: 'read' }),
  })
}
