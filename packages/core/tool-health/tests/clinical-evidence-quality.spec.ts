import { describe, expect, it } from 'vitest'
import { auditClinicalEvidenceDraft } from '../src/clinical-evidence-quality.ts'

const domains = ['rhythm','rate','axis','intervals','qrs-morphology','repolarization','lead-distribution'] as const
const examined = domains.map(domain => ({
  domain, status:'assessed', evidence: 'Source-grounded observations for ' + domain,
}))
const base = {
  modality:'ecg', sourceKind:'image', sourceReviewed:true,
  sourceQuality:'adequate', calibration:'verified',
  domains:examined, impression:'A provisional independent clinical interpretation',
  claim:'provisional', urgencyReviewed:true,
  differentials:['Conduction abnormality', 'Other interpretation requiring clinical correlation'],
}

describe('medical image diagnostic evidence quality', () => {
  it('blocks a reassuring conclusion from a limited 500x260 screenshot', () => {
    const result = auditClinicalEvidenceDraft({
      ...base, sourceQuality:'limited', calibration:'unverified',
      imageWidth:500, imageHeight:260, claim:'unremarkable',
      domains:examined.filter(domain => domain.domain !== 'axis'),
    })
    expect(result.decision).toBe('BLOCK_UNSUPPORTED_REASSURANCE')
    expect(result.canIssueFinalDiagnosis).toBe(false)
    expect(result.missingDomains).toContain('axis')
    expect(result.sourceImageDimensions).toEqual([500,260])
  })

  it('never allows exclusion of an acute clinical condition from one image', () => {
    const result = auditClinicalEvidenceDraft({ ...base, claim:'acute-condition-excluded' })
    expect(result.decision).toBe('BLOCK_UNSUPPORTED_REASSURANCE')
    expect(result.canExcludeAcuteDisease).toBe(false)
  })

  it('requires actual image observations, without selecting a disease for the model', () => {
    const result = auditClinicalEvidenceDraft({
      ...base, sourceReviewed:false, domains:[], claim:'provisional',
    })
    expect(result.decision).toBe('BLOCK_UNEXAMINED_SOURCE')
    expect(result.hasObservedEvidence).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/preexcitation|wpw|infarction|myocarditis/i)
  })

  it('refuses source-dependent numeric ECG measurements without verified calibration', () => {
    const result = auditClinicalEvidenceDraft({
      ...base, calibration:'unverified', prMs:120, qrsMs:90,
    })
    expect(result.decision).toBe('BLOCK_UNVERIFIED_MEASUREMENT')
    expect(result.acceptedMeasuredIntervals).toBe(false)
  })

  it('distinguishes a provisional interpreted draft from a validated diagnosis', () => {
    const result = auditClinicalEvidenceDraft(base)
    expect(result.decision).toBe('DRAFT_READY_FOR_CLINICIAN')
    expect(result.canIssueFinalDiagnosis).toBe(false)
    expect(result.clinicianReviewRequired).toBe(true)
    expect(result.evaluatedDomains).toHaveLength(domains.length)
    expect(result.missingDomains).toHaveLength(0)
  })

  it('supports radiographs and reports without enforcing ECG-specific diagnoses', () => {
    const radiograph = auditClinicalEvidenceDraft({
      modality:'xray',sourceKind:'image',sourceReviewed:true,
      sourceQuality:'adequate',calibration:'not-applicable',
      domains:[
        {domain:'technique',status:'assessed',evidence:'Projection and acquisition reviewed'},
        {domain:'anatomical-findings',status:'assessed',evidence:'Evidence observed'},
        {domain:'distribution',status:'assessed',evidence:'Region documented'},
        {domain:'limitations',status:'assessed',evidence:'Limitations documented'},
      ], claim:'provisional', urgencyReviewed:true,
      impression:'Source-grounded preliminary differential',
    })
    const report = auditClinicalEvidenceDraft({
      modality:'report',sourceKind:'report',sourceReviewed:true,sourceQuality:'adequate',
      calibration:'not-applicable', domains:[
        {domain:'readable-text',status:'assessed',evidence:'Text transcribed'},
        {domain:'reported-impression',status:'assessed',evidence:'Clearly attributed to the report'},
        {domain:'limitations',status:'assessed',evidence:'Page completeness checked'},
      ],claim:'provisional',urgencyReviewed:true,impression:'Document-derived impression',
    })
    expect(radiograph.decision).toBe('DRAFT_READY_FOR_CLINICIAN')
    expect(report.decision).toBe('DRAFT_READY_FOR_CLINICIAN')
  })

  it('flags explicitly unassessed domains before accepting a complete interpretation', () => {
    const result = auditClinicalEvidenceDraft({
      ...base, domains:[...examined.slice(0,6),
        {domain:'lead-distribution',status:'not-assessable',evidence:''}],
    })
    expect(result.decision).toBe('NEEDS_EVIDENCE_COMPLETION')
    expect(result.missingDomains).toContain('lead-distribution')
  })
})
