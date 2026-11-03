import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { HealthEpisodeId, HealthPatientId, HealthRecordId } from '@phoenix-ai/dsh-healthia'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

function healthiaStub() {
  const patients: Array<Record<string, unknown>> = []
  const records: Array<Record<string, unknown>> = []
  const episodes: Array<Record<string, unknown>> = []
  let patientSeq = 0
  let recordSeq = 0
  let episodeSeq = 0

  return {
    async listPatients() { return patients },
    async getPatient(id: string) { return patients.find(patient => patient.id === id) },
    async createPatient(input: Record<string, unknown>) {
      const timestamp = '2026-09-29T00:00:00.000Z'
      const patient = {
        id: HealthPatientId(String(input.id ?? `patient-${String(++patientSeq)}`)),
        displayName: input.displayName,
        ...(input.birthDate === undefined ? {} : { birthDate: input.birthDate }),
        ...(input.sexAtBirth === undefined ? {} : { sexAtBirth: input.sexAtBirth }),
        ...(input.genderIdentity === undefined ? {} : { genderIdentity: input.genderIdentity }),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      patients.push(patient)
      return patient
    },
    async updatePatient(id: string, input: Record<string, unknown>) {
      const patient = patients.find(candidate => candidate.id === id)
      if (patient === undefined) throw new Error('missing patient')
      Object.assign(patient, input, { updatedAt: '2026-09-29T00:01:00.000Z' })
      return patient
    },
    async addRecord(input: Record<string, unknown>) {
      const record = {
        id: HealthRecordId(`record-${String(++recordSeq)}`),
        ...input,
        patientId: HealthPatientId(String(input.patientId)),
        recordedAt: '2026-09-29T00:02:00.000Z',
        provenance: {
          ...(input.provenance as Record<string, unknown>),
          recordedAt: '2026-09-29T00:02:00.000Z',
        },
      }
      records.push(record)
      return record
    },
    async listRecords(id: string) {
      return records.filter(record => record.patientId === id)
    },
    async openEpisode(input: Record<string, unknown>) {
      const episode = {
        id: HealthEpisodeId(`episode-${String(++episodeSeq)}`),
        ...input,
        patientId: HealthPatientId(String(input.patientId)),
        status: 'open' as const,
        openedAt: '2026-09-29T00:03:00.000Z',
        updatedAt: '2026-09-29T00:03:00.000Z',
      }
      episodes.push(episode)
      return episode
    },
    async updateEpisode(id: string, input: Record<string, unknown>) {
      const episode = episodes.find(candidate => candidate.id === id)
      if (episode === undefined) throw new Error('missing episode')
      Object.assign(episode, input, { updatedAt: '2026-09-29T00:04:00.000Z' })
      return episode
    },
    async snapshot(id: string) {
      const patient = patients.find(candidate => candidate.id === id)
      if (patient === undefined) throw new Error('missing patient')
      return {
        patient,
        records: records.filter(record => record.patientId === id),
        episodes: episodes.filter(episode => episode.patientId === id),
        generatedAt: '2026-09-29T00:05:00.000Z',
      }
    },
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {
    includeHarnessIdentity: false,
    includeRuntimeContext: false,
    persona: '',
  })
  await ctx.plugin(ToolRuntime, {})
  const healthia = healthiaStub()
  ctx.provide('healthia', healthia as never)
  apply(ctx)
  const agent = { ctx } as Agent
  return { ctx, healthia, agent }
}

describe('on-demand HealthIA tools', () => {
  it('keeps the global surface tiny until a health conversation activates it', async () => {
    const { ctx, agent } = await setup()
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['healthia_activate'])

    const initialPrompt = await ctx.systemPrompt.assemble()
    expect(initialPrompt.sections.find(section => section.name === 'healthia:activation')?.text)
      .toContain('call healthia_activate before substantive clinical reasoning')
    expect(initialPrompt.sections.map(section => section.name)).not.toContain('healthia:clinical')

    const activated = await ctx.tools.get('healthia_activate')!.execute({}, { agent } as never) as {
      active: boolean
      alreadyActive: boolean
    }
    expect(activated).toMatchObject({ active: true, alreadyActive: false })

    const names = ctx.tools.schemas().map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'healthia_activate',
      'health_patient_list',
      'health_patient_create',
      'health_patient_update',
      'health_patient_snapshot',
      'health_record_add',
      'health_records_query',
      'health_episode_open',
      'health_episode_update',
    ]))

    const activePrompt = await ctx.systemPrompt.assemble()
    expect(activePrompt.sections.find(section => section.name === 'healthia:clinical')?.text)
      .toContain('The longitudinal HealthIA record, not chat history, is the clinical source of truth')

    const second = await ctx.tools.get('healthia_activate')!.execute({}, { agent } as never) as {
      alreadyActive: boolean
    }
    expect(second.alreadyActive).toBe(true)
  })

  it('creates a patient, records a verified observation, and reconstructs a longitudinal snapshot', async () => {
    const { ctx, agent } = await setup()
    await ctx.tools.get('healthia_activate')!.execute({}, { agent } as never)

    const created = await ctx.tools.get('health_patient_create')!.execute({
      display_name: 'Paciente Uno',
      birth_date: '1982-02-20',
      sex_at_birth: 'male',
    }, { agent } as never) as { patient: { id: string } }
    const patientId = created.patient.id

    await ctx.tools.get('health_record_add')!.execute({
      patient_id: patientId,
      category: 'vital',
      display: 'Blood pressure',
      numeric_value: 151,
      unit: 'mmHg',
      source_kind: 'device',
      source_id: 'bp-cuff',
      confidence: 0.99,
    }, { agent } as never)

    const opened = await ctx.tools.get('health_episode_open')!.execute({
      patient_id: patientId,
      kind: 'headache',
      title: 'Headache follow-up',
      summary: 'User reported headache.',
    }, { agent } as never) as { episode: { id: string } }

    const snapshot = await ctx.tools.get('health_patient_snapshot')!.execute({
      patient_id: patientId,
    }, { agent } as never) as {
      snapshot: {
        patient: { id: string }
        records: Array<{ display: string }>
        episodes: Array<{ id: string }>
      }
    }

    expect(snapshot.snapshot.patient.id).toBe(patientId)
    expect(snapshot.snapshot.records).toEqual([expect.objectContaining({ display: 'Blood pressure' })])
    expect(snapshot.snapshot.episodes).toEqual([expect.objectContaining({ id: opened.episode.id })])
  })

  it('refuses to encode competing values into one canonical health fact', async () => {
    const { ctx, agent } = await setup()
    await ctx.tools.get('healthia_activate')!.execute({}, { agent } as never)
    const created = await ctx.tools.get('health_patient_create')!.execute({
      display_name: 'Paciente Dos',
    }, { agent } as never) as { patient: { id: string } }

    await expect(ctx.tools.get('health_record_add')!.execute({
      patient_id: created.patient.id,
      category: 'lab',
      display: 'Ambiguous value',
      numeric_value: 1,
      text_value: 'one',
      source_kind: 'user',
    }, { agent } as never)).rejects.toThrow(/at most one of numeric_value/i)
  })
})
