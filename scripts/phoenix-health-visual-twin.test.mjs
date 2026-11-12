import test from 'node:test'
import assert from 'node:assert/strict'
import { planClinicalTwinScene } from '../packages/core/tool-health/src/clinical-twin-scene.ts'

const baseline={
  modality:'ct',sourceKind:'image',sourceReviewed:true,sourceCompleteness:'partial',
  finding:'Engrosamiento del apéndice con cambios inflamatorios periapendiculares.',
  evidenceKind:'observed',sourceLocation:'fosa ilíaca derecha, corte axial',
  affectedStructure:'apéndice',
}

test('CT observed lesion is annotated with explicit site, structure and graded source evidence',()=>{
  const r=planClinicalTwinScene({...baseline,
    vascularFinding:'Hipervascularidad periapendicular descrita por el médico en el corte revisado'})
  assert.equal(r.status,'ILLUSTRATION_SPEC_READY')
  assert.equal(r.scene.mode,'anatomical')
  assert.equal(r.annotations.length,2)
  assert.equal(r.vascularChangeDepicted,true)
  assert.match(r.renderPrompt,/hiperrealista/i)
  assert.match(r.renderPrompt,/fosa ilíaca derecha/)
  assert.match(r.renderPrompt,/arterias rojas y venas azules/)
  assert.equal(r.patientSpecificGeometryValidated,false)
  assert.equal(r.imageGenerated,false)
  assert.equal(r.diagnosticAccuracyValidated,false)
  assert(r.forbiddenClaims.some(x=>/fuera del material revisado/.test(x)))
})

test('a screenshot no one examined can never authorize an imaginary lesion illustration',()=>{
  const r=planClinicalTwinScene({...baseline,sourceReviewed:false})
  assert.equal(r.status,'BLOCK_SOURCE_NOT_REVIEWED')
  assert.equal(r.annotations.length,0)
  assert.equal(r.renderPrompt,null)
  assert.equal(r.imageGenerated,false)
})

test('a source finding without location cannot be drawn as a confirmed lesion',()=>{
  const r=planClinicalTwinScene({...baseline,sourceLocation:'',affectedStructure:''})
  assert.equal(r.status,'NEEDS_ANATOMIC_LOCALIZATION')
  assert.equal(r.renderPrompt,null)
})

test('ECG can teach conduction, not infer a culprit coronary artery from leads',()=>{
  const r=planClinicalTwinScene({...baseline,modality:'ecg',sourceKind:'waveform',
    finding:'Elevación del ST descrita en II, III y aVF.',
    sourceLocation:'derivaciones inferiores II, III, aVF',
    affectedStructure:'territorio eléctrico inferior',
    vascularFinding:'arteria coronaria derecha supuestamente ocluida'})
  assert.equal(r.status,'ILLUSTRATION_SPEC_READY')
  assert.equal(r.scene.mode,'electrophysiological')
  assert.equal(r.vascularChangeDepicted,false)
  assert.equal(r.annotations.length,1)
  assert.match(r.renderPrompt,/haz de His/)
  assert.match(r.renderPrompt,/coronaria culpable/)
  assert.doesNotMatch(r.renderPrompt,/supuestamente ocluida/)
})

test('laboratory and cytology produce distinct, named physiology and microanatomy visuals',()=>{
  const lab=planClinicalTwinScene({...baseline,modality:'chemistry_panel',sourceKind:'numeric',
    finding:'Creatinina elevada según unidad e intervalo de referencia reportados.',
    sourceLocation:'compartimento plasmático',affectedStructure:'creatinina',
    vascularFinding:'trombo renal supuestamente presente'})
  assert.equal(lab.scene.mode,'biochemical')
  assert.equal(lab.vascularChangeDepicted,false)
  assert.doesNotMatch(lab.renderPrompt,/trombo renal supuestamente/)
  const cyto=planClinicalTwinScene({...baseline,modality:'cytology',sourceKind:'wsi',
    finding:'Células con pleomorfismo y aumento de relación núcleo-citoplasma, documentado.',
    sourceLocation:'campo microscópico revisado',affectedStructure:'células epiteliales'})
  assert.equal(cyto.scene.mode,'microscopic')
  assert.match(cyto.renderPrompt,/núcleo/)
  assert.equal(cyto.patientSpecificAnatomy,false)
})

test('unsupported modality, invalid evidence status and injected markup are rejected',()=>{
  assert.throws(()=>planClinicalTwinScene({...baseline,modality:'imaginary'}),/Modalidad/)
  assert.throws(()=>planClinicalTwinScene({...baseline,evidenceKind:'confirmed'}),/inválido/)
  assert.throws(()=>planClinicalTwinScene({...baseline,finding:'<script>hola</script>'}),/inválidos/)
})

test('catalogue breadth is recognized without claiming that a diagnostic model ran',()=>{
  for(const modality of ['ct_angiography','mri_brain','eeg','complete_blood_count',
    'histopathology','ultrasound_doppler','retinal_fundus','dermoscopy']){
    const sourceKind=['histopathology'].includes(modality)?'wsi':
      ['eeg'].includes(modality)?'waveform':
      ['complete_blood_count'].includes(modality)?'numeric':'image'
    const r=planClinicalTwinScene({...baseline,modality,sourceKind})
    assert.equal(r.modality,modality)
    assert.equal(r.imageGenerated,false)
    assert.equal(r.diagnosticAccuracyValidated,false)
  }
})


test('mismatched clinical source modality blocks rendering instead of implying source inspection',()=>{
  for(const [modality,sourceKind] of [
    ['ecg','numeric'],['ct','waveform'],['chemistry_panel','dicom'],
    ['cytology','numeric'],['histopathology','waveform'],
  ]){
    const r=planClinicalTwinScene({...baseline,modality,sourceKind})
    assert.equal(r.status,'BLOCK_SOURCE_MODALITY_MISMATCH')
    assert.equal(r.renderPrompt,null)
    assert.equal(r.annotations.length,0)
    assert.equal(r.imageGenerated,false)
  }
})
