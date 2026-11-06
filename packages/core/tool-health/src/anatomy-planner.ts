/**
 * PHOENIX anatomical digital-twin planning (metadata only).
 * NO segmentation, image processing, diagnosis, patient identifiers or storage.
 */
export const ANATOMY_SYSTEMS = Object.freeze({
  nervous: ['brain','spinal cord','cranial nerves','peripheral nerves'],
  head_neck: ['skull','face','eyes','ears','sinuses','airway','thyroid','neck vessels'],
  cardiovascular: ['heart','valves','coronaries','arteries','veins','microvascular territories'],
  respiratory: ['lungs','bronchi','pleura','thoracic cavity'],
  gastrointestinal: ['esophagus','stomach','intestines','liver','gallbladder','pancreas'],
  urinary: ['kidneys','ureters','bladder'],
  reproductive: ['pelvic organs','reproductive organs'],
  musculoskeletal: ['bones','joints','muscles','tendons','ligaments','fascia'],
  hematolymphatic: ['spleen','lymph nodes','bone marrow'],
  endocrine: ['pituitary','adrenal glands','thyroid','other endocrine glands'],
  integumentary: ['skin','subcutaneous tissue','wounds'],
  vascular: ['arterial tree','venous tree','vascular territories'],
} as const)

const MODALITIES = Object.freeze({
  ct: {label:'Tomografía computarizada',geometry:'potentially-patient-specific',engines:['3D Slicer','TotalSegmentator','MONAI','nnU-Net']},
  cta: {label:'Angio-TC',geometry:'potentially-patient-specific',engines:['3D Slicer','MONAI','SimVascular']},
  mri: {label:'Resonancia magnética',geometry:'potentially-patient-specific',engines:['3D Slicer','MONAI','nnU-Net']},
  mra: {label:'Angio-RM',geometry:'potentially-patient-specific',engines:['3D Slicer','MONAI','SimVascular']},
  us3d: {label:'Ecografía volumétrica',geometry:'partial-patient-specific',engines:['3D Slicer','SlicerHeart']},
  us2d: {label:'Ecografía 2D',geometry:'partial-not-volumetric',engines:['3D Slicer']},
  radiograph: {label:'Radiografía',geometry:'projection-only',engines:['OHIF','Cornerstone3D']},
  ecg: {label:'Electrocardiograma',geometry:'no-patient-specific-geometry',engines:['openCARP (investigación; requiere geometría y parámetros adicionales)']},
  laboratory: {label:'Analíticas / historia clínica',geometry:'no-patient-specific-geometry',engines:[]},
} as const)

type Modality = keyof typeof MODALITIES
function normalize(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
}
function detectModalities(text: string): Modality[] {
  const s=normalize(text)
  const found:Modality[]=[]
  const rules: [Modality,RegExp][]=[
    ['cta',/(angio.?tc|angio.?tac|coronariograf[ií]a por tc|ct angiograph|cta)/],
    ['mra',/(angio.?rm|angio.?resonancia|mra)/],
    ['ct',/(tomograf|(?:^|\W)tac(?:\W|$)|(?:^|\W)ct(?:\W|$))/],
    ['mri',/(resonancia|(?:^|\W)rm(?:\W|$)|(?:^|\W)mri(?:\W|$))/],
    ['us3d',/(ecograf[ií]a 3d|sonograf[ií]a 3d|ultrasonido 3d|eco 4d)/],
    ['us2d',/(ecograf|sonograf|ultrasonido|ecocardiograma)/],
    ['radiograph',/(radiograf|rayos x|rx torax|x-ray)/],
    ['ecg',/(electrocardi|(?:^|\W)ekg(?:\W|$)|(?:^|\W)ecg(?:\W|$))/],
    ['laboratory',/(laboratorio|analitica|historia clinica|hemograma|bioquimica)/],
  ]
  for(const [key,re] of rules) if(re.test(s)) found.push(key)
  return found.filter((key)=>!(key==='ct'&&found.includes('cta'))&&!(key==='mri'&&found.includes('mra'))&&!(key==='us2d'&&found.includes('us3d')))
}
export function planAnatomicalTwin(region: string, studyDescriptions: string) {
  const query=normalize(region)
  const selected=Object.entries(ANATOMY_SYSTEMS)
    .filter(([key,organs])=>query==='all'||query==='cuerpo completo'||query==='todo el cuerpo'||
      query.includes(key.replace('_',' '))||organs.some(organ=>query.includes(organ)))
    .map(([key,organs])=>({system:key,structures:organs}))
  // Do not hallucinate a regional identification from arbitrary free text.
  const regions=selected.length?selected:[{system:'region-not-identified',structures:[] as readonly string[]}]
  const modalities=detectModalities(studyDescriptions)
  const descriptors=modalities.map(code=>({code,...MODALITIES[code]}))
  const volumetric=descriptors.some(row=>row.geometry==='potentially-patient-specific'||row.geometry==='partial-patient-specific')
  const engines=[...new Set(descriptors.flatMap(row=>row.engines))]
  const limitations=[
    'Este resultado es un PLAN de trabajo; no se han abierto archivos ni generado mallas.',
    'ECG, radiografías, informes y analíticas NO determinan por sí solos una geometría vascular o tisular 3D individual.',
    'No atribuir una arteria culpable, trombo, necrosis, lesión nerviosa o estenosis sin pruebas apropiadas.',
    'Un modelo de atlas debe identificarse como referencia, nunca como anatomía reconstruida del paciente.',
  ]
  return {
    status:'planning-only',patientDataAccessed:false,modelCreated:false,
    scope:regions,studies:descriptors,
    geometryAssessment:volumetric?'reconstruction-candidate-requires-source-images-and-validation':'reference-anatomy-only',
    suggestedEngines:engines,
    nextSteps:[
      'Verificar DICOM original, orientación, resolución, fase, contraste, fecha y calidad de adquisición.',
      'Identificar el modelo entrenado y validado para cada órgano, modalidad y población; no usar segmentación universal como diagnóstico.',
      'Segmentar y revisar sobre cortes originales; registrar métricas, errores y correcciones del especialista.',
      'Guardar mallas, segmentaciones DICOM SEG, mediciones y fuente por estructura en el expediente clínico autorizado.',
      'Visualizar capas OBSERVADO / INFERIDO / ATLAS y mostrar incertidumbre y evolución temporal.',
      'Solicitar confirmación clínica antes de publicar un gemelo como verificado.',
    ],
    limitations,
    doctorExplanation:volumetric
      ?'Podemos intentar reconstruir estructuras visibles en los estudios volumétricos, pero su fidelidad dependerá del protocolo, la segmentación y la revisión médica.'
      :'Puedo mostrar un atlas anatómico ilustrativo y explicar posibles correlaciones, pero los estudios descritos no justifican afirmar una reconstrucción tridimensional individual.',
    clinicalUse:'investigación/planificación; sin diagnóstico automático ni validación para decisiones clínicas',
  }
}
