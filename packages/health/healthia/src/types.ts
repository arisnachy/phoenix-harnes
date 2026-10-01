import type { Branded } from '@phoenix-ai/dsh-brand'

/** Stable opaque identity for one isolated health record. */
export type PatientId = Branded<string, 'healthia-patient'>

/** Source class retained with every clinical fact. */
export type HealthSource =
  | 'user'
  | 'clinician'
  | 'device'
  | 'laboratory'
  | 'imaging'
  | 'document'
  | 'ehr'
  | 'derived'

/** Minimal demographic facts used only when clinically relevant. */
export interface PatientDemographics {
  readonly birthDate?: string
  readonly sexAtBirth?: 'female' | 'male' | 'intersex' | 'unknown'
  readonly genderIdentity?: string
}

/** One longitudinal observation with provenance and explicit time. */
export interface HealthObservation {
  readonly id: string
  readonly patientId: PatientId
  readonly code: string
  readonly value: string | number | boolean
  readonly unit?: string
  readonly observedAt: string
  readonly source: HealthSource
  readonly sourceRef?: string
  readonly confidence?: number
}

/** Durable patient identity and clinically relevant profile metadata. */
export interface PatientRecord {
  readonly id: PatientId
  readonly displayName?: string
  readonly demographics?: PatientDemographics
  readonly createdAt: string
  readonly updatedAt: string
}

/** Snapshot used by clinical reasoning consumers. */
export interface PatientSnapshot {
  readonly patient: PatientRecord
  readonly observations: readonly HealthObservation[]
}

/** Input accepted when a new isolated health record is created. */
export interface CreatePatientRequest {
  readonly displayName?: string
  readonly demographics?: PatientDemographics
}

/** Filters for bounded longitudinal observation reads. */
export interface ObservationQuery {
  readonly code?: string
  readonly since?: string
  readonly until?: string
  readonly limit?: number
}
