/** Prevent disconnected primitive assemblies from being accepted as finished characters.
 * All checks are conservative structural heuristics; visual similarity still requires review.
 */
export interface CharacterSceneNode {
  readonly type: string
  readonly name?: string
  readonly objectId?: string
  readonly position: readonly [number, number, number]
  readonly size: readonly [number, number, number]
  readonly vertices?: readonly number[]
}
export interface CharacterScene {
  readonly nodes: readonly CharacterSceneNode[]
}
export interface CharacterGeometryAudit {
  readonly isCharacter: boolean
  readonly isExplicitDraft: boolean
  readonly meshTriangles: number
  readonly errors: readonly string[]
}

const normalize = (value: string): string =>
  value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase()

/** Detect an explicitly requested rough prototype, not an accidental low-quality outcome.
 * @param prompt - Original subject and title.
 * @returns Whether low-poly blocking / early concept geometry was explicitly requested.
 */
export function explicitlyLowPoly3D(prompt: string): boolean {
  return /\b(?:low[ -]?poly|boceto|blockout|bloqueo|prototipo|maqueta|preview|previsualizacion|primitiv[ao]s?)\b/u
    .test(normalize(prompt))
}

/** Detect original, cartoon and recognizable humanoid character work without hard-coding a single preset.
 * @param prompt - Subject, request or human-readable name.
 * @returns True for apparent character-modeling intent.
 */
export function isHumanoidCharacterRequest(prompt: string): boolean {
  const text = normalize(prompt)
  return /\b(?:personaj\w*|character|avatar|vtuber|v-tuber|anime|humanoid\w*|humano|humana|retrato|caricatur\w*|munec\w*|figura humana|superheroe|cosplay|heroe|heroina|rostro|cara 3d|face 3d|mario(?:\s+bros)?|luigi|sonic|goku|mickey|pikachu|kirby)\b/u.test(text)
}
const match = (node: CharacterSceneNode, pattern: RegExp): boolean =>
  pattern.test(normalize(node.name ?? ''))
const head = /\b(?:cabeza|head|rostro|face|cara)\b/u
const face = /\b(?:ojo\w*|eye\w*|nariz|nose|bigote\w*|moustache|mustache|boca|mouth|labio\w*|lip\w*)\b/u
const anatomy = /\b(?:torso|cuerpo|body|cabeza|head|face|rostro|brazo\w*|arm\w*|pierna\w*|leg\w*|mano\w*|hand\w*|ojo\w*|eye\w*|nariz|nose|bigote\w*|gorra|hat|zapato\w*|shoe\w*|bota\w*|boot\w*)\b/u

/** Audit detached facial details and missing surface detail. No visual similarity is inferred.
 * @param scene - Validated native scene geometry.
 * @param prompt - Subject and title originally requested.
 * @returns Rejection reasons for final-looking character assemblies.
 */
export function auditCharacterGeometry(scene: CharacterScene, prompt: string): CharacterGeometryAudit {
  const text = normalize(prompt)
  const anatomyPieces = scene.nodes.filter(node => match(node, anatomy))
  const isCharacter = isHumanoidCharacterRequest(text)
    || (anatomyPieces.length >= 4 && scene.nodes.some(node => match(node, head))
      && scene.nodes.some(node => /\b(?:torso|cuerpo|body|brazo\w*|arm\w*|pierna\w*|leg\w*)\b/u.test(normalize(node.name ?? ''))))
  const isExplicitDraft = explicitlyLowPoly3D(text)
  const meshTriangles = scene.nodes.reduce((sum,node) =>
    sum + (node.type === 'mesh' ? Math.floor((node.vertices?.length ?? 0) / 9) : 0), 0)
  const errors: string[] = []
  if (!isCharacter) return { isCharacter, isExplicitDraft, meshTriangles, errors }
  // A character made of spheres and blocks is a concept, regardless of piece count.
  if (!isExplicitDraft && meshTriangles < 200) {
    errors.push('Personaje 3D sin malla suficientemente detallada: las primitivas son solo un boceto. Usar Studio/Blender y geometría de personaje, no presentarlo como modelo terminado.')
  }
  // Even an explicitly requested blockout must not display features floating far from the head.
  const heads = scene.nodes.filter(node => match(node, head))
  const facial = scene.nodes.filter(node => match(node, face))
  if (heads.length === 1) {
    const skull = heads[0]!
    for (const part of facial) {
      const distances = [0, 1, 2].map(i =>
        Math.abs(part.position[i]! - skull.position[i]!))
      // Allow moderate facial projection, hairline / helmet bulges and meshes;
      // flag only unmistakably detached centers far beyond the character's head.
      const limits = [0, 1, 2].map(i =>
        skull.size[i]! * (i === 2 ? 1.2 : .82) + part.size[i]! * .5)
      if (distances.some((distance,i) => distance > limits[i]!)) {
        errors.push(`Detalle facial separado de la cabeza: ${part.name ?? 'sin nombre'}.`)
      }
    }
  } else if (facial.length > 0 && heads.length === 0) {
    errors.push('Hay rasgos faciales sin una cabeza identificable en la escena.')
  }
  return { isCharacter, isExplicitDraft, meshTriangles, errors }
}
