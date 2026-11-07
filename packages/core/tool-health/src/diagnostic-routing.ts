/** Protocol for the source-aware first read of different clinical studies.
 * No patient data, trained weights, or PHI crosses this metadata-only tool.
 */
export const PROTOCOLS={
  ecg:{
    source:'Original calibrated 12-lead waveform, speed/gain and symptoms',
    review:['Identify paper speed, amplitude and all leads','Measure heart rate, rhythm, PR, QRS and QTc',
      'Review axis, conduction, ST/T changes and artifacts','Correlate with symptoms, prior ECG and urgency'],
    avoid:'A cropped ECG image cannot exclude arrhythmia or acute coronary syndromes.'},
  ultrasound:{
    source:'Original cine loops and Doppler studies with scale, patient position and probe',
    review:['Confirm organ and approach','Inspect complete scan planes and cine sequences',
      'Measure lesions and flow with calibration','Review limitations of acoustic windows and operator dependence'],
    avoid:'A single still frame cannot represent the complete ultrasonography study.'},
  xray:{
    source:'Original DICOM radiography with projection, technique and comparison',
    review:['Verify side, anatomy and AP/PA/lateral projection','Assess exposure, rotation and motion',
      'Review systematically for clinically relevant abnormalities','Check comparison studies and clinical indication'],
    avoid:'A screenshot may obscure subtle findings and cannot exclude pathology outside the image.'},
  ct:{
    source:'Complete DICOM series, contrast phase, slices and multiplanar reconstructions',
    review:['Check series completeness, thickness, window and contrast phase',
      'Assess organs and vessels in all relevant planes','Identify lesion dimensions and precise image/slice',
      'Compare with prior studies and clinical indication'],
    avoid:'A single slice or a GLB is not a complete CT reading.'},
  mri:{
    source:'Original DICOM multi-sequence MR study with indication and protocol',
    review:['Identify T1/T2/FLAIR/DWI/ADC/SWI/contrast sequences as available',
      'Verify location across planes and sequences','Measure abnormalities against anatomical landmarks',
      'Compare prior studies and correlate clinical context'],
    avoid:'One MR sequence or screenshot alone may be nondiagnostic.'},
  laboratory:{
    source:'Verified analyte values, units, ranges, specimen and collection time',
    review:['Validate analytical units, reference intervals and laboratory method',
      'Check specimen quality and collection date','Compare results and trends with clinical context',
      'Identify critical values requiring immediate clinician response'],
    avoid:'A number without its units and correct reference interval must not generate a diagnosis.'},
  cytology:{
    source:'Original stained microscopic slide or whole-slide image with adequacy report',
    review:['Confirm sampling site, stain and specimen adequacy','Review magnification and complete sample representation',
      'Describe cellular findings and artifacts','Request pathologist correlation and classification where appropriate'],
    avoid:'A single microscope field cannot establish specimen-wide cytologic diagnosis.'},
  histopathology:{
    source:'Original histology slide/whole-slide with stain, magnification and sampling',
    review:['Confirm tissue and orientation','Review multiple regions and magnifications',
      'Describe morphology with supported architectural findings','Require expert pathology correlation and ancillary studies'],
    avoid:'A cropped photomicrograph alone cannot prove a final tissue diagnosis.'},
  other:{
    source:'Authenticated original study with documented modality',
    review:['Identify input format and acquisition conditions','Select a modality-specific validated interpreter',
      'Extract documented and measurable observations','Require human review for clinical conclusions'],
    avoid:'No universal validated diagnostic interpreter exists for all clinical image types.'},
} as const
export type DiagnosticModality = keyof typeof PROTOCOLS
export function protocolFor(modality: string,sourceType='unknown'){
  if(!Object.hasOwn(PROTOCOLS,modality))throw Error('Unsupported clinical study modality')
  const protocol=PROTOCOLS[modality as DiagnosticModality]
  const source=String(sourceType).toLowerCase()
  const supportedSources=['image','pdf','dicom','waveform','numeric','glb','unknown']
  if(!supportedSources.includes(source))throw Error('Unsupported study source category')
  const formatIsDemonstrablyLimited=source==='glb'||source==='unknown'||
    (['ct','mri','ultrasound','histopathology','cytology'].includes(modality)&&
     ['image','pdf'].includes(source))
  return {
    modality,sourceType:source,
    completeStudyAvailable:false,
    modelAvailableForPatientDiagnosis:false,
    pixelsOrSignalReadByTool:false,
    automaticDiagnosticFinding:null,
    interpretationStatus:'ORIGINAL_STUDY_REQUIRED',
    sourceRequirements:protocol.source,reviewChecklist:protocol.review,
    sourceLimitations:protocol.avoid,formatIsDemonstrablyLimited,
    requiredReportSections:['verified study modality and acquisition','source quality and coverage',
      'directly observed findings with anatomical position and measurable values',
      'findings not evaluated','differential diagnoses only when supported',
      'uncertainty and urgent signs','clinician review and source traceability'],
    guidance:'Never diagnose from a pretty GLB. If the original pixels, ECG trace or lab values were not actually analyzed, explicitly say NOT ANALYZED. Do not invent percentages of diagnostic certainty.',
  }
}
