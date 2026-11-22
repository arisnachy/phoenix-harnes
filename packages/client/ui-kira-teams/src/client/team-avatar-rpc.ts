/** Narrow same-origin image/name bridge for the PHOENIX Living Team studio.
 * Browser never receives Codex credentials. No silent generation or photo sharing.
 */
import { LIVING_TEAM_KINDS, type LivingTeamKind, type TeamDisplayNames } from './team-customization.ts'

export interface LivingTeamRpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<
    { ok: true; value: unknown } | { ok: false; error: { message: string } }
  >
}
const MAX_IMAGE = 8 * 1024 * 1024
const MAX_RETURN = 15 * 1024 * 1024

async function encodeImage(image: Blob): Promise<string> {
  if (image.type !== 'image/webp' || image.size === 0 || image.size > MAX_IMAGE) throw new Error('El retrato original no es válido.')
  const data = new Uint8Array(await image.arrayBuffer())
  let text = ''
  for (let n = 0; n < data.length; n += 32_768) text += String.fromCharCode(...data.subarray(n, n+32_768))
  return btoa(text)
}
function decodeImage(result: unknown): Blob {
  if (typeof result !== 'object' || result === null || !('provider' in result) || result.provider !== 'codex'
    || !('image' in result) || typeof result.image !== 'string' || !('mediaType' in result)) {
    throw new Error('El generador no devolvió una imagen verificable.')
  }
  const mediaType = result.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') {
    throw new Error('Formato de imagen generado no compatible.')
  }
  if (result.image.length > Math.ceil(MAX_RETURN * 4 / 3)+4 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(result.image)) {
    throw new Error('La respuesta contiene una imagen inválida o demasiado grande.')
  }
  const binary = atob(result.image)
  if (binary.length === 0 || binary.length > MAX_RETURN) throw new Error('La imagen supera el límite permitido.')
  const data = Uint8Array.from(binary, char => char.charCodeAt(0))
  const valid = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    || data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71
    || data[0] === 82 && data[1] === 73 && data[2] === 70 && data[3] === 70
      && data[8] === 87 && data[9] === 69 && data[10] === 66 && data[11] === 80
  if (!valid) throw new Error('Los píxeles generados no son un archivo raster válido.')
  return new Blob([data], { type: mediaType })
}
/** One explicit paid-or-session-backed Codex image task, selected by the user. */
export async function createTeamPortrait(rpc: LivingTeamRpc, request: {
  kind: LivingTeamKind; name: string; specialty: string; style?: string; original?: Blob
}): Promise<Blob> {
  const image = request.original === undefined ? undefined : await encodeImage(request.original)
  const response = await rpc.call('/avatar','team-portrait',{
    kind: request.kind, name: request.name, specialty: request.specialty,
    style: request.style ?? '',
    ...(image === undefined ? {} : { image }),
  })
  if (!response.ok) throw new Error(response.error.message)
  return decodeImage(response.value)
}
/** AI proposals are previews; a separate explicit UI action saves them. */
export async function suggestTeamNames(rpc: LivingTeamRpc, members: readonly {
  kind: LivingTeamKind; name: string; specialty: string
}[], direction: string): Promise<TeamDisplayNames> {
  const response = await rpc.call('/avatar','team-names',{
    members, direction: direction.slice(0, 180),
  })
  if (!response.ok) throw new Error(response.error.message)
  const value = response.value
  if (typeof value !== 'object' || value === null || !('names' in value) || !Array.isArray(value.names)) {
    throw new Error('La IA no devolvió una propuesta de nombres válida.')
  }
  const valid = new Set<string>(LIVING_TEAM_KINDS)
  const names: TeamDisplayNames = {}
  for (const entry of value.names as unknown[]) {
    if (typeof entry !== 'object' || entry === null || !('kind' in entry) || !('name' in entry)
      || typeof entry.kind !== 'string' || typeof entry.name !== 'string' || !valid.has(entry.kind)) {
      throw new Error('La IA respondió con una identidad desconocida.')
    }
    names[entry.kind as LivingTeamKind] = entry.name
  }
  if (Object.keys(names).length !== members.length) throw new Error('La IA no propuso un nombre para cada perfil.')
  return names
}
