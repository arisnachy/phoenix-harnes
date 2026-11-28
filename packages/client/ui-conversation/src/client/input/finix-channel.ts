import type { ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import { readCompanionName } from '../skeleton/companion-name.ts'

/** Only a leading exact address is reserved; @file and later mentions remain unchanged.
 * @param text - User draft.
 * @param name - Configured companion name.
 * @returns Addressed message or undefined.
 */
export function finixInstruction(text: string, name = readCompanionName()): string | undefined {
  const match = /^\s*@(?:"([^"]+)"|([\p{L}\p{N}_-]+))(?=\s|$)\s*/u.exec(text)
  if (!match) return undefined
  const address = (match[1] ?? match[2] ?? '').normalize('NFC').toLowerCase()
  const alias = name.normalize('NFC').toLowerCase()
  if (!['finix', 'fenix', 'fénix', 'phoenix'].includes(address) && ((address !== alias && address !== alias.replace(/\s+/gu, '-')) || alias === 'kira')) return undefined
  return text.slice(match[0].length).trim()
}

/** Browser-safe companion output. */
export interface FinixOutput {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly resident?: boolean
  readonly initiative?: string
  readonly recentHistory: readonly { status: string; summary?: string; error?: string }[]
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** Translate verified resident snapshots, not arbitrary model text. */
function residentSummary(summary: string): string | undefined {
  try {
    const value: unknown = JSON.parse(summary)
    if (!record(value) || value.identity !== 'finix') return undefined
    const { tools, capabilities, degraded, failed, repeated, due, running, memory, next } = value
    if (![tools, capabilities, degraded, failed, repeated, due, running].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return undefined
    if (memory !== 'normal' && memory !== 'pressure' && memory !== 'unknown') return undefined
    const actions = { diagnose: 'Investigar tareas fallidas', resources: 'Revisar recursos del equipo', 'review-due': 'Revisar el planificador', verify: 'Verificar capacidades degradadas', observe: 'Continuar observando' }
    if (typeof next !== 'string' || !Object.hasOwn(actions, next)) return undefined
    return `Observación del sistema: ${tools} herramientas registradas, ${capabilities} capacidades declaradas, ${degraded} degradadas. Tareas fallidas: ${failed} (${repeated} repetidas); vencidas: ${due}; en ejecución: ${running}. Memoria: ${memory === 'normal' ? 'normal' : memory === 'pressure' ? 'bajo presión' : 'desconocida'}. Próxima iniciativa propuesta: ${actions[next as keyof typeof actions]}.`
  } catch { return undefined }
}
/** An unsolicited speech bubble requires a validated material resident observation. */
function residentInitiative(summary: string): string | undefined {
  if (residentSummary(summary) === undefined) return undefined
  const snapshot = JSON.parse(summary) as { next: string; failed: number; repeated: number; due: number; degraded: number }
  switch (snapshot.next) {
    case 'diagnose': return snapshot.failed > 0 ? `Detecté ${snapshot.failed} tareas fallidas. Propongo revisar qué está pasando.` : undefined
    case 'resources': return 'Detecté presión de memoria. Propongo revisar los recursos del equipo.'
    case 'review-due': return snapshot.due > 0 ? `Hay ${snapshot.due} tareas vencidas. Propongo revisar el planificador.` : undefined
    case 'verify': return snapshot.degraded > 0 ? `Detecté ${snapshot.degraded} capacidades degradadas. Propongo verificarlas.` : undefined
    default: return undefined
  }
}
/** Parse the host task view without exposing unrelated tasks.
 * @param value - Host response.
 * @returns Validated companion output rows.
 */
export function parseFinixOutput(value: unknown): readonly FinixOutput[] {
  if (!Array.isArray(value)) throw new Error('Respuesta de Finix inválida')
  return value.filter(record).filter(row => row.executionPolicy === 'companion-local' || row.executionPolicy === 'companion-resident').flatMap(row => {
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.status !== 'string' || !Array.isArray(row.recentHistory)) return []
    const resident = row.executionPolicy === 'companion-resident'
    const history = row.recentHistory.filter(record)
    const latest = history.at(-1)
    const initiative = resident && latest?.status === 'completed' && typeof latest.summary === 'string' ? residentInitiative(latest.summary) : undefined
    return [{ id: row.id, title: row.title, status: row.status, ...(resident ? { resident: true } : {}), ...(initiative === undefined ? {} : { initiative }), recentHistory: (resident ? history.slice(-1) : history).flatMap(item => {
      if (typeof item.status !== 'string') return []
      const summary = typeof item.summary === 'string' ? (resident ? residentSummary(item.summary) : item.summary) : undefined
      return [{ status: item.status, ...(summary === undefined ? {} : { summary }), ...(typeof item.error === 'string' ? { error: item.error } : {}) }]
    }) }]
  }).reverse()
}
/** Fetch the companion feed.
 * @param connection - Host connection.
 * @param signal - Cancellation signal.
 * @returns Validated companion rows.
 */
export async function loadFinixOutput(connection: ConnectionHandle | undefined, signal: AbortSignal): Promise<readonly FinixOutput[]> {
  if (!connection?.rpc) throw new Error('Host de PHOENIX desconectado')
  const result = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
  if (!result.ok) throw new Error(result.error.message)
  return parseFinixOutput(result.value)
}

/** Explicit, session-scoped recipient selection. Opening the output does not change the recipient. */
const finixSessions = new Set<string>()
/** Recipient change notification. */
export const FINIX_RECIPIENT_EVENT = 'phoenix:finix-recipient'
/** Read the selected recipient.
 * @param sessionId - Session identity.
 * @returns Whether Finix is selected.
 */
export function isFinixRecipient(sessionId: string): boolean { return finixSessions.has(sessionId) }
/** Select a recipient for one session.
 * @param sessionId - Session identity.
 * @param active - Whether Finix is selected.
 */
export function setFinixRecipient(sessionId: string, active: boolean): void {
  if (active === finixSessions.has(sessionId)) return
  if (active) finixSessions.add(sessionId)
  else finixSessions.delete(sessionId)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(FINIX_RECIPIENT_EVENT))
}
/** Resolve explicit and continuing companion messages.
 * @param text - User draft.
 * @param sessionId - Session identity.
 * @returns Companion instruction or undefined.
 */
export function resolveFinixMessage(text: string, sessionId: string): string | undefined {
  const explicit = finixInstruction(text)
  if (explicit !== undefined) return explicit
  // An explicit different @address or slash command never inherits Finix.
  if (/^\s*[@/]/u.test(text)) return undefined
  return isFinixRecipient(sessionId) ? text.trim() : undefined
}
