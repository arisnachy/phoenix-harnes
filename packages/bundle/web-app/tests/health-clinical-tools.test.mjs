import test from 'node:test'
import assert from 'node:assert/strict'
import { HEALTH_CLINICAL_TOOLS, runHealthClinicalTool } from '../src/health-clinical-tools.ts'

test('tools are discoverable, bounded, versioned and explicitly review-only',()=>{
  assert.equal(HEALTH_CLINICAL_TOOLS.length,3)
  for(const tool of HEALTH_CLINICAL_TOOLS){
    assert.match(tool.version,/^\d+\.\d+\.\d+$/u)
    assert(tool.fields.length>0)
    assert.match(tool.notice,/no |sujeta /iu)
  }
  assert.throws(()=>runHealthClinicalTool('arbitrary_script',{}),/no disponible/)
})
test('adult BMI is deterministic, validates kg and cm, and never labels a child',()=>{
  const result=runHealthClinicalTool('bmi_adult',{ageYears:30,weightKg:72,heightCm:168})
  assert.equal(result.output.bmi,25.5)
  assert.equal(result.status,'review-required')
  assert.throws(()=>runHealthClinicalTool('bmi_adult',{ageYears:9,weightKg:24,heightCm:126}),/fuera de los límites/)
  assert.throws(()=>runHealthClinicalTool('bmi_adult',{ageYears:30,weightKg:72,heightCm:168,patientId:'private'}),/no autorizados/)
  assert.throws(()=>runHealthClinicalTool('bmi_adult',{ageYears:30,weightKg:'72',heightCm:168}),/numérico/)
  assert.throws(()=>runHealthClinicalTool('bmi_adult',{ageYears:30,weightKg:Infinity,heightCm:168}),/numérico/)
})
test('mean arterial pressure validates ordering, units and limits',()=>{
  assert.equal(runHealthClinicalTool('mean_arterial_pressure',{systolic:120,diastolic:80}).output.mapMmHg,93.3)
  assert.throws(()=>runHealthClinicalTool('mean_arterial_pressure',{systolic:80,diastolic:120}),/superar/)
  assert.throws(()=>runHealthClinicalTool('mean_arterial_pressure',{systolic:0,diastolic:0}),/fuera de los límites/)
})
test('LMP estimates avoid local timezone and impossible calendar dates',()=>{
  const got=runHealthClinicalTool('lmp_estimate',{lmp:'2026-01-01',asOf:'2026-03-05'})
  assert.deepEqual(got.output,{weeks:9,days:0,estimatedDueDate:'2026-10-08'})
  assert.throws(()=>runHealthClinicalTool('lmp_estimate',{lmp:'2026-02-30',asOf:'2026-03-05'}),/inexistente/)
  assert.throws(()=>runHealthClinicalTool('lmp_estimate',{lmp:'2026-10-10',asOf:'2026-03-05'}),/incompatible/)
  assert.throws(()=>runHealthClinicalTool('lmp_estimate',{lmp:'2025-01-01',asOf:'2026-03-05'}),/incompatible/)
})
