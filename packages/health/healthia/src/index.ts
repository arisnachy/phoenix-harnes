/**
 * Provider-neutral longitudinal health capability for PHOENIX.
 *
 * The health record is deliberately separate from conversation/session memory:
 * chat may consume this service, but chat is never the source of truth.
 * @module @phoenix-ai/dsh-healthia
 */

import { Service, type Context } from '@phoenix-ai/cordis'

/** Lossless JSON vocabulary accepted at the health-data boundary. */
export type HealthJson =
  | null
  | boolean
  | number
  | string
  | HealthJson[]
  | { readonly [key: string]: HealthJson }

/** Stable patient identifier. */
export type HealthPatientId = string & { readonly __healthPatientId: unique symbol }
/** Stable health-record identifier. */
export type HealthRecordId = string & { readonly __healthRecordId: unique symbol }
/** Stable clinical-episode identifier. */
export type HealthEpisodeId = string & { readonly __healthEpisodeId: unique symbol }

/** Construct a patient id after an owning boundary validates it. */
export function HealthPatientId(value: string): HealthPatientId {
  return normalizeId('patient id', value) as HealthPatientId
}

/** Construct a record id after an owning boundary validates it. */
export function HealthRecordId(value: string): HealthRecordId {
  return normalizeId('record id', value) as HealthRecordId
}

/** Construct an episode id after an owning boundary validates it. */
export function HealthEpisodeId(value: string): HealthEpisodeId {
  return normalizeId('episode id', value) as HealthEpisodeId
}

function normalizeId(label: string, value: string): string {
  if (value.length === 0 || value !== value.trim() || value.length > 128 || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw new TypeError(`healthia: ${label} must be a normalized identifier of at most 128 characters`)
  }
  return value
}

/** Biological sex when it is clinically relevant to an operation. */
export type HealthSexAtBirth = 'female' | 'male' | 'intersex' | 'unknown'

/**
 * Long-lived patient identity. Clinical sex and gender are separate fields:
 * consumers use only the field relevant to the clinical question.
 */
export interface HealthPatient {
  readonly id: HealthPatientId
  readonly displayName: string
  readonly birthDate?: string
  readonly sexAtBirth?: HealthSexAtBirth
  readonly genderIdentity?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Input for creating a new isolated health profile. */
export interface CreateHealthPatientInput {
  readonly id?: string
  readonly displayName: string
  readonly birthDate?: string
  readonly sexAtBirth?: HealthSexAtBirth
  readonly genderIdentity?: string
}

/** Allowed partial demographic changes; ids and creation times never change. */
export interface UpdateHealthPatientInput {
  readonly displayName?: string
  readonly birthDate?: string | null
  readonly sexAtBirth?: HealthSexAtBirth | null
  readonly genderIdentity?: string | null
}

/** Broad clinical categories used by the first canonical record layer. */
export type HealthRecordCategory =
  | 'symptom'
  | 'vital'
  | 'lab'
  | 'condition'
  | 'medication'
  | 'allergy'
  | 'procedure'
  | 'immunization'
  | 'imaging'
  | 'device'
  | 'nutrition'
  | 'activity'
  | 'sleep'
  | 'mental-health'
  | 'social'
  | 'appointment'
  | 'document'
  | 'goal'
  | 'care-plan'
  | 'other'

/** Where one fact came from. Provenance is mandatory for every health record. */
export interface HealthProvenance {
  readonly sourceKind: 'user' | 'device' | 'document' | 'clinician' | 'connector' | 'system'
  readonly sourceId?: string
  readonly sourceRef?: string
  readonly recordedAt: string
  readonly confidence?: number
}

/**
 * One canonical health fact. Model hypotheses must not be stored as facts;
 * inference belongs in an episode summary or a later evidence layer.
 */
export interface HealthRecord {
  readonly id: HealthRecordId
  readonly patientId: HealthPatientId
  readonly category: HealthRecordCategory
  readonly recordedAt: string
  readonly effectiveAt?: string
  readonly code?: string
  readonly display: string
  readonly value?: HealthJson
  readonly unit?: string
  readonly notes?: string
  readonly provenance: HealthProvenance
}

/** Input for recording one patient-scoped fact. */
export interface AddHealthRecordInput {
  readonly id?: string
  readonly patientId: string
  readonly category: HealthRecordCategory
  readonly effectiveAt?: string
  readonly code?: string
  readonly display: string
  readonly value?: HealthJson
  readonly unit?: string
  readonly notes?: string
  readonly provenance: Omit<HealthProvenance, 'recordedAt'> & { readonly recordedAt?: string }
}

/** Query over one patient's canonical facts. */
export interface HealthRecordQuery {
  readonly categories?: readonly HealthRecordCategory[]
  readonly since?: string
  readonly until?: string
  readonly limit?: number
}

/** One longitudinal clinical episode, such as a headache or BP follow-up. */
export interface HealthEpisode {
  readonly id: HealthEpisodeId
  readonly patientId: HealthPatientId
  readonly kind: string
  readonly title: string
  readonly status: 'open' | 'resolved' | 'cancelled'
  readonly openedAt: string
  readonly updatedAt: string
  readonly closedAt?: string
  readonly summary?: string
}

/** Input for opening a patient-scoped episode. */
export interface OpenHealthEpisodeInput {
  readonly id?: string
  readonly patientId: string
  readonly kind: string
  readonly title: string
  readonly openedAt?: string
  readonly summary?: string
}

/** Allowed episode transitions. */
export interface UpdateHealthEpisodeInput {
  readonly status?: HealthEpisode['status']
  readonly summary?: string | null
}

/** Bounded patient projection used by clinical reasoning. */
export interface HealthPatientSnapshot {
  readonly patient: HealthPatient
  readonly records: readonly HealthRecord[]
  readonly episodes: readonly HealthEpisode[]
  readonly generatedAt: string
}

/** Options for a bounded patient snapshot. */
export interface HealthSnapshotOptions {
  readonly recordLimit?: number
  readonly episodeLimit?: number
}

/** Machine-routable failure from the health domain. */
export class HealthiaError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'HealthiaError'
  }
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    healthia: HealthiaService
  }

  interface Events {
    /** A patient profile was created or updated. */
    'healthia/patient'(patient: Readonly<HealthPatient>): void
    /** A canonical patient fact was durably recorded. */
    'healthia/record'(record: Readonly<HealthRecord>): void
    /** A clinical episode was opened or updated. */
    'healthia/episode'(episode: Readonly<HealthEpisode>): void
  }
}

/**
 * Service definition for Phoenix's longitudinal health record.
 *
 * Providers own persistence/encryption. Consumers never write a session log
 * and pretend it is a medical record.
 */
export abstract class HealthiaService extends Service {
  constructor(ctx: Context) {
    if (new.target === HealthiaService) {
      throw new Error('@phoenix-ai/dsh-healthia is a Service Definition; load a provider such as @phoenix-ai/dsh-healthia-local')
    }
    super(ctx, 'healthia')
  }

  /** List isolated patient profiles without returning clinical records. */
  abstract listPatients(): Promise<readonly HealthPatient[]>
  /** Resolve one patient profile or undefined. */
  abstract getPatient(id: HealthPatientId): Promise<HealthPatient | undefined>
  /** Create one patient profile. */
  abstract createPatient(input: CreateHealthPatientInput): Promise<HealthPatient>
  /** Update demographics without changing patient identity. */
  abstract updatePatient(id: HealthPatientId, input: UpdateHealthPatientInput): Promise<HealthPatient>
  /** Append one provenance-bearing canonical fact. */
  abstract addRecord(input: AddHealthRecordInput): Promise<HealthRecord>
  /** Query facts belonging only to the named patient. */
  abstract listRecords(id: HealthPatientId, query?: HealthRecordQuery): Promise<readonly HealthRecord[]>
  /** Open one longitudinal patient episode. */
  abstract openEpisode(input: OpenHealthEpisodeInput): Promise<HealthEpisode>
  /** Update an existing episode. */
  abstract updateEpisode(id: HealthEpisodeId, input: UpdateHealthEpisodeInput): Promise<HealthEpisode>
  /** Return a bounded longitudinal projection for reasoning. */
  abstract snapshot(id: HealthPatientId, options?: HealthSnapshotOptions): Promise<HealthPatientSnapshot>
}

export default HealthiaService
