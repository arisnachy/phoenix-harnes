import { describe, expect, it } from 'vitest'
import { advanceEncounter, openEncounter, planInterview, planKiraMail } from '../src/clinical-flow.ts'

describe('PHOENIX Health clinical boundaries', () => {
  it('adapts generic questions without persisting a patient', () => {
    const result = planInterview('dolor abdominal', 'medicina familiar', 'mixed', ['location'])
    expect(result.pathway).toBe('abdominal')
    expect(result.patientDataPersisted).toBe(false)
    expect(result.requiresClinicianAssessment).toBe(true)
    expect(result.nextQuestions.some(question => question.key === 'location')).toBe(false)
  })

  it('rejects non-clinician signing and requires a reviewed revision', () => {
    let encounter = openEncounter('TEST-EPISODE')
    encounter = advanceEncounter(encounter, { action: 'record-interview', actorRole: 'assistant', actorRef: 'kira' })
    encounter = advanceEncounter(encounter, { action: 'draft-history', actorRole: 'assistant', actorRef: 'kira' })
    expect(() => advanceEncounter(encounter, { action: 'sign-history', actorRole: 'clinician', actorRef: 'medic' }))
      .toThrow()
    encounter = advanceEncounter(encounter, { action: 'review-history', actorRole: 'clinician', actorRef: 'medic' })
    expect(() => advanceEncounter(encounter, { action: 'sign-history', actorRole: 'assistant', actorRef: 'kira' }))
      .toThrow()
    encounter = advanceEncounter(encounter, { action: 'sign-history', actorRole: 'clinician', actorRef: 'medic' })
    expect(encounter.signedBy).toBe('medic')
  })

  it('never treats missing email safety evidence as send authorization', () => {
    const result = planKiraMail({
      senderConnected: false, senderVerified: false, recipientVerified: false,
      patientConsent: false, clinicianSigned: false, clinicianAuthorizedSend: false,
      securePortalReady: false, idempotencyKeyPresent: false,
    })
    expect(result.approvedForQueue).toBe(false)
    expect(result.sendsNow).toBe(false)
    expect(result.blockers.length).toBe(8)
  })
})
