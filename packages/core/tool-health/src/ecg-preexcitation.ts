/**
 * PHOENIX ECG evidence gate, designed around the missed WPW regression.
 *
 * Deterministic review of *supplied and clinically measured* intervals. This
 * DOES NOT extract signals or pixels from an uploaded image, and does not
 * establish the clinical WPW syndrome from a pre-excitation pattern alone.
 */
export type DeltaObservation = 'present'|'absent'|'not-assessable'
export type ECGSource = 'calibrated-12-lead'|'partial-image'|'uncalibrated'|'not-reviewed'
export type Rhythm = 'sinus'|'irregular-wide-complex'|'other'|'unknown'
export interface ECGPreexcitationInput {
  readonly prMs?:unknown
  readonly qrsMs?:unknown
  readonly deltaWave?:unknown
  readonly source?:unknown
  readonly leadEvidence?:unknown
  readonly rhythm?:unknown
  readonly photoDeltaHint?:unknown
  readonly qualitativePrHint?:unknown
  readonly axisHint?:unknown
  readonly clinicianReviewed?:unknown
}
export function assessPreexcitation(input:ECGPreexcitationInput) {
  const source=String(input.source??'not-reviewed') as ECGSource
  if(!['calibrated-12-lead','partial-image','uncalibrated','not-reviewed'].includes(source))
    throw new Error('ECG source quality not recognized')
  if(typeof input.clinicianReviewed!=='boolean')
    throw new Error('Clinician review status must be explicit')
  const delta=String(input.deltaWave??'not-assessable') as DeltaObservation
  if(!['present','absent','not-assessable'].includes(delta))
    throw new Error('Delta wave observation must be present, absent or not-assessable')
  const photoDeltaHint=String(input.photoDeltaHint??'not-assessable')
  if(!['possible','not-seen','not-assessable'].includes(photoDeltaHint))
    throw new Error('Qualitative ECG photo delta hint invalid')
  const qualitativePrHint=String(input.qualitativePrHint??'not-assessable')
  if(!['appears-short','not-apparently-short','not-assessable'].includes(qualitativePrHint))
    throw new Error('Qualitative PR appearance invalid')
  const axisHint=String(input.axisHint??'unknown')
  if(!['left','right','normal','unknown'].includes(axisHint))
    throw new Error('ECG axis hint invalid')
  const rhythm=String(input.rhythm??'unknown') as Rhythm
  if(!['sinus','irregular-wide-complex','other','unknown'].includes(rhythm))
    throw new Error('Unsupported rhythm category')
  const interval=(value:unknown,name:string,lower:number,upper:number)=>{
    if(value===undefined||value===null)return null
    if(typeof value!=='number'||!Number.isFinite(value)||value<lower||value>upper)
      throw new Error(name+' interval invalid or outside physiological measurement bounds')
    return value
  }
  const prMs=interval(input.prMs,'PR',20,440)
  const qrsMs=interval(input.qrsMs,'QRS',35,380)
  const leads=String(input.leadEvidence??'').trim()
  if(leads.length>140||/[<>{}]/.test(leads))
    throw new Error('Invalid lead evidence notation')
  const reviewerHasSource=input.clinicianReviewed===true&&source==='calibrated-12-lead'
  if(source==='calibrated-12-lead'&&
     (photoDeltaHint!=='not-assessable'||qualitativePrHint!=='not-assessable'))
    throw new Error('Qualitative image hints cannot replace calibrated ECG measurements')
  if(!['partial-image','uncalibrated'].includes(source)&&
     (photoDeltaHint!=='not-assessable'||qualitativePrHint!=='not-assessable'))
    throw new Error('Qualitative image hints require an image/uncalibrated source')
  // Qualitative photo hints are reported but are NEVER treated as measured intervals.
  const tentativeImagePattern=['partial-image','uncalibrated'].includes(source)&&
    photoDeltaHint==='possible'
  if(!reviewerHasSource&&(prMs!==null||qrsMs!==null||delta==='present'))
    throw new Error('Measured PR/QRS or delta wave must come from a reviewed, calibrated source')
  const shortPr=prMs!==null&&prMs<120
  const widenedQrs=qrsMs!==null&&qrsMs>=120
  const suspiciousRhythm=rhythm==='irregular-wide-complex'
  let pattern:'COMPATIBLE_WPW_PREEXCITATION_PATTERN'|'POSSIBLE_PREEXCITATION'|
     'INSUFFICIENT_ECG_EVIDENCE'|'CLASSIC_PATTERN_NOT_SHOWN'|
     'PHOTO_SUGGESTS_PREEXCITATION_UNVERIFIED'='INSUFFICIENT_ECG_EVIDENCE'
  if(tentativeImagePattern)pattern='PHOTO_SUGGESTS_PREEXCITATION_UNVERIFIED'
  if(reviewerHasSource){
    if(delta==='present'&&shortPr&&widenedQrs&&leads.length>0)
      pattern='COMPATIBLE_WPW_PREEXCITATION_PATTERN'
    else if(delta==='present'&&(shortPr||widenedQrs)&&leads.length>0)
      pattern='POSSIBLE_PREEXCITATION'
    else if(prMs!==null&&qrsMs!==null&&delta==='absent')
      pattern='CLASSIC_PATTERN_NOT_SHOWN'
  }
  const missing=[
    ...(source!=='calibrated-12-lead'?['complete calibrated 12-lead tracing']:[]),
    ...(!input.clinicianReviewed?['real source review']:[]),
    ...(prMs===null?['verified PR duration']:[]),
    ...(qrsMs===null?['verified QRS duration']:[]),
    ...(delta==='not-assessable'?['delta-wave onset morphology']:[]),
    ...(delta==='present'&&!leads?['lead-specific delta-wave evidence']:[]),
  ]
  const urgencies=suspiciousRhythm?[
    'Potential pre-excited atrial fibrillation with irregular wide-complex rhythm: requires urgent clinical evaluation and original ECG review.',
    'If pre-excited AF is confirmed, AV nodal blockers can be harmful; follow emergency cardiology guidance.',
  ]:[]
  return {
    modality:'ecg',reviewedCalibratedRecord:reviewerHasSource,
    qualitativePhotoOnly:!reviewerHasSource,
    photoDeltaHint,qualitativePrHint,axisHint,
    imageSuspectedPreexcitationUnverified:tentativeImagePattern,
    photoHintIsClinicallyVerified:false,
    photoDoesNotPermitMeasuredPRorQRS:true,
    structuredMeasurementsAreClinicianSupplied:true,
    imagePixelsAnalysed:false,digitalWaveformAnalysed:false,
    prMs,qrsMs,deltaWave:delta,leadEvidence:leads,rhythm,
    shortPr,widenedQrs,pattern,
    wpwSyndromeConfirmed:false,clinicalDiagnosisValidated:false,
    exactAccessoryPathwayLocalized:false,
    differential:[
      'Ventricular pre-excitation via an accessory atrioventricular pathway',
      'Other causes of QRS widening or apparent initial slurring (artifact, conduction abnormality)',
      'Intermittent or minimal pre-excitation cannot be excluded from a single recording',
    ],
    missing,urgentFlags:urgencies,
    mandatoryECGChecklist:['PR duration and calibration','Initial QRS slope/delta across leads',
      'QRS duration and morphology','Rhythm and urgent irregular wide-complex pattern',
      'QRS axis and fascicular mimics AFTER pre-excitation assessment'],
    visualDecision:tentativeImagePattern?
      'PROVISIONAL_ELECTROPHYSIOLOGY_MECHANISM_ONLY':
      (reviewerHasSource&&
       (pattern==='COMPATIBLE_WPW_PREEXCITATION_PATTERN'||pattern==='POSSIBLE_PREEXCITATION')?
        'EDUCATIONAL_ELECTROPHYSIOLOGY_MECHANISM_ONLY':'NO_PATIENT_DIAGNOSIS_VISUAL'),
    electricalMechanism:pattern==='COMPATIBLE_WPW_PREEXCITATION_PATTERN'||
      pattern==='POSSIBLE_PREEXCITATION'||
      pattern==='PHOTO_SUGGESTS_PREEXCITATION_UNVERIFIED'?{
        supportedConcept:'Generic atrioventricular accessory pathway capable of bypassing AV node delay',
        requiredLabels:['Sinoatrial node','AV node','His-Purkinje conduction',
          'Generic accessory atrioventricular pathway','Early ventricular depolarization','ECG delta wave'],
        doNotDepict:['Patient-specific side/location of pathway without mapping',
          'Necrotic tissue, infarction or structural lesion based solely on ECG',
          'Specific atrial or ventricular anatomy reconstructed from paper ECG'],
        visualizationType:'educational-electrophysiology-only',
      }:null,
    visualExplanation:pattern==='COMPATIBLE_WPW_PREEXCITATION_PATTERN'||
      pattern==='POSSIBLE_PREEXCITATION'||
      pattern==='PHOTO_SUGGESTS_PREEXCITATION_UNVERIFIED'?
      'Educational electrical schematic may depict a GENERIC accessory atrioventricular pathway, never a patient-specific pathway side or lesion location.':
      'No patient-specific electrical abnormality or pathway should be drawn without additional evidence.',
    caution:'WPW ECG pattern is not equivalent to symptomatic WPW syndrome. A leftward QRS axis alone neither diagnoses nor excludes pre-excitation. A suspected delta wave from a photo must be confirmed on a calibrated 12-lead tracing; the tool does not inspect pixels.',
    aiDiagnosisPerformed:false,
  }
}

/**
 * Return a usable evidence warning when a photographed ECG is incorrectly
 * submitted as though its intervals or delta wave had been clinically verified.
 * Never reinterpret an invalid request as confirmed pre-excitation.
 * @param input - User-supplied, potentially incomplete ECG metadata.
 * @returns Source assessment or an explicit non-diagnostic evidence conflict.
 */
export function reviewPreexcitationRequest(input: ECGPreexcitationInput) {
  try {
    return assessPreexcitation(input)
  } catch (error: unknown) {
    if (!(error instanceof Error)
      || error.message !== 'Measured PR/QRS or delta wave must come from a reviewed, calibrated source') throw error
    return {
      status: 'SOURCE_EVIDENCE_MISMATCH' as const,
      sourceType: input.source ?? 'unknown',
      clinicalDiagnosisValidated: false,
      imagePixelsAnalysed: false,
      prMs: null,
      qrsMs: null,
      deltaWave: 'not-assessable' as const,
      message: 'No hay medición calibrada ni revisión profesional que permita afirmar PR/QRS o deltaWave=present. Reexaminar el ECG original antes de interpretar este patrón. No se ha realizado diagnóstico.',
    }
  }
}
