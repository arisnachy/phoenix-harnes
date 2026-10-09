import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Versioned, portable, data-only 3D scene: no scripts, URLs, or external resources. */
export const PHOENIX_SCENE3D_MIME = 'application/vnd.phoenix.scene3d+json'

type Primitive = 'box' | 'sphere' | 'cylinder' | 'cone'
interface SceneNode {
  readonly type: Primitive
  readonly name?: string
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly rotation?: readonly [number, number, number]
  readonly color: string
}
interface Scene {
  readonly version: 1
  readonly units: 'meters'
  readonly name: string
  readonly background: string
  readonly nodes: readonly SceneNode[]
}
const hex = /^#[0-9a-f]{6}$/iu
const validVector = (value: unknown, min: number, max: number): value is number[] =>
  Array.isArray(value) && value.length === 3 && value.every(
    entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= min && entry <= max,
  )
function normalizeScene(raw: unknown, fallbackName: string): Scene {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ToolArgsError(['La escena 3D debe contener nodes: una lista de objetos geométricos.'])
  }
  const data = raw as Record<string, unknown>
  if (!Array.isArray(data.nodes) || data.nodes.length === 0 || data.nodes.length > 150) {
    throw new ToolArgsError(['La escena 3D requiere entre 1 y 150 objetos.'])
  }
  const nodes = data.nodes.map((item: unknown, index: number): SceneNode => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: geometría inválida.`])
    }
    const node = item as Record<string, unknown>
    if (!['box', 'sphere', 'cylinder', 'cone'].includes(String(node.type))) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: usa box, sphere, cylinder o cone.`])
    }
    if (!validVector(node.position, -300, 300) || !validVector(node.size, 0.001, 300)
      || (node.rotation !== undefined && !validVector(node.rotation, -360, 360))
      || typeof node.color !== 'string' || !hex.test(node.color)) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: position/size/rotation o color inválidos.`])
    }
    return {
      type: node.type as Primitive,
      position: [node.position[0]!, node.position[1]!, node.position[2]!],
      size: [node.size[0]!, node.size[1]!, node.size[2]!],
      color: node.color,
      ...(typeof node.name === 'string' && node.name.length <= 100 ? { name: node.name } : {}),
      ...(node.rotation === undefined ? {} : { rotation: [node.rotation[0]!, node.rotation[1]!, node.rotation[2]!] }),
    }
  })
  return {
    version: 1,
    units: 'meters',
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.slice(0, 140) : fallbackName,
    background: typeof data.background === 'string' && hex.test(data.background) ? data.background : '#f7f2eb',
    nodes,
  }
}

/** An actual 3D *concept model* rather than a 2D image or a claimed CAD reconstruction. */
export function tropicalVillaScene(): Scene {
  const nodes: SceneNode[] = []
  const box = (name: string, position: [number,number,number], size: [number,number,number], color: string): void => {
    nodes.push({ type: 'box', name, position, size, color })
  }
  box('Acantilado / plataforma', [0,-0.85,0], [25,1.7,20], '#b6a393')
  box('Terraza de piscina', [0,0.15,4], [22,.35,11], '#ede2d3')
  box('Lámina de agua', [-2,0.36,5.7], [15,.08,7.2], '#43b5b6')
  box('Piscina borde infinito', [-2,0.15,9.35], [15,.5,.28], '#b8eee5')
  for (const x of [-6,0,6]) {
    box('Columna', [x,2.2,-2.5], [.45,4.2,.45], '#c8b9a3')
    box('Columna superior', [x,6.6,-2.5], [.42,3.8,.42], '#c8b9a3')
  }
  box('Planta baja acristalada', [1.7,2.1,-4.5], [17,4.0,8], '#b4d3cb')
  box('Voladizo horizontal', [1.4,4.35,-4.4], [20,.65,10], '#e8d8c6')
  box('Volumen acristalado planta superior', [2.1,6.8,-4.7], [15,4.1,7.6], '#a7c6bf')
  box('Cubierta flotante orgánica (aproximada)', [1.4,9.2,-4.8], [20,.75,10.2], '#efdfce')
  box('Jardín de cubierta', [1.5,9.62,-4.8], [16,.28,7.8], '#527c51')
  for (const x of [-7,-4,-1,2,5,8]) {
    box('Celosía vertical', [x,6.7,-.55], [.18,3.5,.22], '#986a47')
    box('Montante cristal', [x,2.15,-.42], [.12,3.5,.14], '#4f554c')
  }
  for (const x of [-7,-4,8]) {
    nodes.push({ type: 'cylinder', name:'Tronco de palma',position:[x,2.5,6],size:[.28,5,.28],color:'#896542' })
    nodes.push({ type: 'sphere', name:'Copa tropical',position:[x,5.6,6],size:[3,1.2,3],color:'#3e865b' })
  }
  for (const x of [-7,0,6]) {
    box('Tumbona', [x,.6,1.2], [1.25,.28,2.15], '#f6ebdc')
  }
  return { version: 1, units: 'meters', name: 'Villa tropical · modelo 3D conceptual', background:'#f9f3eb', nodes }
}

/** Model-facing 3D creation; geometry remains portable to other Phoenix applications. */
export function createPhoenix3DTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_3d',
    description: 'Create a REAL INTERACTIVE THREE-DIMENSIONAL SCENE and show it inside Phoenix chat. For requests such as modelo 3D, casa 3D, diseño 3D, rotar, orbit, zoom, manipulable, modelo para una app, use THIS tool, not image_generation or phoenix_visualize. Output is 3D geometry (not PNG): the user can drag to rotate, use the wheel or +/- to zoom, reset the camera, and download a portable versioned JSON model reusable in Phoenix apps. For a quick fictional tropical villa concept use demo:true and no scene (local zero-model-cost geometry). For original designs provide scene:{nodes:[{type:"box"|"sphere"|"cylinder"|"cone",name?,position:[x,y,z],size:[x,y,z],rotation?:[degreesX,degreesY,degreesZ],color:"#rrggbb"}],name?,background?}. Coordinates and sizes are meters; y is vertical. Approximate reference photos as clearly labeled 3D concepts: do NOT claim exact photo-to-CAD reconstruction, survey measurements, accurate GLB or photorealistic rendering. Up to 150 nodes. No external scripts, URLs, image substitution or fake interactive buttons. A self-contained scene finishes the requested presentation; continueAfterDisplay only for additional explicitly requested work.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human-readable title of the real 3D model.' },
      demo: { type: 'boolean', description: 'True generates a complete tropical villa concept scene in 3D without another model call.' },
      scene: { type: 'object', additionalProperties: true,
        description: 'Serializable geometric scene. Required unless demo:true. nodes array with box/sphere/cylinder/cone, metric position/size and hex color.' },
      continueAfterDisplay: { type: 'boolean',
        description: 'False by default: presentation finishes turn, interactive controls are local. True only if further separate work is requested.' },
    },
    output: {
      schema: { type:'object', additionalProperties:false, properties: {
        artifactId:{type:'string',required:true},title:{type:'string',required:true},scene:{type:'json',required:true},
      } },
      render: (_args, result) => [{ type:'text', text:`Modelo 3D interactivo listo: ${result.title}. Arrastra para girarlo y usa la rueda para acercarlo.` }],
      presentationMeta: (_args, result) => ({ artifact: {
        id: result.artifactId, mime:PHOENIX_SCENE3D_MIME, title:result.title,
        data: result.scene, executable:false,
      } }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0 || title.length > 140) throw new ToolArgsError(['Se requiere un título de 1 a 140 caracteres.'])
      const scene = args.demo === true && args.scene === undefined
        ? tropicalVillaScene() : normalizeScene(args.scene, title)
      if (args.continueAfterDisplay !== true) exec.concludeTurn()
      return Promise.resolve({ artifactId:`phoenix-3d:${String(exec.callId)}`, title, scene: scene as unknown as JsonValue })
    },
    presentCall(args) {
      return { card: 'generic', title: `3D · ${args.title}`, kind:'read', rawInput:'Geometría 3D interactiva en Phoenix' }
    },
  })
}
