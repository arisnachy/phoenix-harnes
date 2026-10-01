/**
 * Native longitudinal health capability contract for PHOENIX.
 * HealthIA is additive: Phoenix Core never requires it to boot.
 * @module @phoenix-ai/dsh-healthia
 */

import { Context, Service } from '@phoenix-ai/cordis'
import type {
  CreatePatientRequest,
  HealthObservation,
  ObservationQuery,
  PatientId,
  PatientRecord,
  PatientSnapshot,
} from './types.ts'

export type * from './types.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    healthia: HealthIA
  }
}

/**
 * Service Definition for Phoenix health capabilities.
 *
 * Providers own encrypted durable storage and interoperability. Consumers
 * perform interviewing, clinical reasoning, evidence retrieval, monitoring,
 * community navigation, and other health workflows through this boundary.
 */
export abstract class HealthIA extends Service {
  constructor(ctx: Context) {
    if (new.target === HealthIA) {
      throw new Error('@phoenix-ai/dsh-healthia is a Service Definition; load a HealthIA provider')
    }
    super(ctx, 'healthia')
  }

  /** Create one patient-isolated health record. */
  abstract createPatient(request: CreatePatientRequest): Promise<PatientRecord>

  /** Read one patient identity or throw when it is unknown. */
  abstract getPatient(id: PatientId): Promise<PatientRecord>

  /** List detached patient identities without exposing observations. */
  abstract listPatients(): Promise<PatientRecord[]>

  /** Append one validated clinical observation to exactly one patient. */
  abstract appendObservation(observation: HealthObservation): Promise<HealthObservation>

  /** Query a bounded longitudinal observation window for one patient. */
  abstract observations(id: PatientId, query?: ObservationQuery): Promise<HealthObservation[]>

  /** Build a detached longitudinal snapshot for reasoning consumers. */
  abstract snapshot(id: PatientId, query?: ObservationQuery): Promise<PatientSnapshot>

  /** Permanently delete one patient record and all HealthIA-owned clinical facts. */
  abstract deletePatient(id: PatientId): Promise<void>
}

export default HealthIA
