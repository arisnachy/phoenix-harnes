import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import HealthIA from '../src/index.ts'
import type {
  CreatePatientRequest,
  HealthObservation,
  ObservationQuery,
  PatientId,
  PatientRecord,
  PatientSnapshot,
} from '../src/types.ts'

class TestHealthIA extends HealthIA {
  createPatient(_request: CreatePatientRequest): Promise<PatientRecord> {
    throw new Error('not implemented')
  }

  getPatient(_id: PatientId): Promise<PatientRecord> {
    throw new Error('not implemented')
  }

  listPatients(): Promise<PatientRecord[]> {
    return Promise.resolve([])
  }

  appendObservation(_observation: HealthObservation): Promise<HealthObservation> {
    throw new Error('not implemented')
  }

  observations(_id: PatientId, _query?: ObservationQuery): Promise<HealthObservation[]> {
    return Promise.resolve([])
  }

  snapshot(_id: PatientId, _query?: ObservationQuery): Promise<PatientSnapshot> {
    throw new Error('not implemented')
  }

  deletePatient(_id: PatientId): Promise<void> {
    return Promise.resolve()
  }
}

describe('HealthIA Service Definition', () => {
  it('cannot be loaded as a concrete provider', () => {
    const ctx = new Context()
    expect(() => new (HealthIA as unknown as new (ctx: Context) => HealthIA)(ctx))
      .toThrow(/Service Definition/)
  })

  it('allows an independent provider implementation', () => {
    const ctx = new Context()
    const service = new TestHealthIA(ctx)
    expect(service.listPatients()).resolves.toEqual([])
  })
})
