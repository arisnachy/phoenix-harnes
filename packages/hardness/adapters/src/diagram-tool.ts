import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** MIME consumed by the universal inline diagram renderer. */
export const PHOENIX_DIAGRAM_MIME = 'application/vnd.phoenix.diagram+json'
const shapes = ['square', 'circle', 'rectangle', 'diamond', 'point'] as const
const ports = ['top', 'bottom', 'left', 'right', 'center'] as const
const lineKinds = ['solid', 'dashed', 'arrow'] as const
const kinds = ['genogram', 'flowchart', 'mindmap', 'network', 'other'] as const
type Shape = typeof shapes[number]
type Port = typeof ports[number]
type LineKind = typeof lineKinds[number]
type Kind = typeof kinds[number]
type Waypoint = { readonly x: number; readonly y: number }
interface DiagramNode {
  readonly id: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly shape?: Shape
  readonly detail?: string
}
interface DiagramEdge {
  readonly from: string
  readonly to: string
  readonly fromPort?: Port
  readonly toPort?: Port
  readonly via?: readonly Waypoint[]
  readonly kind?: LineKind
  readonly label?: string
}
/** Serializable, safe graph payload for any native graph presentation. */
export interface PhoenixDiagram {
  readonly component: 'diagram'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly subtitle?: string
    readonly kind?: Kind
    readonly nodes: readonly DiagramNode[]
    readonly edges?: readonly DiagramEdge[]
    readonly note?: string
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key))
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const between = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
function invalid(message: string): never { throw new ToolArgsError([message]) }

/**
 * Admit a complete visual diagram without executing source from the model.
 * @param raw - Untrusted diagram fields submitted by a model.
 * @param title - Verified diagram title from the tool call.
 * @returns Renderable diagram or a precise validation error.
 */
export function admitPhoenixDiagram(raw: unknown, title: string): PhoenixDiagram {
  if (!record(raw) || !only(raw, ['id', 'subtitle', 'kind', 'nodes', 'edges', 'note']))
    invalid('diagram debe incluir nodes y opcionalmente edges, kind, note y subtitle; no scripts ni propiedades desconocidas.')
  if (raw.id !== undefined && !text(raw.id, 80)) invalid('diagram.id debe ser una cadena corta.')
  if (raw.subtitle !== undefined && !text(raw.subtitle, 250)) invalid('diagram.subtitle inválido.')
  if (raw.note !== undefined && !text(raw.note, 800)) invalid('diagram.note inválida.')
  if (raw.kind !== undefined && !kinds.includes(raw.kind as Kind)) invalid('diagram.kind inválido.')
  if (!Array.isArray(raw.nodes) || raw.nodes.length < 2 || raw.nodes.length > 70)
    invalid('Un diagrama requiere entre 2 y 70 nodos.')

  const nodes: DiagramNode[] = []
  const ids = new Set<string>()
  for (const [index, node] of raw.nodes.entries()) {
    if (!record(node) || !only(node, ['id', 'label', 'x', 'y', 'shape', 'detail'])
      || !text(node.id, 80) || ids.has(node.id)
      || !text(node.label, 100)
      || (node.shape !== undefined && !shapes.includes(node.shape as Shape))
      || !between(node.x, node.shape === 'point' ? 0 : 95, node.shape === 'point' ? 1000 : 905)
      || !between(node.y, node.shape === 'point' ? 0 : 80, node.shape === 'point' ? 620 : 520)
      || (node.detail !== undefined && !text(node.detail, 650)))
      invalid('Nodo ' + (index + 1) + ': id único, label y coordenadas x=95..905/y=80..520; junction point admite 0..1000/0..620.')
    ids.add(node.id as string)
    nodes.push({
      id: node.id as string, label: node.label as string,
      x: node.x as number, y: node.y as number,
      ...(node.shape === undefined ? {} : { shape: node.shape as Shape }),
      ...(node.detail === undefined ? {} : { detail: node.detail as string }),
    })
  }
  if (nodes.filter(node => node.shape !== 'point').length < 2)
    invalid('El diagrama requiere al menos dos nodos visibles, además de los puntos de unión ocultos.')
  if (raw.edges !== undefined && (!Array.isArray(raw.edges) || raw.edges.length > 140))
    invalid('edges debe tener 140 conexiones como máximo.')
  const edges: DiagramEdge[] = []
  if (Array.isArray(raw.edges)) for (const edge of raw.edges) {
    if (!record(edge) || !only(edge, ['from', 'to', 'fromPort', 'toPort', 'via', 'kind', 'label'])
      || !text(edge.from, 80) || !text(edge.to, 80)
      || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to
      || (edge.fromPort !== undefined && !ports.includes(edge.fromPort as Port))
      || (edge.toPort !== undefined && !ports.includes(edge.toPort as Port))
      || (edge.kind !== undefined && !lineKinds.includes(edge.kind as LineKind))
      || (edge.label !== undefined && !text(edge.label, 120))
      || (edge.via !== undefined && (!Array.isArray(edge.via) || edge.via.length > 12
        || !edge.via.every(point => record(point) && only(point, ['x', 'y'])
          && between(point.x, 0, 1000) && between(point.y, 0, 620)))))
      invalid('Conexión inválida: from/to existentes, puertos correctos y via[{x,y}] dentro del lienzo.')
    edges.push({
      from: edge.from as string, to: edge.to as string,
      ...(edge.fromPort === undefined ? {} : { fromPort: edge.fromPort as Port }),
      ...(edge.toPort === undefined ? {} : { toPort: edge.toPort as Port }),
      ...(edge.kind === undefined ? {} : { kind: edge.kind as LineKind }),
      ...(edge.label === undefined ? {} : { label: edge.label as string }),
      ...(edge.via === undefined ? {} : { via: edge.via as Waypoint[] }),
    })
  }
  const id = raw.id === undefined
    ? ('diagrama-' + title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64))
    : raw.id as string
  return {
    component: 'diagram', version: 1,
    props: {
      id: id || 'diagrama', title, nodes,
      ...(raw.kind === undefined ? {} : { kind: raw.kind as Kind }),
      ...(raw.subtitle === undefined ? {} : { subtitle: raw.subtitle as string }),
      ...(raw.note === undefined ? {} : { note: raw.note as string }),
      ...(edges.length === 0 ? {} : { edges }),
    },
  }
}

/**
 * Offer native diagrams to every provider through the universal tool registry.
 * @returns A model-facing publisher with a replayable conversation artifact.
 */
export function createPhoenixDiagramTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_diagram',
    description: 'MOTOR UNIVERSAL DE DIAGRAMAS: para crear o mostrar GENOGRAMAS familiares, diagramas de flujo, organigramas, mapas mentales, relaciones, redes, procesos o esquemas, llamar directamente esta herramienta y mostrar un artefacto nativo real EN EL CHAT. No sustituirlo con texto, JSON en prosa, navegador, localhost ni una declaración de éxito. Ejemplo: title="Genograma familiar", diagram={kind:"genogram",nodes:[{id:"padre",label:"Padre",x:260,y:145,shape:"square"},{id:"madre",label:"Madre",x:740,y:145,shape:"circle"},{id:"union",label:"Unión",x:500,y:145,shape:"point"},{id:"hijo",label:"Hijo",x:500,y:450,shape:"square"}],edges:[{from:"padre",to:"union",fromPort:"right"},{from:"union",to:"madre",toPort:"left"},{from:"union",to:"hijo",toPort:"top",via:[{x:500,y:330}]}]}. Canvas SVG 1000x620; nodos visibles x=95..905 y=80..520; junctions point y conectores via permiten todo el espacio. shape square=masculino, circle=femenino en genogramas, rectangle y diamond para flujos. Puertos top/bottom/left/right/center; conexiones kind solid/dashed/arrow. Añadir información clínica SOLO si se proporcionó y representarla claramente; nunca inventar antecedentes. Publicar una vez y permitir una respuesta final concisa del asistente; no repetir herramientas. Un artifactId acredita emisión, NO demuestra inspección del render visual del usuario. Para mapas geográficos usar geo; mapas ficticios usar phoenix_scene_map; gráficos cuantitativos phoenix_visualize; para imagen ilustrada usar generación de imágenes.',
    parameters: {
      title: { type: 'string', required: true, description: 'Título visible del genograma o diagrama.' },
      diagram: { type: 'object', required: true, additionalProperties: true,
        description: 'Grafo declarativo: kind?; nodes:[{id,label,x,y,shape?,detail?}]; edges?:[{from,to,fromPort?,toPort?,via?:[{x,y}],kind?,label?}]; subtitle?; note?.' },
      continueAfterDisplay: { type: 'boolean', description: 'True solo si el usuario pidió trabajo después del diagrama.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        artifactId: { type: 'string', required: true },
        title: { type: 'string', required: true },
        diagram: { type: 'json', required: true },
        publication: { type: 'string', required: true },
      }},
      render: (_args, result) => [{ type: 'text', text: 'Diagrama emitido como artefacto nativo: '
        + result.title + '. Emisión confirmada, presentación visual del cliente sin inspeccionar.' }],
      presentationMeta: (_args, result) => ({ artifact: {
        id: result.artifactId,
        mime: PHOENIX_DIAGRAM_MIME,
        title: result.title,
        data: result.diagram,
        executable: false,
      }}),
    },
    async execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0 || title.length > 140) invalid('El título requiere de 1 a 140 caracteres.')
      const diagram = admitPhoenixDiagram(args.diagram, title)
      const artifactId = 'phoenix-diagram:' + String(exec.callId)
      // Allow a final assistant response after the artifact event is projected.
      // concludeTurn here can leave a tool-only turn with no visible reply.
      return {
        artifactId, title, diagram: diagram as unknown as JsonValue,
        publication: 'artifact_emitted_not_client_render_verified',
      }
    },
    presentCall(args) { return {
      card: 'generic', title: 'Diagrama · ' + args.title,
      kind: 'read', rawInput: 'Publicación de diagrama nativo en el chat',
    } },
  })
}
