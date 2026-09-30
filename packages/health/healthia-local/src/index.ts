/**
 * Encrypted owner-local provider for the PHOENIX HealthIA record.
 * @module @phoenix-ai/dsh-healthia-local
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { credentialRef } from '@phoenix-ai/dsh-credentials'
import {
  HealthEpisodeId,
  HealthPatientId,
  HealthRecordId,
  HealthiaError,
  HealthiaService,
} from '@phoenix-ai/dsh-healthia'
import type {
  AddHealthRecordInput,
  CreateHealthPatientInput,
  HealthEpisode,
  HealthJson,
  HealthPatient,
  HealthPatientSnapshot,
  HealthRecord,
  HealthRecordCategory,
  HealthRecordQuery,
  HealthSexAtBirth,
  HealthSnapshotOptions,
  OpenHealthEpisodeInput,
  UpdateHealthEpisodeInput,
  UpdateHealthPatientInput,
} from '@phoenix-ai/dsh-healthia'

/** Default credential reference containing the local health-record encryption secret. */
export const DEFAULT_HEALTHIA_KEY_REF = 'PHOENIX_HEALTHIA_DATA_KEY'

const DOCUMENT_AAD = Buffer.from('phoenix-healthia-local-v1', 'utf8')
const MAX_RECORD_QUERY = 1_000
const MAX_SNAPSHOT_RECORDS = 500
const MAX_SNAPSHOT_EPISODES = 100

/** Local encrypted-store configuration. */
export interface Config {
  /** Owner-private encrypted HealthIA document. */
  path: string
  /** Credential reference containing the encryption secret. */
  keyRef?: string
}

/** Loader validation for the encrypted local provider. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  keyRef: z.string().default(DEFAULT_HEALTHIA_KEY_REF),
})

interface HealthDocument {
  readonly version: 1
  readonly patients: HealthPatient[]
  readonly records: HealthRecord[]
  readonly episodes: HealthEpisode[]
}

interface EncryptedEnvelope {
  readonly version: 1
  readonly algorithm: 'aes-256-gcm'
  readonly iv: string
  readonly tag: string
  readonly ciphertext: string
}

const EMPTY_DOCUMENT: HealthDocument = {
  version: 1,
  patients: [],
  records: [],
  episodes: [],
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizedText(label: string, value: string, max = 2_000): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) {
    throw new HealthiaError(`${label} must be non-empty and at most ${String(max)} characters`, 'HEALTHIA_INVALID_INPUT')
  }
  return normalized
}

function assertIso(label: string, value: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new HealthiaError(`${label} must be an ISO-compatible date/time`, 'HEALTHIA_INVALID_INPUT')
  }
  return value
}

function assertBirthDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new HealthiaError('birthDate must use YYYY-MM-DD', 'HEALTHIA_INVALID_INPUT')
  }
  return value
}

function assertConfidence(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new HealthiaError('provenance confidence must be between 0 and 1', 'HEALTHIA_INVALID_INPUT')
  }
  return value
}

function assertJson(value: HealthJson, path = 'value'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HealthiaError(`${path} contains a non-finite number`, 'HEALTHIA_INVALID_INPUT')
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJson(entry, `${path}[${String(index)}]`))
    return
  }
  for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}.${key}`)
}

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new HealthiaError(`limit must be a positive integer <= ${String(maximum)}`, 'HEALTHIA_INVALID_INPUT')
  }
  return resolved
}

function patientExists(document: HealthDocument, id: string): HealthPatient {
  const patient = document.patients.find(candidate => candidate.id === id)
  if (patient === undefined) throw new HealthiaError(`unknown patient ${id}`, 'HEALTHIA_PATIENT_NOT_FOUND')
  return patient
}

function parseDocument(value: unknown): HealthDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('healthia-local: decrypted document must be an object')
  }
  const object = value as Partial<HealthDocument>
  if (object.version !== 1 || !Array.isArray(object.patients)
    || !Array.isArray(object.records) || !Array.isArray(object.episodes)) {
    throw new Error('healthia-local: unsupported or malformed health document')
  }
  const patientIds = new Set<string>()
  for (const patient of object.patients) {
    if (patient === null || typeof patient !== 'object') throw new Error('healthia-local: malformed patient')
    HealthPatientId(patient.id)
    if (patientIds.has(patient.id)) throw new Error(`healthia-local: duplicate patient ${patient.id}`)
    patientIds.add(patient.id)
  }
  const recordIds = new Set<string>()
  for (const record of object.records) {
    if (record === null || typeof record !== 'object') throw new Error('healthia-local: malformed record')
    HealthRecordId(record.id)
    HealthPatientId(record.patientId)
    if (!patientIds.has(record.patientId)) throw new Error(`healthia-local: record ${record.id} references unknown patient`)
    if (recordIds.has(record.id)) throw new Error(`healthia-local: duplicate record ${record.id}`)
    recordIds.add(record.id)
  }
  const episodeIds = new Set<string>()
  for (const episode of object.episodes) {
    if (episode === null || typeof episode !== 'object') throw new Error('healthia-local: malformed episode')
    HealthEpisodeId(episode.id)
    HealthPatientId(episode.patientId)
    if (!patientIds.has(episode.patientId)) throw new Error(`healthia-local: episode ${episode.id} references unknown patient`)
    if (episodeIds.has(episode.id)) throw new Error(`healthia-local: duplicate episode ${episode.id}`)
    episodeIds.add(episode.id)
  }
  return clone(object as HealthDocument)
}

function deriveKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, 'base64')
  return decoded.length === 32 && decoded.toString('base64').replace(/=+$/u, '') === secret.replace(/=+$/u, '')
    ? decoded
    : createHash('sha256').update(secret, 'utf8').digest()
}

function encrypt(document: HealthDocument, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(DOCUMENT_AAD)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(document), 'utf8'),
    cipher.final(),
  ])
  const envelope: EncryptedEnvelope = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

function decrypt(text: string, key: Buffer): HealthDocument {
  const parsed = JSON.parse(text) as Partial<EncryptedEnvelope>
  if (parsed.version !== 1 || parsed.algorithm !== 'aes-256-gcm'
    || typeof parsed.iv !== 'string' || typeof parsed.tag !== 'string'
    || typeof parsed.ciphertext !== 'string') {
    throw new Error('healthia-local: unsupported encrypted envelope')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'))
  decipher.setAAD(DOCUMENT_AAD)
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
  return parseDocument(JSON.parse(plaintext) as unknown)
}

function categorySet(categories: readonly HealthRecordCategory[] | undefined): Set<HealthRecordCategory> | undefined {
  if (categories === undefined) return undefined
  return new Set(categories)
}

/** Encrypted local HealthIA provider. */
export class LocalHealthiaService extends HealthiaService {
  static inject = ['credentials']
  static Config: z<Config> = Config

  private keyPromise: Promise<Buffer> | undefined

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    if (config.path.length === 0 || config.path !== config.path.trim()) {
      throw new TypeError('healthia-local: path must be a non-empty normalized string')
    }
  }

  override async listPatients(): Promise<readonly HealthPatient[]> {
    return clone((await this.read()).patients)
  }

  override async getPatient(id: ReturnType<typeof HealthPatientId>): Promise<HealthPatient | undefined> {
    const patient = (await this.read()).patients.find(candidate => candidate.id === id)
    return patient === undefined ? undefined : clone(patient)
  }

  override async createPatient(input: CreateHealthPatientInput): Promise<HealthPatient> {
    const timestamp = now()
    const patient: HealthPatient = {
      id: HealthPatientId(input.id ?? newId('patient')),
      displayName: normalizedText('displayName', input.displayName, 200),
      ...(input.birthDate === undefined ? {} : { birthDate: assertBirthDate(input.birthDate) }),
      ...(input.sexAtBirth === undefined ? {} : { sexAtBirth: input.sexAtBirth }),
      ...(input.genderIdentity === undefined ? {} : { genderIdentity: normalizedText('genderIdentity', input.genderIdentity, 200) }),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await this.mutate((document) => {
      if (document.patients.some(candidate => candidate.id === patient.id)) {
        throw new HealthiaError(`patient ${patient.id} already exists`, 'HEALTHIA_DUPLICATE_PATIENT')
      }
      return [{ ...document, patients: [...document.patients, patient] }, patient] as const
    })
    this.ctx.emit('healthia/patient', clone(patient))
    return clone(patient)
  }

  override async updatePatient(
    id: ReturnType<typeof HealthPatientId>,
    input: UpdateHealthPatientInput,
  ): Promise<HealthPatient> {
    const patient = await this.mutate((document) => {
      const current = patientExists(document, id)
      const next: {
        id: HealthPatient['id']
        displayName: string
        birthDate?: string
        sexAtBirth?: HealthSexAtBirth
        genderIdentity?: string
        createdAt: string
        updatedAt: string
      } = {
        ...current,
        ...(input.displayName === undefined ? {} : { displayName: normalizedText('displayName', input.displayName, 200) }),
        ...(input.birthDate === undefined || input.birthDate === null ? {} : { birthDate: assertBirthDate(input.birthDate) }),
        ...(input.sexAtBirth === undefined || input.sexAtBirth === null ? {} : { sexAtBirth: input.sexAtBirth }),
        ...(input.genderIdentity === undefined || input.genderIdentity === null
          ? {}
          : { genderIdentity: normalizedText('genderIdentity', input.genderIdentity, 200) }),
        updatedAt: now(),
      }
      if (input.birthDate === null) delete next.birthDate
      if (input.sexAtBirth === null) delete next.sexAtBirth
      if (input.genderIdentity === null) delete next.genderIdentity
      const patients = document.patients.map(candidate => candidate.id === id ? next : candidate)
      return [{ ...document, patients }, next] as const
    })
    this.ctx.emit('healthia/patient', clone(patient))
    return clone(patient)
  }

  override async addRecord(input: AddHealthRecordInput): Promise<HealthRecord> {
    if (input.value !== undefined) assertJson(input.value)
    const recordedAt = assertIso('provenance.recordedAt', input.provenance.recordedAt ?? now())
    const record: HealthRecord = {
      id: HealthRecordId(input.id ?? newId('record')),
      patientId: HealthPatientId(input.patientId),
      category: input.category,
      recordedAt,
      ...(input.effectiveAt === undefined ? {} : { effectiveAt: assertIso('effectiveAt', input.effectiveAt) }),
      ...(input.code === undefined ? {} : { code: normalizedText('code', input.code, 200) }),
      display: normalizedText('display', input.display, 1_000),
      ...(input.value === undefined ? {} : { value: clone(input.value) }),
      ...(input.unit === undefined ? {} : { unit: normalizedText('unit', input.unit, 100) }),
      ...(input.notes === undefined ? {} : { notes: normalizedText('notes', input.notes, 4_000) }),
      provenance: {
        sourceKind: input.provenance.sourceKind,
        ...(input.provenance.sourceId === undefined ? {} : { sourceId: normalizedText('sourceId', input.provenance.sourceId, 500) }),
        ...(input.provenance.sourceRef === undefined ? {} : { sourceRef: normalizedText('sourceRef', input.provenance.sourceRef, 2_000) }),
        recordedAt,
        ...(assertConfidence(input.provenance.confidence) === undefined
          ? {}
          : { confidence: assertConfidence(input.provenance.confidence)! }),
      },
    }
    await this.mutate((document) => {
      patientExists(document, record.patientId)
      if (document.records.some(candidate => candidate.id === record.id)) {
        throw new HealthiaError(`record ${record.id} already exists`, 'HEALTHIA_DUPLICATE_RECORD')
      }
      return [{ ...document, records: [...document.records, record] }, record] as const
    })
    this.ctx.emit('healthia/record', clone(record))
    return clone(record)
  }

  override async listRecords(
    id: ReturnType<typeof HealthPatientId>,
    query: HealthRecordQuery = {},
  ): Promise<readonly HealthRecord[]> {
    const document = await this.read()
    patientExists(document, id)
    const categories = categorySet(query.categories)
    const since = query.since === undefined ? undefined : Date.parse(assertIso('since', query.since))
    const until = query.until === undefined ? undefined : Date.parse(assertIso('until', query.until))
    const limit = boundedLimit(query.limit, 100, MAX_RECORD_QUERY)
    return clone(document.records
      .filter(record => record.patientId === id)
      .filter(record => categories === undefined || categories.has(record.category))
      .filter((record) => {
        const time = Date.parse(record.effectiveAt ?? record.recordedAt)
        return (since === undefined || time >= since) && (until === undefined || time <= until)
      })
      .sort((left, right) => Date.parse(right.effectiveAt ?? right.recordedAt) - Date.parse(left.effectiveAt ?? left.recordedAt))
      .slice(0, limit))
  }

  override async openEpisode(input: OpenHealthEpisodeInput): Promise<HealthEpisode> {
    const openedAt = assertIso('openedAt', input.openedAt ?? now())
    const episode: HealthEpisode = {
      id: HealthEpisodeId(input.id ?? newId('episode')),
      patientId: HealthPatientId(input.patientId),
      kind: normalizedText('kind', input.kind, 200),
      title: normalizedText('title', input.title, 500),
      status: 'open',
      openedAt,
      updatedAt: openedAt,
      ...(input.summary === undefined ? {} : { summary: normalizedText('summary', input.summary, 8_000) }),
    }
    await this.mutate((document) => {
      patientExists(document, episode.patientId)
      if (document.episodes.some(candidate => candidate.id === episode.id)) {
        throw new HealthiaError(`episode ${episode.id} already exists`, 'HEALTHIA_DUPLICATE_EPISODE')
      }
      return [{ ...document, episodes: [...document.episodes, episode] }, episode] as const
    })
    this.ctx.emit('healthia/episode', clone(episode))
    return clone(episode)
  }

  override async updateEpisode(
    id: ReturnType<typeof HealthEpisodeId>,
    input: UpdateHealthEpisodeInput,
  ): Promise<HealthEpisode> {
    const episode = await this.mutate((document) => {
      const current = document.episodes.find(candidate => candidate.id === id)
      if (current === undefined) throw new HealthiaError(`unknown episode ${id}`, 'HEALTHIA_EPISODE_NOT_FOUND')
      const timestamp = now()
      const status = input.status ?? current.status
      const next: {
        id: HealthEpisode['id']
        patientId: HealthEpisode['patientId']
        kind: string
        title: string
        status: HealthEpisode['status']
        openedAt: string
        updatedAt: string
        closedAt?: string
        summary?: string
      } = {
        ...current,
        status,
        updatedAt: timestamp,
        ...(status === 'open' ? {} : { closedAt: current.closedAt ?? timestamp }),
        ...(input.summary === undefined || input.summary === null
          ? {}
          : { summary: normalizedText('summary', input.summary, 8_000) }),
      }
      if (status === 'open') delete next.closedAt
      if (input.summary === null) delete next.summary
      const episodes = document.episodes.map(candidate => candidate.id === id ? next : candidate)
      return [{ ...document, episodes }, next] as const
    })
    this.ctx.emit('healthia/episode', clone(episode))
    return clone(episode)
  }

  override async snapshot(
    id: ReturnType<typeof HealthPatientId>,
    options: HealthSnapshotOptions = {},
  ): Promise<HealthPatientSnapshot> {
    const document = await this.read()
    const patient = clone(patientExists(document, id))
    const recordLimit = boundedLimit(options.recordLimit, 100, MAX_SNAPSHOT_RECORDS)
    const episodeLimit = boundedLimit(options.episodeLimit, 20, MAX_SNAPSHOT_EPISODES)
    const records = document.records
      .filter(record => record.patientId === id)
      .sort((left, right) => Date.parse(right.effectiveAt ?? right.recordedAt) - Date.parse(left.effectiveAt ?? left.recordedAt))
      .slice(0, recordLimit)
    const episodes = document.episodes
      .filter(episode => episode.patientId === id)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, episodeLimit)
    return clone({ patient, records, episodes, generatedAt: now() })
  }

  private async resolveKey(name: string): Promise<Buffer> {
    const ref = credentialRef(name)
    let resolved = await this.ctx.credentials.resolve(ref)
    if (resolved === undefined) {
      const info = await this.ctx.credentials.describe(ref)
      if (!info.writable) {
        throw new Error(`healthia-local: encryption key ${name} is missing and the credential store is not writable`)
      }
      const generated = randomBytes(32).toString('base64')
      await this.ctx.credentials.set(ref, generated)
      resolved = await this.ctx.credentials.resolve(ref)
    }
    if (resolved === undefined || resolved.value.length === 0) {
      throw new Error(`healthia-local: encryption key ${name} could not be resolved`)
    }
    return deriveKey(resolved.value)
  }

  private encryptionKey(): Promise<Buffer> {
    this.keyPromise ??= this.resolveKey(this.config.keyRef ?? DEFAULT_HEALTHIA_KEY_REF)
    return this.keyPromise
  }

  private async read(): Promise<HealthDocument> {
    const key = await this.encryptionKey()
    return await this.readUnlocked(key)
  }

  private async readUnlocked(key: Buffer): Promise<HealthDocument> {
    let text: string
    try {
      text = await readFile(this.config.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return clone(EMPTY_DOCUMENT)
      throw error
    }
    return decrypt(text, key)
  }

  private async mutate<T>(
    mutation: (document: HealthDocument) => readonly [HealthDocument, T],
  ): Promise<T> {
    const key = await this.encryptionKey()
    await mkdir(dirname(this.config.path), { recursive: true, mode: 0o700 })
    return await withFileLock(this.config.path, async () => {
      const current = await this.readUnlocked(key)
      const [next, result] = mutation(current)
      const checked = parseDocument(next)
      await writeFileAtomic(this.config.path, encrypt(checked, key), { mode: 0o600, dirMode: 0o700 })
      return clone(result)
    }, { waitMs: 10_000 })
  }
}

export default LocalHealthiaService
