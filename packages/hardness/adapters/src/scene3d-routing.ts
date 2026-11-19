import { requestedScene3DLevel } from './scene3d-quality.ts'

/** Select an actual production pipeline; the native viewer is not a sculpting engine.
 * @param request - User's full 3D request.
 * @returns Native interactive preview or a specialized Blender/reference workflow.
 */
export function choosePhoenix3DPipeline(request: string):
  'preview' | 'blender-studio' | 'reference-reconstruction' {
  const level = requestedScene3DLevel(request)
  return level === 'fidelity' ? 'reference-reconstruction'
    : level === 'studio' ? 'blender-studio' : 'preview'
}

/** Deterministic media choice for Phoenix apps: 3D only adds value for spatial interaction. */
export type DesignMedium='scene3d'|'image'|'chart'|'app'|'undetermined'
/** Classify the requested artifact medium using explicit spatial and UI intent.
 * @param request - User's requested design or application.
 * @returns The supported artifact medium, or undetermined when unclear.
 */
export function choosePhoenixDesignMedium(request:string):DesignMedium{
  const text=request.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
  const spatial=/\b(?:3d|tridimensional|orbitar?|rotar|girarl[oa]?|girable|recorrid[oa]|model[oa]|malla|gltf|glb|blender|cad|mesh|arquitectura|interior|habitacion|muebl\w*|volumen|planta|maqueta|showroom|configurador)\b/u.test(text)
  const interactive=/\b(?:interactiv\w*|manipul\w*|rotar|girar|orbitar|zoom|explorar|recorrido|configurador|viewer|glb|gltf|importar|exportar|modelo\s+3d)\b/u.test(text)
  const app=/\b(?:app|aplicacion|videojuego|juego|sitio|web|catalogo|tienda|producto|escaparate|simulador|editor)\b/u.test(text)
  const appSpatial=/\b(?:showroom|configurador|recorrido|inmueble|arquitectura|muebl\w*|pieza|vehiculo|avatar|escena|motor|habitacion|producto\s+3d|modelo\s+3d)\b/u.test(text)
  const staticImage=/\b(?:png|jpg|jpeg|fotograf\w*|foto|poster|flyer|banner|portada|imagen|render|ilustracion)\b/u.test(text)
  const data=/\b(?:grafic\w*|grafica|dashboard|analitic\w*|estadistic\w*|diagrama\s+de\s+barras|velas|pie\s+chart)\b/u.test(text)
  const ui=/\b(?:formulario|login|tabla|panel\s+de\s+control|botones|pagina\s+web|pagina\s+de\s+inicio)\b/u.test(text)
  // A negated 3D mention is a rejection, never positive spatial intent.
  // Medical atlas/still-image requests must not turn into primitive anatomical meshes.
  const clinical = /\b(?:anatom\w*|medic\w*|clinic\w*|pleur\w*|neumotorax|pneumothorax|pulmon\w*|pulmonary|thorax|torax|cavidad\s+toracica|bronqu\w*|corazon|cardiac\w*|arteri\w*|venas|venos\w*|inervac\w*|irrigac\w*|organos|higado|rinon|cerebro|nervi\w*)\b/u.test(text)
  const reject3D = /\b(?:no|sin|evitar|evita|en\s+vez\s+de|en\s+lugar\s+de)\s+(?:(?:un|el|la|modelo|render|escena|visualizacion)\s+){0,3}(?:3d|tridimensional)\b/u.test(text)
  const positive3D = /\b(?:3d|tridimensional|glb|gltf)\b/u.test(text) && !reject3D
  const medicalStill = staticImage || /\b(?:lamina|atlas|hiperrealista|hiperrealismo)\b/u.test(text)
  if (clinical && (reject3D || (medicalStill && !positive3D))) return 'image'
  // The explicit data/UI intent wins over incidental "3D" unless a spatial model is requested.
  if(data&&!interactive)return 'chart'
  if(staticImage&&!interactive&&!(app&&appSpatial))return 'image'
  if(spatial&&(interactive||(app&&appSpatial)))return 'scene3d'
  if(app&&appSpatial&&/\b(?:disen\w*|crea\w*|muestr\w*|constru\w*)\b/u.test(text))return 'scene3d'
  if(ui||app)return 'app'
  if(spatial&&/\b(?:3d|tridimensional|gltf|glb)\b/u.test(text))return 'scene3d'
  return 'undetermined'
}
/** Instructions preventing accidental 3D renders for non-spatial tasks. */
export const PHOENIX_3D_ROUTING_PROTOCOL =
  'Phoenix design routing: select the artifact medium based on user intent and spatial value, not visual fashion. '+
  'Use phoenix_3d when a request needs orbit/zoom/rotation, spatial volume, a walkable/showroom/product configurator, '+
  'reusable 3D assets in an application, or explicit .gltf/.glb; use native portable scene geometry, not image_generation. '+
  'For a still photograph, poster, concept render or moodboard use image generation; for graphs use phoenix_visualize; '+
  'For medical anatomy, HealthIA, pleural air and pathology atlas requests, prefer the true image_generation raster backend: 2D hyperrealistic stills with accurate anatomy, relative scale, arteries, veins, innervation and evidenced findings. Never interpret "no 3D" as a request for phoenix_3d. Keep patient-specific findings bounded to reviewed sources, not invented geometry. Use interactive phoenix_3d for clinical anatomy only when the user explicitly requests a manipulable spatial model. '+
  'for normal forms, dashboards and web UI use phoenix_canvas or UI tools. Never add 3D to ordinary apps merely because it looks impressive. '+
  'For architecture/product/room/vehicle apps, propose or create a 3D viewer when interaction conveys spatial value. '+
  'For original, named or recognizable human/cartoon characters, use a real Studio character asset/mesh and rig; a 24-primitive assembly is only a low-poly draft. '+
  'Do not present a face with detached eyes, moustache or nose as a finished character; use character geometry checks and actual Studio authoring tools if available. '+
  'Only choose the native primitive path if the user explicitly requests a low-poly prototype/blockout. '+
  'For organic 3D use triangular mesh geometry or identifiable anatomical parts, not a single cube. '+
  'For every imagined 3D subject, no matter the category, decompose the prompt into all essential objects, parts, materials and relationships. '+
  'Use compositionContract to require named objectIds, minimum parts, actual mesh faces, animation and spatial relations. '+
  'Validate those relations before presenting a scene; do not call an assembled preview professional or exact. '+
  'For complex scenes never substitute a single-subject preset: build every subject and companion object. '+
  'Set objectId on each node and requiredObjects on the tool call so missing items are rejected. '+
  'Use torus for wheels and rings, mesh for organic forms, and keyframe animations for named parts. '+
  'Use phoenix_3d preset:pelican only for an isolated bird without any companion object. '+
  'Use scene material presets, camera and environment. GLB/glTF import and export controls exist in the 3D viewer; '+
  'STUDIO 3D PUBLISHING: when a high-quality/professional/animated/fidelity 3D model is requested, the model MUST first create a genuine detailed GLB inside its workspace using available coding tools or Blender. Then call phoenix_studio3d with model_path to run the trusted Blender Cycles pipeline and publish the verified Blender project, GLB, raster render and optional MP4 in chat. Native phoenix_3d is for rough blockouts ONLY. Do not submit invented paths or lower quality silently. If Blender is absent, clearly report missing PHOENIX_BLENDER_PATH or installation; never claim production output. '+
  'For studio-grade animated characters, robots, vehicles and architecture, load blender-studio skill when listed and route to official Blender Lab MCP tools when connected. '+
  'Blender Lab is a curated user-activated connector in Phoenix Settings; missing tools in this turn do NOT prove that Blender is not installed. '+
  'Inspect MCP server blender status, exported tool names, local Blender executable and uvx before giving a specific missing-dependency diagnosis. '+
  'An available Blender CLI can execute the offline studio pipeline without MCP; never replace a requested professional mesh with a low-poly blockout without permission. '+
  'Use Blender for real mesh sculpting/retopology/rigging, Cycles lighting and output validation; do not say those operations happened without tool evidence. '+
  'For portable scene assets, the offline Blender CLI pipeline scripts/phoenix-3d-studio.py can produce .blend, .glb and render.png on a Blender-equipped host. '+
  'For exact reconstruction require reference geometry/plans/measurements and measurable tolerances: one 2D image is insufficient. '+
  'If neither Blender nor the asset pipeline is available, explicitly describe native 3D as a preview, never claim professional accuracy. '+
  'GLB is real geometry with core PBR metadata, but do not promise photo-to-CAD or photorealistic PBR from the lightweight preview. '+
  'Confirm quality through working artifact and real model, avoid repeated rendering or review loops.'
