/** Browser image-edit client. Carries only a normalized original photograph through the trusted Host RPC. */
import { normalizeAvatar } from './avatar-store.ts'
interface AvatarRpc {
  call(channel: string, endpoint: string, payload: unknown): Promise<
    { ok: true; value: unknown } | { ok: false; error: { message: string } }
  >
}
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_RESULT_BYTES = 15 * 1024 * 1024

/** Request a real Codex-backed image edit without exporting credentials to the browser. */
export async function transformAvatarThroughCodex(original: Blob, rpc: AvatarRpc): Promise<Blob> {
  if (original.type !== 'image/webp' || original.size === 0 || original.size > MAX_IMAGE_BYTES) {
    throw new Error('Primero guarda una foto de perfil válida.')
  }
  const bytes = new Uint8Array(await original.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  }
  const response = await rpc.call('/avatar', 'transform', { image: btoa(binary) })
  if (!response.ok) throw new Error(response.error.message)
  const result = response.value
  if (typeof result !== 'object' || result === null || !('provider' in result)
    || result.provider !== 'codex' || !('image' in result) || typeof result.image !== 'string'
    || !('mediaType' in result) || typeof result.mediaType !== 'string') {
    throw new Error('Codex no devolvió una imagen verificable.')
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(result.mediaType)) {
    throw new Error('Codex devolvió un formato de imagen no admitido.')
  }
  if (result.image.length > Math.ceil(MAX_RESULT_BYTES * 4 / 3) + 4
    || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(result.image)) {
    throw new Error('Codex devolvió una imagen demasiado grande o inválida.')
  }
  const raw = atob(result.image)
  const decoded = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) decoded[index] = raw.charCodeAt(index)
  // Normalize/crop and remove metadata, exactly like a manually uploaded photo.
  return normalizeAvatar(new Blob([decoded], { type: result.mediaType }))
}
