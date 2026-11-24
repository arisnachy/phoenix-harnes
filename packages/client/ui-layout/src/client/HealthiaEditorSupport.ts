/** Clinical editor helpers: explicit source text only; no chat or storage. */
export const CLINICAL_EDITOR_STEPS=[
  {id:'interview',label:'Entrevista',hint:'Motivo, enfermedad actual y revisión por sistemas'},
  {id:'background',label:'Antecedentes',hint:'Historia longitudinal y cambios de esta consulta'},
  {id:'vitals',label:'Signos vitales',hint:'Mediciones actuales y cálculos'},
  {id:'exam',label:'Exploración',hint:'Hallazgos realmente evaluados'},
  {id:'diagnosis',label:'Diagnóstico',hint:'Valoración y códigos por verificar'},
  {id:'plan',label:'Plan',hint:'Indicaciones, estudios y seguimiento'},
] as const
export type ClinicalEditorStep=typeof CLINICAL_EDITOR_STEPS[number]['id']
export const VITAL_IDS=['sys','dia','hr','rr','temp','sat','weight','height'] as const
type VitalId=typeof VITAL_IDS[number]
export const DIAGNOSIS_IDS=['assessment','differential','diagnosisStatus','secondaryDiagnosis','codeSystem','icd10'] as const
export function clinicalEditorStep(value:unknown):value is ClinicalEditorStep {
  return CLINICAL_EDITOR_STEPS.some(x=>x.id===value)
}
const numberPattern='(\\d{1,4}(?:[.,]\\d{1,2})?)'
const vitalLimits:Record<VitalId,readonly [number,number]>={
  sys:[1,400],dia:[1,300],hr:[1,350],rr:[1,150],temp:[15,50],sat:[0,100],weight:[0.05,1000],height:[10,300],
}
export function validateVital(id:VitalId,value:string):boolean {
  const n=Number(value)
  const [min,max]=vitalLimits[id]
  return /^\d+(?:\.\d{1,2})?$/u.test(value)&&Number.isFinite(n)&&n>=min&&n<=max
}
export function estimatedMap(values:Readonly<Record<string,string>>):number|undefined {
  if(!validateVital('sys',values.sys??'')||!validateVital('dia',values.dia??''))return undefined
  const sys=Number(values.sys),dia=Number(values.dia)
  return sys>=dia?Math.round((sys+2*dia)/3*10)/10:undefined
}
/** Parse only explicit labeled observations, refuse ambiguous repetitions or units. */
export function extractClinicalVitals(text:string):{values:Partial<Record<VitalId,string>>;warnings:string[]} {
  const values:Partial<Record<VitalId,string>>={},warnings:string[]=[]
  const invalid=new Set<VitalId>()
  const put=(id:VitalId,raw:string)=>{
    const value=raw.replace(',','.')
    if(invalid.has(id))return
    if(!validateVital(id,value)||(values[id]!==undefined&&values[id]!==value)){
      delete values[id];invalid.add(id);warnings.push('Revisar '+id+': dato ambiguo o fuera de límites de entrada.');return
    }
    values[id]=value
  }
  if(text.length>2000)return {values,warnings:['Entrada demasiado extensa.']}
  const bp=new RegExp('(?:presi[oó]n(?: arterial)?|pa|ta)\\s*[:=]?\\s*'+numberPattern+'\\s*/\\s*'+numberPattern+'(?:\\s*mmhg)?(?=\\s|[,;.]|$)','giu')
  for(const m of text.matchAll(bp)){put('sys',m[1]!);put('dia',m[2]!)}
  const labels:readonly [VitalId,string,string][]=[
    ['hr','pulso|frecuencia card[ií]aca|fc','(?:lpm|bpm)?'],
    ['rr','frecuencia respiratoria|fr','(?:rpm)?'],
    ['temp','temperatura|temp','(?:°?\\s*c)?'],
    ['sat','saturaci[oó]n(?: de ox[ií]geno)?|spo2','%?'],
    ['weight','peso','kg'],['height','talla|altura','cm'],
  ]
  for(const [id,label,unit] of labels){
    const re=new RegExp('(?:^|[\\s,;])(?:'+label+')\\s*[:=]?\\s*'+numberPattern+'\\s*'+unit+'(?=\\s*[,;.]|\\s+(?:presi[oó]n|pa|ta|pulso|frecuencia|fc|fr|temperatura|temp|saturaci[oó]n|spo2|peso|talla|altura)\\b|\\s*$)','giu')
    for(const m of text.matchAll(re))put(id,m[1]!)
  }
  if(values.sys!==undefined&&values.dia!==undefined&&Number(values.sys)<Number(values.dia)){
    delete values.sys;delete values.dia;warnings.push('Verificar el orden de la presión arterial.')
  }
  if(!Object.keys(values).length&&!warnings.length)warnings.push('No se reconocieron mediciones explícitas con unidades compatibles.')
  return {values,warnings}
}
export type LongitudinalPatient={
  medicalHistory?:Readonly<Record<string,string>>
  medicalHistoryReview?:{reviewedAt?:string;reviewedBy?:string}
  allergyReview?:{status:string;details:string;reviewedAt?:string}|null
}
/** Never imports previous vital measurements or undocumented negatives. */
export function longitudinalFields(patient:LongitudinalPatient):Record<string,string>{
  const history=patient.medicalHistory??{},out:Record<string,string>={}
  const add=(id:string,keys:readonly string[])=>{
    const found=keys.flatMap(k=>typeof history[k]==='string'&&history[k]!.trim()?[history[k]!.trim()]:[])
    if(found.length)out[id]=found.join('\n')
  }
  add('personal',['problems','pastMedical']);add('surgical',['pastSurgical','hospitalizations','trauma','transfusions'])
  add('family',['familyHistory']);add('habits',['habits','tobacco','alcohol','sleep','nutrition','physicalActivity','occupation','exposures','housing'])
  add('medications',['currentMedications']);add('perinatal',['pediatricDevelopment','vaccinations'])
  add('gyneco',['gynecologicObstetric'])
  if(patient.allergyReview?.status==='documented'&&patient.allergyReview.details.trim())
    out.allergies=patient.allergyReview.details
  if(patient.allergyReview?.status==='none-known')
    out.allergies='Sin alergias conocidas según revisión previa; reconfirmar.'
  return out
}

/** Structural live state, safe to share with the workspace; never a record payload. */
export type ClinicalEditorViewState={
  step:ClinicalEditorStep
  binding:string
  visibleFieldIds:readonly string[]
  filledFields:number
  dirty:boolean
  hasEncounter:boolean
  canEdit:boolean
  modelEnabled:boolean
}

/** A bounded action catalog, never clinical content or authority to sign. */
export const CLINICAL_EDITOR_ACTIONS={
  'clinical-refine-chief':{step:'interview',field:'chief',label:'Mejorar motivo de consulta'},
  'clinical-refine-hea':{step:'interview',field:'hea',label:'Mejorar enfermedad actual'},
  'clinical-import-background':{step:'background',label:'Recuperar antecedentes longitudinales'},
  'clinical-vital-entry':{step:'vitals',label:'Abrir entrada inteligente de mediciones'},
  'clinical-preview':{step:'plan',label:'Preparar historia clínica completa'},
  'clinical-context-review':{step:'diagnosis',label:'Revisar contexto clínico con IA'},
} as const
export type ClinicalEditorAction=keyof typeof CLINICAL_EDITOR_ACTIONS
export function clinicalEditorAction(value:unknown):value is ClinicalEditorAction {
  return typeof value==='string'&&Object.hasOwn(CLINICAL_EDITOR_ACTIONS,value)
}
export type ClinicalEditorRequest={step:ClinicalEditorStep;sequence:number;action?:ClinicalEditorAction;binding?:string}
export function canApplyClinicalAction(view:ClinicalEditorViewState|null,binding:unknown):boolean {
  return !!view?.hasEncounter&&view.canEdit&&typeof binding==='string'&&binding===view.binding
}

export function publicClinicalEditorState(view:ClinicalEditorViewState|null) {
  return view===null?null:{step:view.step,visibleFieldIds:view.visibleFieldIds,filledFields:view.filledFields,
    dirty:view.dirty,hasEncounter:view.hasEncounter,canEdit:view.canEdit,modelEnabled:view.modelEnabled}
}

/** Extract only explicitly supplied intake fields. Never manufacture a DOB from age. */
export type ClinicalIntakePatch = {name?:string;dateOfBirth?:string;sexAtBirth?:'female'|'male'|'intersex'|'unknown';email?:string;phone?:string;birthplace?:string;age?:string}
export function parseClinicalIntake(text:string):ClinicalIntakePatch {
  const out:ClinicalIntakePatch={}
  if(text.length>4000)return out
  const seen=new Set<string>(),invalid=new Set<string>()
  const add=<K extends keyof ClinicalIntakePatch>(key:K,value:ClinicalIntakePatch[K])=>{
    if(invalid.has(key))return
    if(seen.has(key)&&out[key]!==value){delete out[key];invalid.add(key);return}
    seen.add(key);out[key]=value
  }
  const labels=/(?:^|[,;\n]\s*)\s*(nombre(?: completo)?|fecha de nacimiento|nacimiento|lugar de nacimiento|nacid[oa] en|edad|sexo(?: al nacer)?|correo(?: electr[oó]nico)?|email|tel[eé]fono)\s*:?\s*([^,;\n]+)/giu
  for(const match of text.matchAll(labels)){
    const label=match[1]!.toLocaleLowerCase('es'),v=match[2]!.trim()
    if(!v)continue
    if(label.startsWith('nombre')&&v.length<=160)add('name',v)
    else if(label==='edad'&&/^\d{1,3}(?:\s*años)?$/iu.test(v)&&Number.parseInt(v,10)<=125)add('age',String(Number.parseInt(v,10)))
    else if(label==='fecha de nacimiento'||label==='nacimiento'){
      if(/^\d{4}-\d{2}-\d{2}$/u.test(v)){
        const date=new Date(v+'T00:00:00Z')
        if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===v&&date.getTime()<=Date.now())add('dateOfBirth',v)
      }
    }else if(label.startsWith('sexo')){
      const sexes:Record<string,NonNullable<ClinicalIntakePatch['sexAtBirth']>>={femenino:'female',masculino:'male',intersexual:'intersex',desconocido:'unknown'}
      const sex=sexes[v.toLocaleLowerCase('es')]
      if(sex)add('sexAtBirth',sex)
    }else if((label.startsWith('correo')||label==='email')&&v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(v))add('email',v)
    else if(label.startsWith('tel')&&/^[+\d ()-]{7,35}$/u.test(v))add('phone',v)
    else if((label==='lugar de nacimiento'||label.startsWith('nacid'))&&v.length<=250)add('birthplace',v)
  }
  if(!out.name&&!invalid.has('name')){
    const first=/^\s*(?:crea(?:r)?|registra(?:r)?)\s+(?:(?:un|una|al?|la)\s+)?paciente\s+(?:llamad[oa]\s+)?([^,;\n]+)/iu.exec(text)?.[1]?.trim()
    if(first&&first.length<=160&&!/\d|@/u.test(first)&&!/^(?:nombre|edad|sexo)\b/iu.test(first))out.name=first
  }
  return out
}
