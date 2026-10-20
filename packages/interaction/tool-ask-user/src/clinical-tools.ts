/**
 * Model-facing clinical longitudinal capability. ASK is the same human
 * interaction service used throughout Phoenix; no separate medical form.
 * @module @phoenix-ai/dsh-tool-ask-user/clinical-tools
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import { defineTool } from '@phoenix-ai/dsh-tools'
import { configuredClinicalLedger, type ClinicalInput } from './clinical-ledger.ts'

/**
 * Register the opt-in clinical timeline tool on the normal tool registry.
 * @param ctx - Root context with the tools and ASK services.
 */
export function registerClinicalLongitudinalTool(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'clinical_longitudinal',
    description: 'Opt-in health history: create a pseudonymous patient identifier, record a dated clinical observation after explicit ASK consent, or read a patient-specific encrypted timeline and comparable laboratory deltas. Use only for explicit health-history requests, never infer patient responses. A secure local key is mandatory for record/timeline. This supports clinicians but does not confirm a diagnosis.',
    parameters: {
      action: { type: 'string', required: true, description: 'One of: create_patient, record, timeline.' },
      patient_id: { type: 'string', description: 'Pseudonymous P- identifier, never a real name.' },
      observed_at: { type: 'string', description: 'Observation date YYYY-MM-DD (record only).' },
      kind: { type: 'string', description: 'symptom, laboratory, imaging, diagnosis, medication, visit (record only).' },
      description: { type: 'string', description: 'Clinical fact exactly attributed to its source (record only).' },
      source: { type: 'string', description: 'patient-reported, document-extracted, clinician-verified (record only).' },
      analyte: { type: 'string', description: 'Optional analyte code, such as HGB, no inferred units.' },
      value: { type: 'number', description: 'Optional numeric lab result.' },
      unit: { type: 'string', description: 'Unit exactly reported by the laboratory.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    async execute(args, exec) {
      if (args.action === 'create_patient') {
        return { json: JSON.stringify({ patient_id: 'P-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase() }) }
      }
      if (args.action !== 'record' && args.action !== 'timeline') {
        throw new Error('CLINICAL_ACTION_INVALID: use create_patient, record or timeline')
      }
      if (args.patient_id === undefined) throw new Error('CLINICAL_PATIENT_ID_REQUIRED')
      const ledger = configuredClinicalLedger()
      const answer = await ctx.userQuestions.ask({
        questions: [{
          id: 'clinical-vault-authorization',
          header: 'Privacidad clínica',
          question: args.action === 'record'
            ? '¿Autorizas guardar esta observación en el expediente clínico cifrado del identificador ' + args.patient_id + '?'
            : '¿Autorizas consultar el expediente clínico cifrado del identificador ' + args.patient_id + '?',
          options: [{ label: 'Sí, autorizo' }, { label: 'No, cancelar' }],
          sensitive: true,
        }],
        ...(exec.agent === undefined ? {} : { agent: exec.agent }),
        signal: exec.signal,
      })
      if (answer.automatic === true ||
          answer.answers.find(item => item.id === 'clinical-vault-authorization')?.selected[0] !== 'Sí, autorizo') {
        return { json: JSON.stringify({ status: 'NOT_AUTHORIZED', saved: false }) }
      }
      if (args.action === 'timeline') {
        const timeline = await ledger.timeline(args.patient_id)
        return { json: JSON.stringify({ patient_id: args.patient_id, ...timeline, clinical_interpretation: 'Requires clinical review; deltas are not diagnoses.' }) }
      }
      if (args.observed_at === undefined || args.kind === undefined ||
          args.description === undefined || args.source === undefined) {
        throw new Error('CLINICAL_RECORD_INCOMPLETE')
      }
      const input: ClinicalInput = {
        patientId: args.patient_id,
        observedAt: args.observed_at,
        kind: args.kind as ClinicalInput['kind'],
        description: args.description,
        source: args.source as ClinicalInput['source'],
        ...(args.analyte === undefined ? {} : { analyte: args.analyte }),
        ...(args.value === undefined ? {} : { value: args.value }),
        ...(args.unit === undefined ? {} : { unit: args.unit }),
      }
      const saved = await ledger.append(input)
      return { json: JSON.stringify({ status: 'SAVED', patient_id: args.patient_id, event_id: saved.id }) }
    },
  }))
}
