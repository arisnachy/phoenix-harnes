import { defineTool, ToolArgsError, type JsonValue, type ToolDefinition } from '@phoenix-ai/dsh-tools'
import { pelicanScene } from './scene3d-pelican.ts'
import { auditScene3DQuality, requestedScene3DLevel, type Scene3DLevel } from './scene3d-quality.ts'

/** Versioned, portable, data-only 3D scene: no scripts, URLs, or external resources. */
export const PHOENIX_SCENE3D_MIME = 'application/vnd.phoenix.scene3d+json'

type Primitive = 'box' | 'sphere' | 'cylinder' | 'cone' | 'mesh' | 'torus'
interface SceneNode {
  readonly type: Primitive
  readonly name?: string
  readonly objectId?: string
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly rotation?: readonly [number, number, number]
  readonly color: string
  readonly vertices?: readonly number[]
  readonly material?: {
    readonly preset?: string
    readonly baseColor?: string
    readonly emissive?: string
    readonly metallic?: number
    readonly roughness?: number
    readonly opacity?: number
    readonly transmission?: number
    readonly clearcoat?: number
  }
}
interface AnimationTrack {
  readonly node: string
  readonly property: 'position' | 'rotation' | 'size'
  readonly keys: readonly { readonly time: number; readonly value: readonly [number, number, number] }[]
}
interface SceneAnimation {
  readonly name: string
  readonly duration: number
  readonly loop: boolean
  readonly tracks: readonly AnimationTrack[]
}
export interface Scene {
  readonly version: 1
  readonly units: 'meters'
  readonly name: string
  readonly background: string
  readonly nodes: readonly SceneNode[]
  readonly animations?: readonly SceneAnimation[]
  readonly environment?: 'studio' | 'sunset' | 'daylight'
  readonly camera?: 'perspective' | 'isometric' | 'front' | 'top'
}
const hex = /^#[0-9a-f]{6}$/iu
const validVector = (value: unknown, min: number, max: number): value is number[] =>
  Array.isArray(value) && value.length === 3 && value.every(
    entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= min && entry <= max,
  )
function normalizeAnimations(raw: unknown, nodes: readonly SceneNode[]): SceneAnimation[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) {
    throw new ToolArgsError(['La escena admite entre 1 y 8 animaciones.'])
  }
  const names = nodes.map(node => node.name)
  const clips: SceneAnimation[] = []
  let totalKeys = 0
  for (const [index, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ToolArgsError(['Animación inválida.'])
    }
    const clip = item as Record<string, unknown>
    const duration = clip.duration
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 120
      || !Array.isArray(clip.tracks) || clip.tracks.length < 1 || clip.tracks.length > 64) {
      throw new ToolArgsError([`Animación ${index + 1}: duración o pistas inválidas.`])
    }
    const tracks: AnimationTrack[] = []
    for (const itemTrack of clip.tracks) {
      if (typeof itemTrack !== 'object' || itemTrack === null || Array.isArray(itemTrack)) {
        throw new ToolArgsError(['Pista 3D inválida.'])
      }
      const track = itemTrack as Record<string, unknown>
      const node = track.node
      const property = track.property
      if (typeof node !== 'string' || names.filter(name => name === node).length !== 1
        || !['position','rotation','size'].includes(String(property))
        || !Array.isArray(track.keys) || track.keys.length < 2 || track.keys.length > 32) {
        throw new ToolArgsError(['La pista requiere un nodo con nombre único y entre 2 y 32 claves.'])
      }
      let previousTime = -1
      const keys: Array<{time:number;value:[number,number,number]}> = []
      for (const rawKey of track.keys) {
        if (typeof rawKey !== 'object' || rawKey === null || Array.isArray(rawKey)) {
          throw new ToolArgsError(['Fotograma clave 3D inválido.'])
        }
        const key = rawKey as Record<string, unknown>
        const time = key.time
        const min = property === 'size' ? 0.001 : property === 'rotation' ? -360 : -300
        const max = property === 'rotation' ? 360 : 300
        if (typeof time !== 'number' || !Number.isFinite(time) || time < 0
          || time > duration || time <= previousTime || !validVector(key.value, min, max)) {
          throw new ToolArgsError(['Tiempos o valores de fotogramas 3D inválidos.'])
        }
        previousTime = time
        keys.push({ time, value: [key.value[0]!, key.value[1]!, key.value[2]!] })
      }
      totalKeys += keys.length
      if (totalKeys > 3000) throw new ToolArgsError(['Máximo 3000 fotogramas clave por escena.'])
      tracks.push({ node, property: property as AnimationTrack['property'], keys })
    }
    clips.push({ name: typeof clip.name === 'string' && clip.name.trim() !== ''
      ? clip.name.slice(0,80) : `Animación ${index + 1}`,
      duration, loop: clip.loop !== false, tracks })
  }
  return clips
}
function normalizeScene(raw: unknown, fallbackName: string): Scene {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ToolArgsError(['La escena 3D debe contener nodes: una lista de objetos geométricos.'])
  }
  const data = raw as Record<string, unknown>
  if (!Array.isArray(data.nodes) || data.nodes.length === 0 || data.nodes.length > 150) {
    throw new ToolArgsError(['La escena 3D requiere entre 1 y 150 objetos.'])
  }
  let meshValues = 0
  const nodes = data.nodes.map((item: unknown, index: number): SceneNode => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: geometría inválida.`])
    }
    const node = item as Record<string, unknown>
    if (!['box', 'sphere', 'cylinder', 'cone', 'mesh', 'torus'].includes(String(node.type))) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: usa box, sphere, cylinder, cone, mesh o torus.`])
    }
    if (!validVector(node.position, -300, 300) || !validVector(node.size, 0.001, 300)
      || (node.rotation !== undefined && !validVector(node.rotation, -360, 360))
      || typeof node.color !== 'string' || !hex.test(node.color)) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: position/size/rotation o color inválidos.`])
    }
    if (node.type === 'mesh') {
      const vertices = node.vertices
      if (!Array.isArray(vertices) || vertices.length < 9 || vertices.length % 9 !== 0
        || vertices.length > 180_000 || !vertices.every(value =>
          typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000)) {
        throw new ToolArgsError([`Objeto 3D ${index + 1}: mesh requiere triángulos xyz finitos.`])
      }
      meshValues += vertices.length
      if (meshValues > 180_000) throw new ToolArgsError(['La escena supera 60 000 vértices.'])
      let hasArea = false
      for (let i = 0; i < vertices.length; i += 9) {
        const ax = vertices[i + 3]! - vertices[i]!, ay = vertices[i + 4]! - vertices[i + 1]!
        const az = vertices[i + 5]! - vertices[i + 2]!
        const bx = vertices[i + 6]! - vertices[i]!, by = vertices[i + 7]! - vertices[i + 1]!
        const bz = vertices[i + 8]! - vertices[i + 2]!
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
        if (cx * cx + cy * cy + cz * cz > 1e-16) { hasArea = true; break }
      }
      if (!hasArea) throw new ToolArgsError([`Objeto 3D ${index + 1}: malla sin superficie visible.`])
    } else if (node.vertices !== undefined) {
      throw new ToolArgsError([`Objeto 3D ${index + 1}: vertices solo se admite para mesh.`])
    }
    const inputMaterial = node.material
    let material:SceneNode['material']
    if (inputMaterial !== undefined) {
      if (typeof inputMaterial !== 'object' || inputMaterial === null || Array.isArray(inputMaterial)) {
        throw new ToolArgsError([`Objeto 3D ${index + 1}: material inválido.`])
      }
      const value=inputMaterial as Record<string,unknown>
      const props=['metallic','roughness','opacity','transmission','clearcoat'] as const
      if (props.some(key=>value[key]!==undefined&&
        (typeof value[key]!=='number'||!Number.isFinite(value[key])||(value[key] as number)<0||(value[key] as number)>1))
        ||['baseColor','emissive'].some(key=>value[key]!==undefined&&
          (typeof value[key]!=='string'||!hex.test(value[key] as string)))) {
        throw new ToolArgsError([`Objeto 3D ${index + 1}: parámetros PBR inválidos.`])
      }
      material={
        ...(typeof value.preset==='string'?{preset:value.preset.slice(0,40)}:{}),
        ...(typeof value.baseColor==='string'?{baseColor:value.baseColor}:{}),
        ...(typeof value.emissive==='string'?{emissive:value.emissive}:{}),
        ...Object.fromEntries(props.filter(key=>typeof value[key]==='number').map(key=>[key,value[key]])),
      }
    }
    return {
      type: node.type as Primitive,
      position: [node.position[0]!, node.position[1]!, node.position[2]!],
      size: [node.size[0]!, node.size[1]!, node.size[2]!],
      color: node.color,
      ...(node.type === 'mesh' ? { vertices: node.vertices as number[] } : {}),
      ...(material===undefined?{}:{material}),
      ...(typeof node.name === 'string' && node.name.length <= 100 ? { name: node.name } : {}),
      ...(typeof node.objectId === 'string' && /^[a-z0-9_-]{1,64}$/iu.test(node.objectId) ? { objectId:node.objectId } : {}),
      ...(node.rotation === undefined ? {} : { rotation: [node.rotation[0]!, node.rotation[1]!, node.rotation[2]!] }),
    }
  })
  return {
    version: 1,
    units: 'meters',
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name.slice(0, 140) : fallbackName,
    background: typeof data.background === 'string' && hex.test(data.background) ? data.background : '#f7f2eb',
    nodes,
    ...(data.animations === undefined ? {} : { animations:normalizeAnimations(data.animations,nodes)! }),
    ...(data.environment==='studio'||data.environment==='sunset'||data.environment==='daylight'?{environment:data.environment}:{}),
    ...(data.camera==='perspective'||data.camera==='isometric'||data.camera==='front'||data.camera==='top'?{camera:data.camera}:{}),
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

/** Detailed triangular meshes can represent an organic object in a single node. */
function detailedMesh(scene: Scene): boolean {
  return scene.nodes.some(node => node.type === 'mesh' && (node.vertices?.length ?? 0) >= 900)
}
function requestedPelican(text: string): boolean {
  return /pel[ií]can(?:o|a|os|as)?/iu.test(text)
}
function recognizablePelican(scene: Scene): boolean {
  if (detailedMesh(scene)) return true
  const names = scene.nodes.map(node => node.name?.toLowerCase() ?? '').join(' ')
  return scene.nodes.length >= 10 && /pico|beak/iu.test(names)
    && /bolsa|pouch|gular/iu.test(names) && /ala|wing/iu.test(names)
    && /cabeza|head/iu.test(names)
}
function trivialOrganicScene(scene: Scene): boolean {
  return !detailedMesh(scene) && (scene.nodes.length < 6 || scene.nodes.every(node => node.type === 'box'))
}

/** Model-facing 3D creation; geometry remains portable to other Phoenix applications. */
export function createPhoenix3DTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_3d',
    description: 'Create a REAL INTERACTIVE THREE-DIMENSIONAL SCENE and show it inside Phoenix chat. For requests such as modelo 3D, casa 3D, diseño 3D, rotar, orbit, zoom, manipulable, modelo para una app, use THIS tool, not image_generation or phoenix_visualize. Output is 3D geometry (not PNG): the user can drag to rotate, use the wheel or +/- to zoom, reset the camera, and download a portable versioned JSON model reusable in Phoenix apps. For a quick fictional tropical villa concept use demo:true and no scene. For studio-level, professional sculpting, rigging, reference reconstruction or photographic fidelity, do NOT pretend this preview tool can do that. Prefer the official opt-in Blender Lab MCP tools (mcp__blender__*) when actually connected, or the offline Blender pipeline scripts/phoenix-3d-studio.py with detailed mesh source. User must provide real assets/references to reproduce an exact source; never invent exactness. For complex scenes NEVER use a single-subject preset: provide scene with multiple semantic objects, their objectId per node, and requiredObjects listing every required subject and environmental prop. Use torus for bicycle wheels, pipes, rings and circular architecture; use mesh for unconstrained complex geometry. Optional scene.animations:[{name,duration,loop,tracks:[{node:uniqueNodeName,property:position|rotation|size,keys:[{time,value:[x,y,z]},...]}]}] creates real keyframe motion. For compound scenes, include environment objects and name individual moving parts uniquely. Use the pelican demonstration preset ONLY for a pelican without any companions. Never replace composed scenes with a preset. For other animals create a detailed triangular mesh or several recognizable named anatomical parts. For original designs provide scene:{environment:"sunset"|"studio"|"daylight",camera:"isometric"|"front"|"top"|"perspective",nodes:[{type:"box"|"sphere"|"cylinder"|"cone"|"mesh"|"torus",name?,objectId?,position:[x,y,z],size:[x,y,z],vertices?:[x0,y0,z0,x1,y1,z1,x2,y2,z2,...],rotation?:[degreesX,degreesY,degreesZ],color:"#rrggbb",material?:{preset?:"glass"|"wood"|"concrete"|"metal"|"water"|"foliage",baseColor?:"#rrggbb",metallic?:number,roughness?:number,opacity?:number,transmission?:number,clearcoat?:number,emissive?:"#rrggbb"}}],name?,background?}. Coordinates and sizes are meters; y is vertical. Approximate reference photos as clearly labeled 3D concepts: do NOT claim exact photo-to-CAD reconstruction, survey measurements, exact photorealistic reconstruction; the viewer provides GLB/glTF import-export with glTF PBR material parameters and editable geometry, not CAD/BIM. Up to 150 nodes and 60,000 mesh vertices total. Do not replace any multi-object scene with a preset. Validate position, surroundings, relationships and essential objects. No external scripts, URLs, image substitution or fake interactive buttons. A self-contained scene finishes the requested presentation; continueAfterDisplay only for additional explicitly requested work.',
    parameters: {
      title: { type: 'string', required: true, description: 'Human-readable title of the real 3D model.' },
      demo: { type: 'boolean', description: 'True generates a complete tropical villa concept scene in 3D without another model call.' },
      preset: { type: 'string', description: 'Legacy single-subject demonstration: pelican. Do NOT use when scene includes secondary objects.' },
      qualityMode: { type: 'string', enum: ['preview','studio','fidelity'], description: 'Native tool implements preview only; studio/fidelity require a separate Blender and reference verification workflow.' },
      requiredObjects: { type: 'array', items: {type:'string'}, description: 'Optional list of objectId identifiers, each of which MUST appear in at least one node; use to guard main subject plus context props.' },
      subject: { type: 'string', description: 'Subject requested by the user, for geometric fidelity checks.' },
      scene: { type: 'object', additionalProperties: true,
        description: 'Serializable scene. Required unless demo:true or preset:pelican. Nodes support box/sphere/cylinder/cone/torus/mesh, metric position/size and hex color; mesh vertices are xyz triangle triples.' },
      continueAfterDisplay: { type: 'boolean',
        description: 'False by default: presentation finishes turn, interactive controls are local. True only if further separate work is requested.' },
    },
    output: {
      schema: { type:'object', additionalProperties:false, properties: {
        artifactId:{type:'string',required:true},title:{type:'string',required:true},scene:{type:'json',required:true},
        qualityReport:{type:'json',required:true},
      } },
      render: (_args, result) => [{ type:'text', text:`Previsualización 3D interactiva: ${result.title}. No se ha certificado calidad de producción ni exactitud de referencia. Arrastra para girar o ampliar.` }],
      presentationMeta: (_args, result) => ({ artifact: {
        id: result.artifactId, mime:PHOENIX_SCENE3D_MIME, title:result.title,
        data: result.scene, executable:false,
      } }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0 || title.length > 140) throw new ToolArgsError(['Se requiere un título de 1 a 140 caracteres.'])
      const qualityLevel: Scene3DLevel = args.qualityMode ?? requestedScene3DLevel(
        title + ' ' + (typeof args.subject === 'string' ? args.subject : ''))
      if (qualityLevel !== 'preview') {
        throw new ToolArgsError([qualityLevel === 'studio'
          ? 'Calidad Studio requiere la ruta real de Blender Lab MCP o el renderizador offline de Blender; phoenix_3d solo hace previsualizaciones.'
          : 'Fidelidad exacta requiere referencias geométricas/planos/medidas y validación de tolerancias; phoenix_3d no puede certificarla.'])
      }
      const pelican = args.preset === 'pelican'
        || requestedPelican(title + ' ' + (typeof args.subject === 'string' ? args.subject : ''))
      const supplied = args.scene === undefined ? undefined : normalizeScene(args.scene, title)
      // A standalone bird may use the demo; a compound request must retain its other objects.
      const isolatedPelican = /^(?:un\s+|una\s+|modelo\s+(?:de\s+)?|crea\s+(?:un\s+)?)?pel[ií]can(?:o|a)?(?:\s+(?:en\s+)?(?:3d|tridimensional|giratorio))?$/iu.test(title)
      const alone = isolatedPelican && (!Array.isArray(args.requiredObjects) || args.requiredObjects.length <= 1)
      const scene = (alone && args.preset === 'pelican' && supplied === undefined)
        || (pelican && alone && (supplied === undefined || (supplied.nodes.length === 1 && !recognizablePelican(supplied))))
        ? pelicanScene()
        : args.demo === true && supplied === undefined
          ? tropicalVillaScene() : supplied ?? normalizeScene(undefined, title)
      if (pelican && !alone && (scene.nodes.length < 2 || scene.nodes.every(node => node.type === 'box'))) {
        throw new ToolArgsError(['Escena compuesta insuficiente: incluye el pelícano, sus acompañantes y el entorno solicitados.'])
      }
      const required = args.requiredObjects
      if (required !== undefined) {
        if (!Array.isArray(required) || required.length < 1 || required.length > 12
          || !required.every(id => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/iu.test(id))) {
          throw new ToolArgsError(['requiredObjects debe contener identificadores de objetos válidos.'])
        }
        const present = new Set(scene.nodes.map(node => node.objectId).filter(Boolean))
        const missing = required.filter(id => !present.has(id))
        if (missing.length > 0) throw new ToolArgsError([`Faltan objetos esenciales de la escena: ${missing.join(', ')}.`])
      }
      const subject = title + ' ' + (typeof args.subject === 'string' ? args.subject : '')
      const organic = /\b(?:animal|bird|ave|p[aá]jaro|organico|orgánico|elefante|gato|perro|rostro|human(?:o|a)?|dog|cat|horse|dinosaurio|tortuga|delf[ií]n)\b/iu.test(subject)
      if (!pelican && organic && trivialOrganicScene(scene)) {
        throw new ToolArgsError(['Modelo orgánico insuficiente: usa una malla o varias partes anatómicas, nunca solo una caja.'])
      }
      const qualityReport = auditScene3DQuality(scene, subject,
        Array.isArray(required) ? required : [], qualityLevel)
      if (args.continueAfterDisplay !== true) exec.concludeTurn()
      return Promise.resolve({ artifactId:`phoenix-3d:${String(exec.callId)}`, title,
        scene: scene as unknown as JsonValue, qualityReport: qualityReport as unknown as JsonValue })
    },
    presentCall(args) {
      return { card: 'generic', title: `3D · ${args.title}`, kind:'read', rawInput:'Geometría 3D interactiva en Phoenix' }
    },
  })
}
