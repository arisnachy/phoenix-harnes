/**
 * PHOENIX Guardian: deterministic durable incident handoff, independent of any LLM.
 * The updater/supervisor own writes; the model only reads the bounded report.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SHA = /^[a-f0-9]{40}$/iu
const MAX_INCIDENTS = 24
const MAX_TEXT = 2048

export function guardianDirectory(env = process.env) {
  const home = env.DSH_HOME?.trim() ? resolve(env.DSH_HOME.trim()) : join(homedir(), '.dsh')
  return join(home, 'recovery')
}

export function guardianIncidentPath(env = process.env) {
  return join(guardianDirectory(env), 'phoenix-guardian-incidents.json')
}

// One immutable marker per failed release SHA survives bounded incident-history
// rotation and a concurrent writer replacing the JSON ledger.
function guardianQuarantinePath(target, env) {
  return join(guardianDirectory(env), 'quarantine', target.toLowerCase())
}

function persistGuardianQuarantine(target, env) {
  const path = guardianQuarantinePath(target, env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(path, '', { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
}

function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + process.pid + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
}

function scrub(text) {
  return String(text ?? '').slice(0, 8192)
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, 'https://[REDACTED]@')
    .replace(/\b(?:sk-(?:proj-)?[a-z0-9_-]{12,}|gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{12,})\b/giu, '[REDACTED]')
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/((?:"|')?(?:password|token|api[_ -]?key|client[_-]?secret|authorization|secret)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/giu, '$1[REDACTED]')
    .slice(0, MAX_TEXT)
}

function readLedger(path) {
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    // Never treat a damaged on-disk quarantine as empty: that would silently
    // unlock every previously rejected SHA and erase diagnostic evidence.
    throw new Error('PHOENIX Guardian incident ledger is unreadable; preserving the original', { cause: error })
  }
  if (value?.schema !== 1 || !Array.isArray(value.incidents)) {
    throw new Error('PHOENIX Guardian incident ledger has invalid schema; preserving the original')
  }
  return value.incidents
}

/**
 * Persist an update failure even when Kira or the live Host cannot start.
 * Identical incident receipts are idempotent and a failed SHA is quarantined.
 */
export function recordGuardianIncident(event, env = process.env) {
  if (!event || !SHA.test(event.failedTarget ?? '')) return undefined
  const path = guardianIncidentPath(env)
  const previous = SHA.test(event.previous ?? '') ? event.previous : undefined
  const status = ['rolled-back', 'rollback-failed', 'activation-failed', 'startup-failed']
    .includes(event.status) ? event.status : 'activation-failed'
  const phase = String(event.phase ?? 'activation').replace(/[^a-zA-Z0-9_-]/gu, '').slice(0, 64)
  const incidents = readLedger(path)
  persistGuardianQuarantine(event.failedTarget, env)
  const key = [event.failedTarget.toLowerCase(), status, phase].join(':')
  if (incidents.some(entry => entry.key === key)) return key
  const incident = {
    schema: 1, key, id: randomUUID(), at: new Date().toISOString(),
    status, phase, failedTarget: event.failedTarget.toLowerCase(),
    ...(previous ? { previous } : {}),
    diagnosis: scrub(event.diagnosis ?? event.detail ?? 'No verified process error was captured.'),
    delivery: 'pending',
  }
  atomic(path, { schema: 1, incidents: [...incidents, incident].slice(-MAX_INCIDENTS) })
  return key
}

/** Failed release SHA is never auto-retried after recovery (a different SHA may proceed). */
export function guardianBlockedTarget(target, env = process.env) {
  if (!SHA.test(target ?? '')) return false
  try {
    if (existsSync(guardianQuarantinePath(target, env))) return true
    return readLedger(guardianIncidentPath(env)).some(entry =>
      entry?.failedTarget === target.toLowerCase()
        && ['rolled-back', 'rollback-failed', 'activation-failed', 'startup-failed'].includes(entry.status))
  } catch (error) {
    // The good runtime can keep running. Never activate an unknown new SHA
    // when the recovery policy file cannot be verified.
    console.error('[PHOENIX GUARDIAN] update blocked: ' + (error instanceof Error ? error.message : String(error)))
    return true
  }
}

/** Read-only limited model input. Never treats an incident as authority to change permissions. */
export function pendingGuardianIncidents(env = process.env) {
  return readLedger(guardianIncidentPath(env))
    .filter(entry => entry?.delivery === 'pending')
    .slice(-3).map(entry => ({
      id: entry.id,
      at: entry.at,
      status: entry.status,
      phase: entry.phase,
      failedTarget: entry.failedTarget,
      previous: entry.previous,
      diagnosis: scrub(entry.diagnosis),
    }))
}

/** A verified Host can acknowledge processing; failures remain in the ledger. */
export function acknowledgeGuardianIncident(id, env = process.env) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(id)) return false
  const path = guardianIncidentPath(env)
  if (!existsSync(path)) return false
  const incidents = readLedger(path)
  if (!incidents.some(entry => entry.id === id && entry.delivery === 'pending')) return false
  atomic(path, { schema: 1, incidents: incidents.map(entry =>
    entry.id === id ? { ...entry, delivery: 'acknowledged', acknowledgedAt: new Date().toISOString() } : entry) })
  return true
}
