/**
 * Evidence-to-image bridge for PHOENIX HealthIA.
 * This module builds a SOURCE-BOUNDED illustrative scene specification; it does
 * not inspect images, diagnose patients, reconstruct geometry or invoke a raster
 * backend. It is safe for de-identified metadata only.
 */
import { diagnosticInputById } from './diagnostic-catalog.ts'

export interface ClinicalTwinSceneInput {
  readonly modality: unknown
  readonly sourceKind: unknown
  readonly sourceReviewed: unknown
  readonly finding: unknown
  readonly evidenceKind: unknown
  readonly sourceLocation?: unknown
  readonly affectedStructure?: unknown
  readonly vascularFinding?: unknown
  readonly neuralFinding?: unknown
  readonly sourceCompleteness?: unknown
}

type FamilyView = {
  title:string
  mode:'anatomical'|'electrophysiological'|'biochemical'|'microscopic'|'physiological'
  anatomy:string[]
  forbidden:string[]
}

const familyView=(family:string):FamilyView=>{
  if(family==='ecg')return {
    title:'Gemelo electrofisiológico cardíaco',
    mode:'electrophysiological',
    anatomy:['aurículas','ventrículos','nodo sinusal','nodo auriculoventricular',
      'haz de His','ramas del haz','fibras de Purkinje'],
    forbidden:['arteria coronaria culpable','infarto confirmado','vía accesoria localizada sin mapeo'],
  }
  if(['laboratory','hematology','microbiology','molecular'].includes(family))return {
    title:'Gemelo bioquímico y fisiológico',
    mode:'biochemical',
    anatomy:['órgano pertinente solo si lo sustenta el resultado',
      'compartimento sanguíneo o celular','analito y mecanismo fisiológico'],
    forbidden:['lesión anatómica localizada por un analito aislado',
      'valor numérico o rango no aportado','enfermedad definitiva por marcador inespecífico'],
  }
  if(['cytology','histopathology'].includes(family))return {
    title:'Gemelo microscópico de tejido y células',
    mode:'microscopic',
    anatomy:['células y arquitectura tisular de referencia',
      'núcleo','citoplasma','estroma cuando sea pertinente'],
    forbidden:['grado histológico no reportado','invasión no comprobada',
      'aumento o escala no documentados'],
  }
  if(['neurophysiology','physiology','sleep','clinical','obstetric'].includes(family))return {
    title:'Gemelo funcional y fisiológico',
    mode:'physiological',
    anatomy:['órgano y circuitos funcionales pertinentes solo como atlas'],
    forbidden:['topografía lesional inferida de señales inespecíficas'],
  }
  return {
    title:'Gemelo anatómico ilustrativo',
    mode:'anatomical',
    anatomy:['órgano implicado','estructuras vecinas anatómicamente relevantes',
      'arterias y venas de referencia rotuladas de forma diferenciada'],
    forbidden:['estenosis, trombosis o hipervascularidad no observadas',
      'reconstrucción geométrica individual desde una captura 2D'],
  }
}

const safeText=(value:unknown,name:string,max:number)=>{
  if(value===undefined||value===null)return ''
  if(typeof value!=='string'||value.length>max||
     /[<>{}\u0000-\u001f]/u.test(value))throw new Error('Metadatos inválidos: '+name)
  return value.trim()
}
const oneOf=(value:unknown,allowed:readonly string[],label:string)=>{
  const s=safeText(value,label,40)
  if(!allowed.includes(s))throw new Error('Valor inválido: '+label)
  return s
}

/** A verified anatomical reconstruction must be authorized by the clinical
 * imaging server after reviewing image series, registration and masks.
 * This LLM-facing metadata helper intentionally has no such authorization.
 */
export function planClinicalTwinScene(input:ClinicalTwinSceneInput){
  const study=diagnosticInputById(input.modality)
  if(!study)throw new Error('Modalidad médica no reconocida')
  if(typeof input.sourceReviewed!=='boolean')throw new Error('Revisión fuente no declarada')
  const sourceKind=oneOf(input.sourceKind,
    ['image','pdf','dicom','waveform','numeric','wsi','report','unknown'],'sourceKind')
  // Report/PDF sources are representations of findings, not original pixels.
  // Never treat incompatible structured sources as if a modality had been inspected.
  const family=study.family
  const compatible=sourceKind==='report'||sourceKind==='pdf'||(
    family==='ecg'?['waveform','image'].includes(sourceKind):
    ['laboratory','hematology','microbiology','molecular'].includes(family)?['numeric','image'].includes(sourceKind):
    ['cytology','histopathology'].includes(family)?['wsi','image'].includes(sourceKind):
    ['neurophysiology','physiology','sleep'].includes(family)?['waveform','numeric','image'].includes(sourceKind):
    ['image','dicom'].includes(sourceKind))
  const evidenceKind=oneOf(input.evidenceKind,
    ['observed','reported','hypothesis','none'],'evidenceKind')
  const completeness=input.sourceCompleteness===undefined?'unknown':
    oneOf(input.sourceCompleteness,['complete','partial','unknown'],'sourceCompleteness')
  const finding=safeText(input.finding,'finding',650)
  const sourceLocation=safeText(input.sourceLocation,'sourceLocation',160)
  const affectedStructure=safeText(input.affectedStructure,'affectedStructure',120)
  const vascularFinding=safeText(input.vascularFinding,'vascularFinding',320)
  const neuralFinding=safeText(input.neuralFinding,'neuralFinding',240)
  const sourceReady=input.sourceReviewed===true&&sourceKind!=='unknown'
  const hasFinding=finding.length>=8&&evidenceKind!=='none'
  // Clinical coordinates cannot be supplied or certified by this helper:
  // an LLM claim of source review is not a registered patient lesion mask.
  const hasLocation=sourceLocation.length>0&&affectedStructure.length>0
  const view=familyView(study.family)
  const secondarySource=sourceKind==='report'||sourceKind==='pdf'
  const decision=!sourceReady?'BLOCK_SOURCE_NOT_REVIEWED':
    secondarySource&&evidenceKind==='observed'?'BLOCK_PRIMARY_EVIDENCE_REQUIRED':
    !compatible?'BLOCK_SOURCE_MODALITY_MISMATCH':
    !hasFinding?'BLOCK_NO_SOURCE_FINDING':
      !hasLocation?'NEEDS_ANATOMIC_LOCALIZATION':'ILLUSTRATION_SPEC_READY'
  const permitted=decision==='ILLUSTRATION_SPEC_READY'
  const vascularAllowed=permitted&&vascularFinding.length>0
    &&!['ecg','laboratory','hematology','microbiology','molecular','cytology','histopathology'].includes(study.family)
    &&evidenceKind!=='hypothesis'
  const neuralAllowed=permitted&&neuralFinding.length>0&&evidenceKind!=='hypothesis'
    &&!['ecg','laboratory','hematology','microbiology','molecular','cytology','histopathology'].includes(study.family)
  const evidenceLabel=evidenceKind==='observed'?'hallazgo observado en fuente primaria declarada':
    evidenceKind==='reported'?'hallazgo atribuido al informe':
    evidenceKind==='hypothesis'?'HIPÓTESIS NO CONFIRMADA':'sin hallazgos'
  const annotations=permitted?[
    {label:affectedStructure,site:sourceLocation,
      content:finding,evidence:evidenceLabel,
      marker:evidenceKind==='hypothesis'?'contorno discontinuo de hipótesis':'marcador de hallazgo referido',
      patientGeometryConfirmed:false},
    ...(vascularAllowed?[{label:'Vascularidad descrita',site:sourceLocation,
      content:vascularFinding,evidence:evidenceLabel,marker:'resaltado vascular condicionado a la fuente',
      patientGeometryConfirmed:false}]:[]),
    ...(neuralAllowed?[{label:'Estructura nerviosa descrita',site:sourceLocation,
      content:neuralFinding,evidence:evidenceLabel,marker:'resaltado nervioso condicionado a la fuente',
      patientGeometryConfirmed:false}]:[]),
  ]:[]
  const modalityRestrictions=[
    ...view.forbidden,
    ...(study.family==='ecg'?[
      'Las derivaciones sugieren territorios eléctricos, NO demuestran una arteria o fascículo lesionado',
      'No dibujar un bloqueo específico del haz o una coronaria culpable salvo evidencia clínica independiente',
    ]:[]),
    ...(completeness!=='complete'?['No mostrar extensión ni ausencia de enfermedad fuera del material revisado']:[]),
  ]
  const prompt=permitted?[
    'Ilustración clínica HIPERREALISTA tipo atlas docente; NO es reconstrucción del paciente.',
    'Modalidad: '+study.label+'. Vista: '+view.title+'.',
    'Mostrar anatomía de referencia correctamente orientada y rotulada en español: '+view.anatomy.join(', ')+'.',
    'Señalar claramente '+affectedStructure+' en '+sourceLocation+'.',
    'Representar únicamente el siguiente hallazgo, calificado como '+evidenceLabel+': '+finding+'.',
    ...(vascularAllowed?['Visualizar vasculatura afectada SOLO según la descripción aportada: '+vascularFinding+
      '. Diferenciar arterias rojas y venas azules, respetando recorrido anatómico.']:[
      'Mostrar vasos anatómicos solo como referencia normal, sin fingir alteración vascular.']),
    ...(neuralAllowed?['Mostrar compromiso neural solo como esquema ilustrativo: '+neuralFinding+'.']:[]),
    'Rotular la estructura, lesión/hallazgo y estado de certeza. Priorizar precisión anatómica y legibilidad.',
    'No inventar valores, escala, tamaño, topografía, vasos culpables ni extensión.',
    'Prohibiciones: '+modalityRestrictions.join('; ')+'.',
    'Debe figurar la leyenda discreta: Ilustración educativa basada en hallazgos referidos; no constituye imagen del paciente.',
  ].join(' '):null
  return {
    status:decision,modality:study.id,modalityLabel:study.label,family:study.family,
    scene:view,source:{type:sourceKind,reviewAsserted:input.sourceReviewed,
      completeness,evidenceKind,sourceLocation:sourceLocation||null},
    annotations,vascularChangeDepicted:vascularAllowed,neuralChangeDepicted:neuralAllowed,
    imageGenerationRequested:false,imageGenerated:false,patientSpecificAnatomy:false,
    patientSpecificGeometryValidated:false,diagnosticAccuracyValidated:false,
    requiresClinicianReview:true,renderPrompt:prompt,forbiddenClaims:modalityRestrictions,
    nextAction:!sourceReady?'Inspeccionar realmente el estudio original con un motor compatible.':
      !compatible?'Corregir la incompatibilidad entre modalidad y tipo de fuente; no generar una lesión.':
      secondarySource&&evidenceKind==='observed'?'Clasificar los hallazgos del informe/PDF como reportados; no afirmar inspección primaria.':
      !hasFinding?'Documentar hallazgos objetivos y su procedencia.':
      !hasLocation?'Identificar estructura y localización antes de señalar una lesión.':
      'Ejecutar generador raster disponible y comprobar su salida visual; marcar como atlas docente y cotejar anatomía, rótulos y lesión con la fuente.',
  }
}
