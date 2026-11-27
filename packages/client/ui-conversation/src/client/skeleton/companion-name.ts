const KEY = 'phoenix.companion.display-name.v1'
export const DEFAULT_COMPANION_NAME = 'Finix'
/** Presentation preference only: never changes the stable mission identity or permission scope. */
export function normalizeCompanionName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_COMPANION_NAME
  const trimmed = value.normalize('NFC').trim()
  return /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,23}$/u.test(trimmed) ? trimmed : DEFAULT_COMPANION_NAME
}
export function readCompanionName(): string {
  try { return normalizeCompanionName(window.localStorage.getItem(KEY)) } catch { return DEFAULT_COMPANION_NAME }
}
export function saveCompanionName(value: string): string {
  const name = normalizeCompanionName(value)
  try { window.localStorage.setItem(KEY, name) } catch { /* preference remains usable for this view */ }
  return name
}
