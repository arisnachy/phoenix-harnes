import { describe, expect, it } from 'vitest'
import { localInterviewPlan } from '../src/health-interview.ts'

describe('protected local interview guide', () => {
  it.each([
    { complaint: 'migraña', specialty: 'Medicina familiar', pathway: 'headache' },
    { complaint: 'CEFÁLEA', specialty: 'Medicina familiar', pathway: 'headache' },
    { complaint: 'dolor abdominal', specialty: 'Medicina familiar', pathway: 'abdominal' },
    { complaint: 'ansiedad', specialty: 'Medicina familiar', pathway: 'mental-health' },
    { complaint: 'tos', specialty: 'Neumología', pathway: 'respiratory' },
    { complaint: 'dolor en el pecho', specialty: 'Medicina familiar', pathway: 'cardiovascular' },
    { complaint: 'disuria', specialty: 'Medicina familiar', pathway: 'urinary' },
    { complaint: 'traumatismo', specialty: 'Medicina familiar', pathway: 'musculoskeletal' },
    { complaint: 'fiebre infantil', specialty: 'Pediatría', pathway: 'pediatric' },
    { complaint: 'embarazo', specialty: 'Obstetricia', pathway: 'obstetric' },
    { complaint: 'erupción', specialty: 'Dermatología', pathway: 'dermatology' },
    { complaint: 'diabetes', specialty: 'Endocrinología', pathway: 'metabolic' },
    { complaint: 'hipoacusia', specialty: 'Otorrinolaringología', pathway: 'ent' },
    { complaint: 'consulta preventiva', specialty: 'Medicina familiar', pathway: 'general' },
  ])('chooses non-diagnostic $pathway guidance for $complaint', ({ complaint, specialty, pathway }) => {
    const plan = localInterviewPlan(complaint, specialty, 'mixed', [])
    expect(plan.pathway).toBe(pathway)
    expect(plan.mode).toBe('mixed')
    expect(plan.patientDataPersisted).toBe(false)
    expect(plan.requiresClinicianAssessment).toBe(true)
    expect(plan.emergencyScreeningRequired).toBe(true)
    expect(plan.nextQuestions.length).toBeLessThanOrEqual(4)
    expect(plan.guidance).toContain('no diagnóstico')
  })

  it('never repeats completed questions or sends a clinical narrative', () => {
    const answered = ['location', 'digestive', 'abdominal_alarm', 'onset']
    const plan = localInterviewPlan('dolor abdominal', 'Medicina familiar', 'professional', answered)
    expect(plan.nextQuestions.map(question => question.key))
      .toEqual(['severity', 'associated', 'alarm', 'background'])
    expect(JSON.stringify(plan)).not.toContain('dolor abdominal')
    expect(plan.patientDataPersisted).toBe(false)
  })

  it('returns no further questions when all identifiers are already answered', () => {
    const answered = ['location', 'digestive', 'abdominal_alarm', 'onset', 'severity', 'associated', 'alarm', 'background']
    expect(localInterviewPlan('dolor abdominal', 'Medicina familiar', 'kira', answered).nextQuestions).toEqual([])
  })

  it('rejects an unsupported interview mode rather than bypassing clinician safeguards', () => {
    const untrustedMode: unknown = 'autonomous'
    expect(() => localInterviewPlan(
      'consulta preventiva', 'Medicina familiar',
      untrustedMode as Parameters<typeof localInterviewPlan>[2], [],
    )).toThrow(/Modo inválido/)
  })

  it('rejects missing, oversized and malformed input before proposing questions', () => {
    expect(() => localInterviewPlan(' ', 'Medicina familiar', 'mixed', [])).toThrow(/Motivo/)
    expect(() => localInterviewPlan('Consulta', ' ', 'mixed', [])).toThrow(/Especialidad/)
    expect(() => localInterviewPlan('x'.repeat(501), 'Medicina familiar', 'mixed', [])).toThrow(/Motivo/)
    expect(() => localInterviewPlan('Consulta', 'Medicina familiar', 'mixed', ['invalid-key'])).toThrow(/Preguntas/)
    expect(() => localInterviewPlan('Consulta', 'Medicina familiar', 'mixed', Array(51).fill('onset'))).toThrow(/Preguntas/)
  })
})
