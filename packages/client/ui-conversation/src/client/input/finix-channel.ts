import type { ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import { readCompanionName } from '../skeleton/companion-name.ts'

/** Only a leading exact address is reserved; @file and later mentions remain unchanged. */
export function finixInstruction(text: string, name = readCompanionName()): string | undefined {
  const match = /^\s*@(?:"([^"]+)"|([\p{L}\p{N}_-]+))(?=\s|$)\s*/u.exec(text)
  if (!match) return undefined
  const address = (match[1] ?? match[2] ?? '').normalize('NFC').toLowerCase()
  const alias = name.normalize('NFC').toLowerCase()
  if (!['finix', 'fenix', 'fénix', 'phoenix'].includes(address) && ((address !== alias && address !== alias.replace(/\s+/gu, '-')) || alias === 'kira')) return undefined
  return text.slice(match[0].length).trim()
}

export interface FinixOutput {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly resident?: boolean
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
export function parseFinixOutput(value: unknown): readonly FinixOutput[] {
  if (!Array.isArray(value)) throw new Error('Respuesta de Finix inválida')
  return value.filter(record).filter(row => row.executionPolicy === 'companion-local' || row.executionPolicy === 'companion-resident').flatMap(row => {
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.status !== 'string' || !Array.isArray(row.recentHistory)) return []
    const resident = row.executionPolicy === 'companion-resident'
    const history = row.recentHistory.filter(record)
    return [{ id: row.id, title: row.title, status: row.status, ...(resident ? { resident: true } : {}), recentHistory: (resident ? history.slice(-1) : history).flatMap(item => {
      if (typeof item.status !== 'string') return []
      const summary = typeof item.summary === 'string' ? (resident ? residentSummary(item.summary) : item.summary) : undefined
      return [{ status: item.status, ...(summary === undefined ? {} : { summary }), ...(typeof item.error === 'string' ? { error: item.error } : {}) }]
    }) }]
  }).reverse()
}
export async function loadFinixOutput(connection: ConnectionHandle | undefined, signal: AbortSignal): Promise<readonly FinixOutput[]> {
  if (!connection?.rpc) throw new Error('Host de PHOENIX desconectado')
  const result = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
  if (!result.ok) throw new Error(result.error.message)
  return parseFinixOutput(result.value)
}
