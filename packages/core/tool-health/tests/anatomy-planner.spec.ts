import { describe, expect, it } from 'vitest'
import { ANATOMY_SYSTEMS, planAnatomicalTwin } from '../src/anatomy-planner.ts'
describe('HealthIA universal anatomical planning',()=>{
  it('covers all organ systems without creating a model',()=>{
    const r=planAnatomicalTwin('todo el cuerpo','TC')
    expect(r.scope).toHaveLength(Object.keys(ANATOMY_SYSTEMS).length)
    expect(r.modelCreated).toBe(false)
    expect(r.patientDataAccessed).toBe(false)
  })
  it('recognizes Spanish anatomy and volume imaging',()=>{
    const r=planAnatomicalTwin('cerebro','resonancia magnética')
    expect(r.scope.some(s=>s.system==='nervous')).toBe(true)
    expect(r.geometryAssessment).toContain('reconstruction-candidate')
  })
  it('makes high-resolution evidence-aware image the default for every organ system',()=>{
    for(const [region,study] of [['corazón','ECG'],['riñones','TAC'],['cerebro','resonancia magnética'],['todo el cuerpo','TC']]){
      const x=planAnatomicalTwin(region,study)
      expect(x.visualOutput.preferredMedium).toBe('image')
      expect(x.visualOutput.generator).toBe('image_generation')
      expect(x.visualOutput.backend).toBe('auto')
      expect(x.visualOutput.ready).toBe(true)
      expect(x.visualOutput.patientSpecific).toBe(false)
      expect(x.visualOutput.prompt).toContain('alta resolución')
      expect(x.modelCreated).toBe(false)
    }
    const missing=planAnatomicalTwin('órgano no identificado','')
    expect(missing.visualOutput.ready).toBe(false)
    expect(missing.visualOutput.prompt).toBeNull()
  })
  it('does not invent coronary lesions from ECG',()=>{
    const r=planAnatomicalTwin('corazón','EKG inferior')
    expect(r.geometryAssessment).toBe('reference-anatomy-only')
    expect(r.limitations.join(' ')).toContain('ECG')
  })
  it('does not confuse 2D radiography with patient-specific volumetric geometry',()=>{
    const r=planAnatomicalTwin('tórax','radiografía de tórax')
    expect(r.geometryAssessment).toBe('reference-anatomy-only')
  })
})
