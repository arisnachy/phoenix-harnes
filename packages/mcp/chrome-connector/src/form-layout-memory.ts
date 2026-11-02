/** Origin-and-route scoped, value-free form layout memory for faster future tasks.
 * A learned layout is only a hint: the next visit must inspect the current
 * controls and still verify all values. No submissions are ever replayed.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserInteraction } from './browser-interactions.ts'

const DEFAULT_DIRECTORY = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'browser-form-layouts')
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000
const MAX_STEPS = 30
const MAX_FILE_BYTES = 16_384
const SIMPLE_NAME = /^[a-zA-Z_][\w:-]{0,59}$/
const SIMPLE_SELECTOR = /^(?:[a-zA-Z][\w-]{0,30})?(?:#[a-zA-Z_][\w-]{0,59}|\.[a-zA-Z_][\w-]{0,59})$/
const DISALLOWED = /password|passwd|secret|token|credential|authorization|api.?key|otp|cvv|credit.?card|card.?number|account.?number|session|cookie|bearer|email|phone|address/i

export type LayoutLocator = { selector?: string; name?: string; operation: 'fill'|'select'|'check'|'verify' }
export interface LearnedFormLayout {
  version: 1
  learnedAt: number
  steps: LayoutLocator[]
  verifiedChecks: LayoutLocator[]
}
function safeLocator(step: BrowserInteraction): LayoutLocator | undefined {
  if (!['fill','select','check','verify'].includes(step.operation)) return undefined
  const selector = step.selector?.trim()
  const name = step.name?.trim()
  if (selector && SIMPLE_SELECTOR.test(selector) && !DISALLOWED.test(selector)) {
    return { operation: step.operation as LayoutLocator['operation'], selector }
  }
  if (name && SIMPLE_NAME.test(name) && !DISALLOWED.test(name)) {
    return { operation: step.operation as LayoutLocator['operation'], name }
  }
  return undefined
}

/** Drops every field value, clicked option, label and free-form user text. */
export function sanitizeFormLayout(
  phases: readonly (readonly BrowserInteraction[])[],
  checks: readonly BrowserInteraction[],
  learnedAt = Date.now(),
): LearnedFormLayout | undefined {
  const steps = phases.flatMap(phase => phase.flatMap(step => {
    const locator = safeLocator(step)
    return locator && locator.operation !== 'verify' ? [locator] : []
  })).slice(0, MAX_STEPS)
  const verifiedChecks = checks.flatMap(step => {
    const locator = safeLocator(step)
    return locator && locator.operation === 'verify' ? [locator] : []
  }).slice(0, MAX_STEPS)
  if (!verifiedChecks.length) return undefined
  return { version: 1, learnedAt, steps, verifiedChecks }
}

/** Page query parameters and fragment never affect a site's reusable mapping. */
export function formLayoutKey(pageUrl: string): string {
  const url = new URL(pageUrl)
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Invalid form origin')
  if (url.protocol === 'http:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
    throw new TypeError('Refusing insecure external form memory')
  }
  return createHash('sha256').update(url.origin + url.pathname).digest('hex')
}
function fileFor(pageUrl: string, directory: string): string {
  return join(directory, formLayoutKey(pageUrl) + '.json')
}
export async function saveVerifiedFormLayout(
  pageUrl: string,
  phases: readonly (readonly BrowserInteraction[])[],
  checks: readonly BrowserInteraction[],
  directory = DEFAULT_DIRECTORY,
): Promise<boolean> {
  const layout = sanitizeFormLayout(phases, checks)
  if (!layout) return false
  const path = fileFor(pageUrl, directory)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(layout), { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
  return true
}
export async function recallVerifiedFormLayout(
  pageUrl: string, directory = DEFAULT_DIRECTORY, now = Date.now(),
): Promise<LearnedFormLayout | undefined> {
  let raw: string
  try {
    raw = await readFile(fileFor(pageUrl, directory), 'utf8')
  } catch { return undefined }
  if (raw.length > MAX_FILE_BYTES) return undefined
  try {
    const row: unknown = JSON.parse(raw)
    if (!row || typeof row !== 'object' || !('version' in row) || row.version !== 1
      || !('learnedAt' in row) || typeof row.learnedAt !== 'number'
      || row.learnedAt > now || now - row.learnedAt > MAX_AGE_MS
      || !('steps' in row) || !Array.isArray(row.steps) || row.steps.length > MAX_STEPS
      || !('verifiedChecks' in row) || !Array.isArray(row.verifiedChecks)
      || row.verifiedChecks.length < 1 || row.verifiedChecks.length > MAX_STEPS) return undefined
    const steps = row.steps as BrowserInteraction[]
    const checks = row.verifiedChecks as BrowserInteraction[]
    const sanitized = sanitizeFormLayout([steps], checks, row.learnedAt)
    // Never return tampered rows containing extra properties, secrets or values.
    if (!sanitized || JSON.stringify(sanitized) !== JSON.stringify(row)) return undefined
    return sanitized
  } catch { return undefined }
}

/** A fresh value supplied for the *current* form. Never persisted with the layout. */
export interface LearnedFieldValue {
  field: string
  value?: string
  checked?: boolean
}
/** Rebuild a strictly non-submitting form workflow from proven locators.
 * A stale/unknown/ambiguous field fails before any page mutation.
 */
export function prepareLearnedFormWorkflow(
  layout: LearnedFormLayout,
  entries: readonly LearnedFieldValue[],
): { phases: BrowserInteraction[][]; checks: BrowserInteraction[] } | undefined {
  if (!entries.length || entries.length > MAX_STEPS) return undefined
  const known = new Map<string, LayoutLocator>()
  for (const locator of [...layout.steps, ...layout.verifiedChecks]) {
    const identity = locator.selector ?? locator.name
    if (!identity) continue
    if (!known.has(identity)) known.set(identity, locator)
  }
  const used = new Set<string>()
  const actions: BrowserInteraction[] = []
  const checks: BrowserInteraction[] = []
  for (const input of entries) {
    if (used.has(input.field)) return undefined
    used.add(input.field)
    const locator = known.get(input.field)
    if (!locator) return undefined
    const operation = layout.steps.find(step =>
      (step.selector ?? step.name) === input.field)?.operation ?? 'fill'
    const selector = locator.selector
    const name = locator.name
    const target = { ...(selector ? { selector } : {}), ...(name ? { name } : {}) }
    if (operation === 'check' && typeof input.checked === 'boolean') {
      actions.push({ operation: 'check', ...target, checked: input.checked })
      checks.push({ operation: 'verify', ...target, checked: input.checked })
    } else if ((operation === 'fill' || operation === 'select' || operation === 'verify')
      && typeof input.value === 'string' && input.value.length <= 4096) {
      // A learned verification-only locator is filled only with NEW supplied data.
      actions.push({ operation: operation === 'select' ? 'select' : 'fill', ...target, value: input.value })
      checks.push({ operation: 'verify', ...target, value: input.value })
    } else return undefined
  }
  return { phases: [actions], checks }
}
