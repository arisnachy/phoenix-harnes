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
  'for normal forms, dashboards and web UI use phoenix_canvas or UI tools. Never add 3D to ordinary apps merely because it looks impressive. '+
  'For architecture/product/room/vehicle apps, propose or create a 3D viewer when interaction conveys spatial value. '+
  'Use scene material presets, camera and environment. GLB/glTF import and export controls exist in the 3D viewer; '+
  'GLB is real geometry with core PBR metadata, but do not promise photo-to-CAD or photorealistic PBR from the lightweight preview. '+
  'Confirm quality through working artifact and real model, avoid repeated rendering or review loops.'
