/** Cross-category 3D intent and fidelity gates. No model can self-certify visual quality. */
export type Scene3DDomain = 'character' | 'vehicle' | 'architecture' | 'environment' | 'robot' | 'object'
export type Scene3DLevel = 'preview' | 'studio' | 'fidelity'

export interface Scene3DQualityNode {
  readonly type: string
  readonly name?: string
  readonly objectId?: string
  readonly vertices?: readonly number[]
}
export interface Scene3DQualityScene {
  readonly nodes: readonly Scene3DQualityNode[]
  readonly animations?: readonly { readonly tracks: readonly unknown[] }[]
  readonly environment?: string
}
export interface Scene3DQualityResult {
  readonly domain: Scene3DDomain
  readonly requestedLevel: Scene3DLevel
  readonly deliveredLevel: 'preview'
  readonly structuralChecksPassed: boolean
  readonly blockers: readonly string[]
  readonly warnings: readonly string[]
}

const normalize = (text: string): string =>
  text.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()

/** Categorize models for specialized Blender/asset workflows, independently of language accents. */
export function classifyScene3DDomain(prompt: string): Scene3DDomain {
  const text = normalize(prompt)
  if (/\b(?:robot(?:s)?|androide(?:s)?|mecha|humanoid robot|droid)\b/u.test(text)) return 'robot'
  if (/\b(?:avatar|personaj\w*|character|anime|humano|humana|rostro|persona|v(?:-)?tuber|criatura|animal\w*|pelicano|caballo|delfin)\b/u.test(text)) return 'character'
  if (/\b(?:vehicul\w*|automovil|auto(?:s)?|coche|carro|biciclet\w*|moto(?:s)?|avion|barco|drone|dron)\b/u.test(text)) return 'vehicle'
  if (/\b(?:casa|vivienda|edificio|arquitect\w*|apartamento|hospital|consultorio|habitacion|interior|fachada|plano|floorplan)\b/u.test(text)) return 'architecture'
  if (/\b(?:parque|paisaje|jardin|bosque|ciudad|escena|ambiente|mundo|environment|landscape|terrain)\b/u.test(text)) return 'environment'
  return 'object'
}

/** Detect explicit studio/fidelity intent; never silently treat a high-quality request as preview. */
export function requestedScene3DLevel(prompt: string): Scene3DLevel {
  const text = normalize(prompt)
  if (/\b(?:exactitud|exacto|exacta|identic\w*|fidelidad|fidelity|precis\w*|1\s*:\s*1|medidas exactas|reconstruccion)\b/u.test(text)) return 'fidelity'
  if (/\b(?:profesional|alta calidad|high quality|fotorreal\w*|hiperreal\w*|realista|studio|blender|rigging|riggeado|esculp\w*|animacion profesional|production ready)\b/u.test(text)) return 'studio'
  return 'preview'
}

/**
 * Native preview validation; high-quality and exact fidelity need independent
 * Blender, references and visual QA, not a pass obtained from polygon counts.
 */
export function auditScene3DQuality(
  scene: Scene3DQualityScene, prompt: string, requiredObjects: readonly string[] = [],
  level: Scene3DLevel = requestedScene3DLevel(prompt),
): Scene3DQualityResult {
  const domain = classifyScene3DDomain(prompt)
  const blockers: string[] = []
  const warnings: string[] = []
  if (scene.nodes.length === 0) blockers.push('La escena está vacía.')
  const present = new Set(scene.nodes.map(node => node.objectId).filter(Boolean))
  const missing = requiredObjects.filter(id => !present.has(id))
  if (missing.length > 0) blockers.push(`Faltan objetos solicitados: ${missing.join(', ')}.`)
  const meshes = scene.nodes.filter(node => node.type === 'mesh')
  const triangleValues = meshes.reduce((total, node) => total + (node.vertices?.length ?? 0), 0)
  if (scene.nodes.length === 1 && scene.nodes[0]?.type === 'box'
    && domain !== 'object') blockers.push('Una caja no representa un sujeto 3D complejo.')
  if ((domain === 'character' || domain === 'robot') && triangleValues === 0) {
    warnings.push('Sin malla orgánica o mecánica detallada; el resultado no acredita calidad de personaje.')
  }
  if (domain === 'vehicle' && !scene.nodes.some(node => node.type === 'torus' || node.type === 'mesh')) {
    warnings.push('Sin piezas curvas o mallas detalladas para vehículos.')
  }
  if (!scene.environment) warnings.push('No se especificó iluminación/entorno.')
  if (level !== 'preview') {
    blockers.push(level === 'studio'
      ? 'Un preview nativo no certifica calidad Studio: requiere generación y revisión real en Blender.'
      : 'La reconstrucción exacta requiere geometría fuente, planos/medidas y verificación de tolerancias.')
  }
  return { domain, requestedLevel: level, deliveredLevel: 'preview',
    structuralChecksPassed: blockers.length === 0 && warnings.length === 0, blockers, warnings }
}
