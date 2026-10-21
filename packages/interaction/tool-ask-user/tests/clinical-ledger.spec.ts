import { afterEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClinicalLedger } from '@phoenix-ai/dsh-tool-ask-user/src/clinical-ledger.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })

describe('encrypted clinical longitudinal ledger', () => {
  it('encrypts entries, isolates pseudonyms and computes only comparable lab deltas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-clinical-'))
    roots.push(root)
    const path = join(root, 'private.enc')
    const ledger = new ClinicalLedger(path, randomBytes(32))
    await ledger.append({ patientId: 'P-ABC123', observedAt: '2026-10-01', kind: 'laboratory',
      description: 'Hemoglobina reportada', source: 'document-extracted', analyte: 'HGB', value: 9.2, unit: 'g/dL' })
    await ledger.append({ patientId: 'P-ABC123', observedAt: '2026-10-15', kind: 'laboratory',
      description: 'Segundo hemograma', source: 'document-extracted', analyte: 'HGB', value: 10.5, unit: 'g/dL' })
    await ledger.append({ patientId: 'P-ABC123', observedAt: '2026-10-17', kind: 'laboratory',
      description: 'Unidad no comparable', source: 'patient-reported', analyte: 'HGB', value: 105, unit: 'g/L' })
    await ledger.append({ patientId: 'P-OTHER1', observedAt: '2026-10-17', kind: 'symptom',
      description: 'Otro paciente', source: 'patient-reported' })
    const timeline = await ledger.timeline('P-ABC123')
    expect(timeline.events).toHaveLength(3)
    expect(timeline.trends).toMatchObject([{
      analyte: 'HGB', unit: 'g/dL', firstValue: 9.2, latestValue: 10.5, delta: 1.3000000000000007,
    }])
    expect((await ledger.timeline('P-OTHER1')).events).toHaveLength(1)
    const ciphertext = await readFile(path, 'utf8')
    expect(ciphertext).not.toContain('Hemoglobina reportada')
    expect(ciphertext).not.toContain('Otro paciente')
  })

  it('rejects invalid dates, incomplete numeric observations and wrong keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-clinical-'))
    roots.push(root)
    const path = join(root, 'private.enc')
    const ledger = new ClinicalLedger(path, randomBytes(32))
    const first = { patientId: 'P-ABC123', observedAt: '2026-02-30', kind: 'laboratory' as const,
      description: 'HGB', source: 'patient-reported' as const }
    await expect(ledger.append(first)).rejects.toThrow('CLINICAL_DATE_INVALID')
    await expect(ledger.append({ ...first, observedAt: '2026-10-01', analyte: 'HGB', value: 9.2 }))
      .rejects.toThrow('CLINICAL_MEASUREMENT_REQUIRES_ANALYTE_VALUE_UNIT')
    await ledger.append({ ...first, observedAt: '2026-10-01' })
    await expect(new ClinicalLedger(path, randomBytes(32)).timeline('P-ABC123')).rejects.toThrow()
  })
})
