/**
 * On-demand HealthIA activation and patient-scoped model tools.
 *
 * Only `healthia_activate` is global. The larger clinical surface is mounted
 * into the calling Agent's scope after health context appears, preserving the
 * ordinary PHOENIX request shape outside health work.
 * @module @phoenix-ai/dsh-tool-healthia
 */

import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import {
  HealthEpisodeId,
  HealthPatientId,
  HealthiaError,
} from '@phoenix-ai/dsh-healthia'
import type {
  HealthJson,
  HealthRecordCategory,
  HealthiaService,
} from '@phoenix-ai/dsh-healthia'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type { GenericCallView, JsonValue } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-system-prompt'

/** Cordis plugin identity. */
export const name = 'tool-healthia'
/** Activation needs the shared registry, health service, and scoped prompt surface. */
export const inject = ['tools', 'healthia', 'systemPrompt']

const HEALTH_CATEGORIES = [
  'symptom', 'vital', 'lab', 'condition', 'medication', 'allergy', 'procedure',
  'immunization', 'imaging', 'device', 'nutrition', 'activity', 'sleep',
  'mental-health', 'social', 'appointment', 'document', 'goal', 'care-plan', 'other',
] as const satisfies readonly HealthRecordCategory[]

const SOURCE_KINDS = ['user', 'device', 'document', 'clinician', 'connector', 'system'] as const

function toJson(value: unknown): JsonValue {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new HealthiaError('HealthIA tool output was not JSON-serializable', 'HEALTHIA_OUTPUT_INVALID')
  return JSON.parse(encoded) as JsonValue
}

const HEALTHIA_ACTIVATE_DESCRIPTION =
  'Activate HealthIA ONLY when the user is requesting personal patient care, longitudinal follow-up, '
  + 'or explicit patient profile/record management. Do NOT activate solely because an academic request, '
  + 'simulated or fictional case, clinical exam, evidence review, medical literature search, pharmacology '
  + 'comparison, guideline analysis, or public-health research mentions a disease, symptoms, labs or doses. '
  + 'Research is handled by ordinary PHOENIX/Research APEX without opening patient records. '
  + 'Never infer patient identity from a vignette; the user must explicitly request record-related work.'

const CLINICAL_GUIDANCE = `HealthIA is active for this agent. PHOENIX remains the same general assistant; this is an additional
clinical capability, not a new persona or UI.

For health work:
- A HealthIA conversational profile is NOT a professional medical record in the separate /health clinical web app.
  Never claim creating a chat profile also created a patient, prescription, consultation, or appointment in /health.
- For purely educational or fictional cases and evidence research, do not activate patient tools, read profiles, or open patient workspace UI.
- healthia_activate changes tool availability only. It does not request or show the patient directory.
- health_patient_list is a background identity-metadata read and must not show a patient-management UI.
- Only health_patient_workspace deliberately requests an interactive patient-management UI, and only after an explicit user request to browse, create or manage profiles.
- A patient profile is created ONLY after a successful health_patient_create tool response returns the new patient ID.
  Never confirm creation from the user's "sí" alone, activation, or memory. If the create tool did not
  execute or fails, say so clearly and do not invent an ID.
- HealthIA smart cards appear automatically from successful first-party tool receipts;
  do not claim a clinical card was displayed without one.
- Establish which patient the information belongs to before writing anything. Never mix people. If identity is
  ambiguous, list known health profiles or ask the smallest necessary clarification.
- The longitudinal HealthIA record, not chat history, is the clinical source of truth. Read a patient snapshot
  before substantive longitudinal reasoning when a patient is known.
- Conduct adaptive clinical interviewing: ask the next question that most changes urgency or the differential,
  rather than dumping a fixed questionnaire. Screen time-sensitive red flags early.
- Persist only facts supplied by the user or verified tools/documents/devices/clinicians, with honest provenance.
  Never record a model hypothesis, diagnosis, causal claim, or literature conclusion as if it were a patient fact.
- Separate patient facts, clinical inference, external evidence, uncertainty, and missing information.
- Use PHOENIX's available web/evidence, calculator, multimodal, file, map, browser, scheduling, connector, and
  tool-building capabilities when they materially improve the answer. Prefer current guidelines and high-quality
  evidence for treatment comparisons; check whether study populations actually apply to this patient.
- Compare new observations with the patient's prior values and personal baseline when possible. Look for trends,
  temporally related medication/symptom changes, care gaps, adherence barriers, and social/community needs without
  turning correlation into causation.
- HealthIA may help prepare diet, exercise, prevention, monitoring, appointment, community-resource, benefits, and
  form workflows tailored to the patient. It may create trackers/tools through PHOENIX when repeated structured data
  would answer an important clinical question.
- Do not autonomously start, stop, prescribe, or change prescription medication, or claim a definitive diagnosis
  solely from model inference. Support decision-making and clinician review. When available data indicate a possible
  emergency, prioritize urgent real-world evaluation over a prolonged interview.
- Keep useful continuity: open/update a clinical episode for an active complaint or follow-up and add new verified
  observations as they become available.`

const JSON_OBJECT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: true,
  } as const,
  render: (_args: unknown, value: Record<string, unknown>) => [{
    type: 'text' as const,
    text: JSON.stringify(value),
  }],
}

function present(title: string, kind: 'read' | 'execute' | 'other' = 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

function requireAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) {
    throw new HealthiaError('HealthIA activation requires a live PHOENIX agent', 'HEALTHIA_AGENT_REQUIRED')
  }
  return agent
}

function optionalDateRange(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed
}

function selectedValue(args: {
  numeric_value?: number
  text_value?: string
  json_value?: Record<string, HealthJson>
}): HealthJson | undefined {
  const candidates: HealthJson[] = []
  if (args.numeric_value !== undefined) candidates.push(args.numeric_value)
  if (args.text_value !== undefined && args.text_value !== '') candidates.push(args.text_value)
  if (args.json_value !== undefined) candidates.push(args.json_value)
  if (candidates.length > 1) {
    throw new HealthiaError(
      'Provide at most one of numeric_value, text_value, or json_value',
      'HEALTHIA_INVALID_INPUT',
    )
  }
  return candidates[0]
}

function installHealthiaScope(agentCtx: Context, healthia: HealthiaService): () => void {
  const disposers: Array<() => void> = []
  const register = (definition: Parameters<typeof agentCtx.tools.register>[0]): void => {
    disposers.push(agentCtx.tools.register(definition))
  }

  try {
    disposers.push(agentCtx.systemPrompt.section({
      name: 'healthia:clinical',
      order: 118,
      text: CLINICAL_GUIDANCE,
    }))

    register(defineTool({
      name: 'health_patient_list',
      description: 'List HealthIA patient profiles. Use this when the person being discussed is ambiguous; this returns identity metadata only, not clinical records.',
      parameters: {},
      output: JSON_OBJECT_OUTPUT,
      async execute() {
        return { patients: toJson([...await healthia.listPatients()]) }
      },
      presentCall: () => present('List health profiles', 'read'),
    }))

    register(defineTool({
      name: 'health_patient_workspace',
      description: 'Show the interactive HealthIA patient management workspace ONLY when the user explicitly asks to browse, open, create, or manage patient profiles. Never use for academic clinical cases, simulated patients, research, diagnosis explanations or guideline reviews.',
      parameters: {},
      output: JSON_OBJECT_OUTPUT,
      async execute() {
        return { workspace: 'patient_management', patients: toJson([...await healthia.listPatients()]) }
      },
      presentCall: () => present('Open health patient workspace', 'read'),
    }))

    register(defineTool({
      name: 'health_patient_create',
      description: 'Create a new isolated HealthIA patient profile after the user has identified the person. Do not create duplicate profiles merely because a new health episode starts.',
      parameters: {
        display_name: { type: 'string', required: true, description: 'Human-readable patient name or label.' },
        birth_date: { type: 'string', description: 'Optional YYYY-MM-DD birth date.' },
        sex_at_birth: { type: 'string', enum: ['female', 'male', 'intersex', 'unknown'] as const },
        gender_identity: { type: 'string' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          patient: toJson(await healthia.createPatient({
            displayName: args.display_name,
            ...(args.birth_date === undefined || args.birth_date === '' ? {} : { birthDate: args.birth_date }),
            ...(args.sex_at_birth === undefined ? {} : { sexAtBirth: args.sex_at_birth }),
            ...(args.gender_identity === undefined || args.gender_identity === '' ? {} : { genderIdentity: args.gender_identity }),
          })),
        }
      },
      presentCall: args => present('Create health profile', 'execute', { display_name: args.display_name }),
    }))

    register(defineTool({
      name: 'health_patient_update',
      description: 'Update demographic metadata for one existing HealthIA patient. Use empty strings only when a field should remain unchanged; do not infer sex, birth date, or identity.',
      parameters: {
        patient_id: { type: 'string', required: true },
        display_name: { type: 'string' },
        birth_date: { type: 'string' },
        sex_at_birth: { type: 'string', enum: ['female', 'male', 'intersex', 'unknown'] as const },
        gender_identity: { type: 'string' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          patient: toJson(await healthia.updatePatient(HealthPatientId(args.patient_id), {
            ...(args.display_name === undefined || args.display_name === '' ? {} : { displayName: args.display_name }),
            ...(args.birth_date === undefined || args.birth_date === '' ? {} : { birthDate: args.birth_date }),
            ...(args.sex_at_birth === undefined ? {} : { sexAtBirth: args.sex_at_birth }),
            ...(args.gender_identity === undefined || args.gender_identity === '' ? {} : { genderIdentity: args.gender_identity }),
          })),
        }
      },
      presentCall: args => present('Update health profile', 'execute', { patient_id: args.patient_id }),
    }))

    register(defineTool({
      name: 'health_patient_snapshot',
      description: 'Read a bounded longitudinal snapshot for one patient: demographics, newest canonical health facts, and recent clinical episodes. Call before longitudinal clinical reasoning.',
      parameters: {
        patient_id: { type: 'string', required: true },
        record_limit: { type: 'integer', description: 'Optional 1..500 bound; invalid values are rejected by HealthIA.' },
        episode_limit: { type: 'integer', description: 'Optional 1..100 bound; invalid values are rejected by HealthIA.' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          snapshot: toJson(await healthia.snapshot(HealthPatientId(args.patient_id), {
            ...(args.record_limit === undefined ? {} : { recordLimit: args.record_limit }),
            ...(args.episode_limit === undefined ? {} : { episodeLimit: args.episode_limit }),
          })),
        }
      },
      presentCall: args => present('Read patient health snapshot', 'read', { patient_id: args.patient_id }),
    }))

    register(defineTool({
      name: 'health_record_add',
      description: 'Persist one verified patient fact with provenance. Never use this to store a model hypothesis, differential diagnosis, or unverified causal claim as a fact.',
      parameters: {
        patient_id: { type: 'string', required: true },
        category: { type: 'string', required: true, enum: HEALTH_CATEGORIES },
        display: { type: 'string', required: true, description: 'Concise factual label, e.g. "Blood pressure" or "Headache reported".' },
        effective_at: { type: 'string', description: 'When the fact applied, preferably ISO 8601.' },
        code: { type: 'string', description: 'Optional clinical/device code when actually known.' },
        numeric_value: { type: 'number' },
        text_value: { type: 'string' },
        json_value: { type: 'object', additionalProperties: true },
        unit: { type: 'string' },
        notes: { type: 'string' },
        source_kind: { type: 'string', required: true, enum: SOURCE_KINDS },
        source_id: { type: 'string' },
        source_ref: { type: 'string' },
        confidence: { type: 'number', description: 'Optional provenance confidence from 0 to 1; invalid values are rejected.' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          record: toJson(await healthia.addRecord({
            patientId: args.patient_id,
            category: args.category,
            display: args.display,
            ...(args.effective_at === undefined || args.effective_at === '' ? {} : { effectiveAt: args.effective_at }),
            ...(args.code === undefined || args.code === '' ? {} : { code: args.code }),
            ...(selectedValue(args) === undefined ? {} : { value: selectedValue(args)! }),
            ...(args.unit === undefined || args.unit === '' ? {} : { unit: args.unit }),
            ...(args.notes === undefined || args.notes === '' ? {} : { notes: args.notes }),
            provenance: {
              sourceKind: args.source_kind,
              ...(args.source_id === undefined || args.source_id === '' ? {} : { sourceId: args.source_id }),
              ...(args.source_ref === undefined || args.source_ref === '' ? {} : { sourceRef: args.source_ref }),
              ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
            },
          })),
        }
      },
      presentCall: args => present('Record patient health fact', 'execute', {
        patient_id: args.patient_id,
        category: args.category,
        display: args.display,
      }),
    }))

    register(defineTool({
      name: 'health_records_query',
      description: 'Query canonical records for exactly one patient, optionally by category and date range. Results are newest first.',
      parameters: {
        patient_id: { type: 'string', required: true },
        categories: { type: 'array', items: { type: 'string', enum: HEALTH_CATEGORIES } },
        since: { type: 'string' },
        until: { type: 'string' },
        limit: { type: 'integer', description: 'Optional 1..1000 result limit; invalid values are rejected by HealthIA.' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          records: toJson([...await healthia.listRecords(HealthPatientId(args.patient_id), {
            ...(args.categories === undefined ? {} : { categories: args.categories }),
            ...(optionalDateRange(args.since) === undefined ? {} : { since: optionalDateRange(args.since)! }),
            ...(optionalDateRange(args.until) === undefined ? {} : { until: optionalDateRange(args.until)! }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          })]),
        }
      },
      presentCall: args => present('Query patient health history', 'read', { patient_id: args.patient_id }),
    }))

    register(defineTool({
      name: 'health_episode_open',
      description: 'Open a longitudinal episode for an active symptom, clinical question, monitoring course, or care follow-up so later observations can be interpreted in context.',
      parameters: {
        patient_id: { type: 'string', required: true },
        kind: { type: 'string', required: true },
        title: { type: 'string', required: true },
        opened_at: { type: 'string' },
        summary: { type: 'string' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          episode: toJson(await healthia.openEpisode({
            patientId: args.patient_id,
            kind: args.kind,
            title: args.title,
            ...(args.opened_at === undefined || args.opened_at === '' ? {} : { openedAt: args.opened_at }),
            ...(args.summary === undefined || args.summary === '' ? {} : { summary: args.summary }),
          })),
        }
      },
      presentCall: args => present('Open health episode', 'execute', { patient_id: args.patient_id, title: args.title }),
    }))

    register(defineTool({
      name: 'health_episode_update',
      description: 'Update the status or factual summary of an existing longitudinal episode. Do not turn an unverified model inference into a factual episode summary.',
      parameters: {
        episode_id: { type: 'string', required: true },
        status: { type: 'string', enum: ['open', 'resolved', 'cancelled'] as const },
        summary: { type: 'string' },
      },
      output: JSON_OBJECT_OUTPUT,
      async execute(args) {
        return {
          episode: toJson(await healthia.updateEpisode(HealthEpisodeId(args.episode_id), {
            ...(args.status === undefined ? {} : { status: args.status }),
            ...(args.summary === undefined || args.summary === '' ? {} : { summary: args.summary }),
          })),
        }
      },
      presentCall: args => present('Update health episode', 'execute', { episode_id: args.episode_id }),
    }))
  } catch (error) {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try { disposers[index]?.() } catch { /* best-effort rollback */ }
    }
    throw error
  }

  return () => {
    const failures: unknown[] = []
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try { disposers[index]?.() } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to unload HealthIA agent scope')
  }
}

/** Register the tiny global activator; full clinical tools remain agent-scoped. */
export function apply(ctx: Context): void {
  const activeAgents = new WeakSet<Agent>()

  ctx.systemPrompt.section({
    name: 'healthia:activation',
    order: 117,
    text: 'Call healthia_activate ONLY for explicitly requested personal patient care, longitudinal follow-up, or patient record management. Do not activate for simulated cases, medical exams, general clinical questions, guidelines, or academic research; use APEX research directly without patient lists or a registration UI.',
  })

  ctx.tools.register(defineTool({
    name: 'healthia_activate',
    description: HEALTHIA_ACTIVATE_DESCRIPTION,
    parameters: {},
    output: JSON_OBJECT_OUTPUT,
    async execute(_args, exec) {
      const agent = requireAgent(exec.agent)
      const alreadyActive = activeAgents.has(agent)
      if (!alreadyActive) {
        activeAgents.add(agent)
        try {
          agent.ctx.effect(() => installHealthiaScope(agent.ctx, ctx.healthia), 'HealthIA clinical scope')
        } catch (error) {
          activeAgents.delete(agent)
          throw error
        }
      }
      return {
        active: true,
        alreadyActive,
        instruction: 'HealthIA clinical tools are available. No patient directory was opened. Call health_patient_workspace only when the user explicitly requests profile management; use health_patient_list for internal disambiguation without showing a registration form.',
      }
    },
    presentCall: () => present('Activate HealthIA', 'other'),
  }))
}

/** Plugin entry for on-demand HealthIA model capabilities. */
export default { name, inject, apply }
