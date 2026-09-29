import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HealthPatientId,
  type HealthPatientSnapshot,
} from '@phoenix-ai/dsh-healthia'
import LocalHealthiaService, { DEFAULT_HEALTHIA_KEY_REF } from '../src/index.ts'

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map(dispose => dispose()))
})

function credentialStub(secrets: Map<string, string>) {
  return {
    async resolve(ref: string) {
      const value = secrets.get(ref)
      return value === undefined ? undefined : { value, source: 'test' }
    },
    async describe(ref: string) {
      return { configured: secrets.has(ref), source: secrets.has(ref) ? 'test' : undefined, writable: true }
    },
    async set(ref: string, value: string) {
      secrets.set(ref, value)
    },
    async unset(ref: string) {
      secrets.delete(ref)
    },
  }
}

async function runtime(options: {
  dir?: string
  secrets?: Map<string, string>
} = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'phoenix-healthia-'))
  const path = join(dir, 'healthia.enc.json')
  const secrets = options.secrets ?? new Map<string, string>()
  const root = new Context()
  root.provide('credentials', credentialStub(secrets) as never)
  const fiber = await root.plugin(LocalHealthiaService, { path })
  cleanup.push(async () => {
    await fiber.dispose()
    if (options.dir === undefined) await rm(dir, { recursive: true, force: true })
  })
  return { root, dir, path, secrets }
}

describe('encrypted local HealthIA record', () => {
  it('persists patient-scoped facts encrypted instead of treating chat as the medical record', async () => {
    const { root, path, secrets } = await runtime()
    const patient = await root.healthia.createPatient({
      id: 'patient-alfa',
      displayName: 'Paciente Alfa',
      birthDate: '1980-01-02',
      sexAtBirth: 'male',
    })
    await root.healthia.addRecord({
      patientId: patient.id,
      category: 'vital',
      display: 'Blood pressure',
      effectiveAt: '2026-09-28T20:00:00-04:00',
      value: { systolic: 151, diastolic: 94 },
      unit: 'mmHg',
      provenance: { sourceKind: 'device', sourceId: 'bp-cuff-test', confidence: 0.99 },
    })

    const snapshot = await root.healthia.snapshot(patient.id)
    expect(snapshot).toMatchObject({
      patient: { id: 'patient-alfa', displayName: 'Paciente Alfa' },
      records: [{
        patientId: 'patient-alfa',
        category: 'vital',
        display: 'Blood pressure',
        value: { systolic: 151, diastolic: 94 },
        unit: 'mmHg',
        provenance: { sourceKind: 'device', sourceId: 'bp-cuff-test', confidence: 0.99 },
      }],
    })

    const persisted = await readFile(path, 'utf8')
    expect(persisted).toContain('"algorithm": "aes-256-gcm"')
    expect(persisted).not.toContain('Paciente Alfa')
    expect(persisted).not.toContain('Blood pressure')
    expect(persisted).not.toContain('151')
    expect(secrets.get(DEFAULT_HEALTHIA_KEY_REF)).toMatch(/\S+/)
  })

  it('keeps different patients isolated even when their observations have the same category', async () => {
    const { root } = await runtime()
    const first = await root.healthia.createPatient({ id: 'patient-one', displayName: 'One' })
    const second = await root.healthia.createPatient({ id: 'patient-two', displayName: 'Two' })

    await Promise.all([
      root.healthia.addRecord({
        patientId: first.id,
        category: 'symptom',
        display: 'Headache',
        value: 'moderate',
        provenance: { sourceKind: 'user' },
      }),
      root.healthia.addRecord({
        patientId: second.id,
        category: 'symptom',
        display: 'Dizziness',
        value: 'mild',
        provenance: { sourceKind: 'user' },
      }),
    ])

    const one = await root.healthia.listRecords(first.id)
    const two = await root.healthia.listRecords(second.id)
    expect(one.map(record => record.display)).toEqual(['Headache'])
    expect(two.map(record => record.display)).toEqual(['Dizziness'])
    expect(one.every(record => record.patientId === first.id)).toBe(true)
    expect(two.every(record => record.patientId === second.id)).toBe(true)
  })

  it('survives a provider restart and reconstructs continuity from canonical encrypted state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'phoenix-healthia-restart-'))
    const secrets = new Map<string, string>()
    cleanup.push(() => rm(dir, { recursive: true, force: true }))

    const firstRuntime = await runtime({ dir, secrets })
    const patient = await firstRuntime.root.healthia.createPatient({ id: 'patient-restart', displayName: 'Restart' })
    const episode = await firstRuntime.root.healthia.openEpisode({
      patientId: patient.id,
      kind: 'headache',
      title: 'Recurrent headache',
      summary: 'User reported a new headache episode.',
    })
    await firstRuntime.root.healthia.addRecord({
      patientId: patient.id,
      category: 'symptom',
      display: 'Headache reported',
      value: { intensity: 6, scale: 10 },
      provenance: { sourceKind: 'user' },
    })

    const secondRoot = new Context()
    secondRoot.provide('credentials', credentialStub(secrets) as never)
    const secondFiber = await secondRoot.plugin(LocalHealthiaService, { path: firstRuntime.path })
    cleanup.push(() => secondFiber.dispose())

    const snapshot: HealthPatientSnapshot = await secondRoot.healthia.snapshot(HealthPatientId('patient-restart'))
    expect(snapshot.patient.displayName).toBe('Restart')
    expect(snapshot.records.map(record => record.display)).toEqual(['Headache reported'])
    expect(snapshot.episodes).toEqual([
      expect.objectContaining({ id: episode.id, kind: 'headache', status: 'open' }),
    ])
  })

  it('serializes concurrent health mutations without silently losing observations', async () => {
    const { root } = await runtime()
    const patient = await root.healthia.createPatient({ id: 'patient-concurrent', displayName: 'Concurrent' })

    await Promise.all(Array.from({ length: 12 }, async (_unused, index) => {
      await root.healthia.addRecord({
        id: `record-concurrent-${String(index)}`,
        patientId: patient.id,
        category: 'vital',
        display: `Reading ${String(index)}`,
        value: index,
        provenance: { sourceKind: 'device', sourceId: 'test-device' },
      })
    }))

    const records = await root.healthia.listRecords(patient.id, { limit: 100 })
    expect(records).toHaveLength(12)
    expect(new Set(records.map(record => record.id)).size).toBe(12)
  })

  it('rejects cross-profile references and non-finite clinical values as domain failures', async () => {
    const { root } = await runtime()
    await expect(root.healthia.addRecord({
      patientId: 'missing-patient',
      category: 'lab',
      display: 'Impossible lab',
      value: Number.NaN,
      provenance: { sourceKind: 'user' },
    })).rejects.toThrow(/non-finite/i)

    await expect(root.healthia.addRecord({
      patientId: 'missing-patient',
      category: 'symptom',
      display: 'Unknown patient symptom',
      provenance: { sourceKind: 'user' },
    })).rejects.toThrow(/unknown patient/i)
  })
})
