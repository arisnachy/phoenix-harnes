import type { ConnectionHandle } from '@phoenix-ai/dsh-api-remotes/client'
import { readCompanionName } from '../skeleton/companion-name.ts'

/** Only a leading exact address is reserved; @file and later mentions remain unchanged. */
export function finixInstruction(text: string, name = readCompanionName()): string | undefined {
  const match = /^\s*@(?:"([^"]+)"|([\p{L}\p{N}_-]+))(?=\s|$)\s*/u.exec(text)
  if (!match) return undefined
  const address = (match[1] ?? match[2] ?? '').normalize('NFC').toLowerCase()
  const alias = name.normalize('NFC').toLowerCase()
  if (!['finix', 'fenix', 'fénix', 'phoenix'].includes(address) && (address !== alias || alias === 'kira')) return undefined
  return text.slice(match[0].length).trim()
}

export interface FinixOutput {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly recentHistory: readonly { status: string; summary?: string; error?: string }[]
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function parseFinixOutput(value: unknown): readonly FinixOutput[] {
  if (!Array.isArray(value)) throw new Error('Respuesta de Finix inválida')
  return value.filter(record).filter(row => row.executionPolicy === 'companion-local').flatMap(row => {
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.status !== 'string' || !Array.isArray(row.recentHistory)) return []
    return [{ id: row.id, title: row.title, status: row.status, recentHistory: row.recentHistory.filter(record).flatMap(item =>
      typeof item.status === 'string' ? [{ status: item.status, ...(typeof item.summary === 'string' ? { summary: item.summary } : {}), ...(typeof item.error === 'string' ? { error: item.error } : {}) }] : []) }]
  }).reverse()
}
export async function loadFinixOutput(connection: ConnectionHandle | undefined, signal: AbortSignal): Promise<readonly FinixOutput[]> {
  if (!connection?.rpc) throw new Error('Host de PHOENIX desconectado')
  const result = await connection.rpc.call('/phoenix-tasks', 'list', {}, signal)
  if (!result.ok) throw new Error(result.error.message)
  return parseFinixOutput(result.value)
}
