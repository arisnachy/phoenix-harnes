/**
 * Opt-in, pseudonymous clinical timeline encrypted with AES-256-GCM.
 * The vault is distinct from the conversation log; model-authored tool calls
 * and replies remain in the normal session history and require separate retention controls.
 * @module @phoenix-ai/dsh-tool-ask-user/clinical-ledger
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { readFile, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** Clinical fact origin; AI extraction does not count as clinician confirmation. */
export type ClinicalSource = 'patient-reported' | 'document-extracted' | 'clinician-verified'
/** The types of longitudinal clinical events stored in the local vault. */
export type ClinicalKind = 'symptom' | 'laboratory' | 'imaging' | 'diagnosis' | 'medication' | 'visit'

/** One explicitly attributed, dated clinical observation. */
export interface ClinicalInput {
  patientId: string
  observedAt: string
  kind: ClinicalKind
  description: string
  source: ClinicalSource
  analyte?: string
  value?: number
  unit?: string
}

/** Persisted clinical observation with immutable event and recording identifiers. */
export interface ClinicalEntry extends ClinicalInput {
  id: string
  recordedAt: string
}

/** Comparable values: do not compare across different units or analytes. */
export interface ClinicalTrend {
  analyte: string
  unit: string
  firstDate: string
  latestDate: string
  firstValue: number
  latestValue: number
  delta: number
}

interface VaultEnvelope {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function assertValidInput(input: ClinicalInput): void {
  if (!/^P-[A-Z0-9_-]{5,64}$/.test(input.patientId)) throw new Error('CLINICAL_PATIENT_ID_REQUIRED: use a pseudonymous P- identifier')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedAt) ||
      Number.isNaN(Date.parse(input.observedAt)) ||
      new Date(input.observedAt).toISOString().slice(0, 10) !== input.observedAt) {
    throw new Error('CLINICAL_DATE_INVALID: use YYYY-MM-DD')
  }
  if (!['symptom', 'laboratory', 'imaging', 'diagnosis', 'medication', 'visit'].includes(input.kind)) {
    throw new Error('CLINICAL_KIND_INVALID')
  }
  if (!['patient-reported', 'document-extracted', 'clinician-verified'].includes(input.source)) {
    throw new Error('CLINICAL_SOURCE_INVALID')
  }
  if (!input.description.trim() || input.description.length > 8000) throw new Error('CLINICAL_DESCRIPTION_INVALID')
  if ([input.analyte, input.value, input.unit].some(x => x !== undefined)) {
    if (!input.analyte?.trim() || input.analyte.length > 120 ||
        !input.unit?.trim() || input.unit.length > 80 ||
        input.value === undefined || !Number.isFinite(input.value)) {
      throw new Error('CLINICAL_MEASUREMENT_REQUIRES_ANALYTE_VALUE_UNIT')
    }
  }
}

/**
 * Produce consecutive differences for the same analyte and unit without diagnosis.
 * @param entries - Dated clinical observations for one patient.
 * @returns Comparable laboratory value changes.
 */
export function clinicalTrends(entries: readonly ClinicalEntry[]): ClinicalTrend[] {
  const latest = new Map<string, ClinicalEntry>()
  const trends: ClinicalTrend[] = []
  for (const entry of [...entries].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.recordedAt.localeCompare(b.recordedAt))) {
    if (entry.analyte === undefined || entry.unit === undefined || entry.value === undefined) continue
    const key = JSON.stringify([entry.analyte.toUpperCase(), entry.unit])
    const previous = latest.get(key)
    if (previous?.value !== undefined) {
      trends.push({
        analyte: entry.analyte, unit: entry.unit,
        firstDate: previous.observedAt, latestDate: entry.observedAt,
        firstValue: previous.value, latestValue: entry.value,
        delta: entry.value - previous.value,
      })
    }
    latest.set(key, entry)
  }
  return trends
}

/** Local owner-only vault; writes are atomic and protected by a fail-closed lock. */
export class ClinicalLedger {
  constructor(private readonly path: string, private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('CLINICAL_VAULT_KEY_INVALID')
  }

  private async readAll(): Promise<ClinicalEntry[]> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const envelope = JSON.parse(raw) as VaultEnvelope
    if (envelope.version !== 1 || typeof envelope.iv !== 'string' ||
        typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') {
      throw new Error('CLINICAL_VAULT_FORMAT_INVALID')
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const clear = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()])
    const parsed: unknown = JSON.parse(clear.toString('utf8'))
    if (!Array.isArray(parsed)) throw new Error('CLINICAL_VAULT_RECORDS_INVALID')
    return parsed as ClinicalEntry[]
  }

  private async writeAll(entries: ClinicalEntry[]): Promise<void> {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()])
    const envelope: VaultEnvelope = {
      version: 1, iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }
    const temp = this.path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 })
      await rename(temp, this.path)
    } finally {
      try { await unlink(temp) } catch (error) { if (!isMissing(error)) throw error }
    }
  }

  /**
   * Persist one observation after explicit human approval.
   * @param input - Validated, patient-scoped observation.
   * @returns The saved observation with its generated ID.
   */
  async append(input: ClinicalInput): Promise<ClinicalEntry> {
    assertValidInput(input)
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const lockPath = this.path + '.lock'
    const lock = await open(lockPath, 'wx', 0o600)
    try {
      const entries = await this.readAll()
      const entry: ClinicalEntry = { ...input, id: randomUUID(), recordedAt: new Date().toISOString() }
      await this.writeAll([...entries, entry])
      return entry
    } finally {
      await lock.close()
      await unlink(lockPath)
    }
  }

  /**
   * Read chronological observations isolated by pseudonymous patient ID.
   * @param patientId - An exact pseudonymous patient identifier.
   * @returns Chronological events and directly comparable trends.
   */
  async timeline(patientId: string): Promise<{ events: ClinicalEntry[]; trends: ClinicalTrend[] }> {
    if (!/^P-[A-Z0-9_-]{5,64}$/.test(patientId)) throw new Error('CLINICAL_PATIENT_ID_REQUIRED')
    const events = (await this.readAll())
      .filter(event => event.patientId === patientId)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.recordedAt.localeCompare(b.recordedAt))
    return { events, trends: clinicalTrends(events) }
  }
}

/**
 * Open a locally configured clinical vault; fail closed when unconfigured.
 * @returns An AES-256-GCM clinical vault.
 */
export function configuredClinicalLedger(): ClinicalLedger {
  const hex = process.env.PHOENIX_CLINICAL_VAULT_KEY
  if (hex === undefined || !/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error('CLINICAL_VAULT_NOT_CONFIGURED: set a local 32-byte hex PHOENIX_CLINICAL_VAULT_KEY; never share it in chat')
  }
  const path = process.env.PHOENIX_CLINICAL_VAULT_PATH ?? join(homedir(), '.dsh', 'clinical-vault.enc')
  return new ClinicalLedger(path, Buffer.from(hex, 'hex'))
}
