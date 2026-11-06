/**
 * HealthIA tool-backed chat cards: show patient-management UI only from a deliberate,
 * tool receipts, not model-authored assertions that a patient was created.
 * The owner-local conversational profiles are NOT the physician's /health EHR.
 * Only identity metadata and aggregate counts reach this UI projection.
 */
import { parseGenerativeUiBlock, type GenerativeUiBlock } from './GenerativeUi.tsx'

const MAX_NODES = 96
const MAX_JSON = 250_000
const MAX_CARDS = 3

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

function boundedText(value: unknown, max = 160): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null
}

function patient(value: unknown): { id: string; displayName: string; birthDate?: string } | null {
  const p=record(value)
  if (!p) return null
  const id=boundedText(p.id,120),displayName=boundedText(p.displayName,200)
  if (!id || !displayName || !/^patient_[0-9a-f-]{36}$/iu.test(id)) return null
  if (p.birthDate !== undefined && (typeof p.birthDate !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(p.birthDate))) return null
  return { id,displayName,...(p.birthDate ? {birthDate:p.birthDate} : {}) }
}

function patientArray(value: unknown): {id:string;displayName:string;birthDate?:string}[] | null {
  if (!Array.isArray(value) || value.length>500) return null
  const list=value.map(patient)
  if (list.some(x=>x===null)) return null
  return list as {id:string;displayName:string;birthDate?:string}[]
}

function canvas(title:string,subtitle:string,children:Record<string,unknown>[]):GenerativeUiBlock | null {
  return parseGenerativeUiBlock({component:'ui_canvas',version:1,props:{title,subtitle,children}})
}

function createInput(): Record<string,unknown>[] {
  return [
    {type:'heading',text:'Nuevo perfil de prueba'},
    {type:'input',id:'nombre',label:'Nombre o etiqueta del paciente',placeholder:'Paciente demo 3'},
    {type:'button',label:'Preparar registro',action:'draft',
      prompt:'Kira, quiero crear un perfil de prueba en HealthIA con esta etiqueta: {nombre}. Si está vacía, solicita el nombre. Primero consulta health_patient_list para evitar duplicados y después utiliza health_patient_create. Confirma que está guardado solo si la herramienta devuelve un patient.id válido. Distingue este perfil conversacional del expediente médico /health.'},
  ]
}

function profileList(input:Record<string,unknown>,label:string):GenerativeUiBlock | null {
  const patients=patientArray(input.patients)
  if (patients===null) return null
  const options=patients.slice(0,20).map(p=>({label:p.displayName.slice(0,120),value:p.id}))
  return canvas('HealthIA · Pacientes',label,
    [{type:'group',layout:'row',children:[
      {type:'badge',text:'Motor activado',status:'positive'},
      {type:'badge',text:patients.length+' perfiles',status:'info'},
    ]},
    {type:'alert',status:'info',message:'Los perfiles de este chat son distintos del expediente clínico profesional /health. Usa datos ficticios para probar.'},
    ...(options.length?[
      {type:'select',id:'paciente',label:'Perfil existente',options},
      {type:'button',label:'Abrir perfil',action:'draft',
        prompt:'Kira, utiliza health_patient_snapshot para el paciente con ID {paciente}. Muestra su ficha longitudinal en HealthIA; no inventes antecedentes, diagnósticos ni acciones no confirmadas.'},
    ]:[]),
    {type:'divider'},
    ...createInput()])
}

function profileCreated(input:Record<string,unknown>):GenerativeUiBlock | null {
  const p=patient(input.patient)
  if (!p) return null
  return canvas('HealthIA · Perfil creado','Confirmado por la respuesta de health_patient_create',[
    {type:'badge',text:'Guardado en HealthIA',status:'positive'},
    {type:'metric',label:'Paciente',value:p.displayName.slice(0,100)},
    {type:'text',text:p.birthDate?'Nacimiento registrado: '+p.birthDate:'Nacimiento: sin registrar'},
    {type:'alert',status:'info',message:'Este es un perfil longitudinal conversacional, no un expediente médico firmado en /health. La consulta debe iniciarse por separado.'},
    {type:'group',layout:'row',children:[
      {type:'button',label:'Ver historia',action:'draft',
        prompt:'Kira, lee health_patient_snapshot con patient_id '+p.id+'. Muestra los datos verdaderamente guardados y la información faltante. No inventes antecedentes.'},
      {type:'button',label:'Iniciar entrevista',action:'draft',
        prompt:'Kira, consulta health_patient_snapshot del patient_id '+p.id+' y comienza una entrevista clínica de demostración, con preguntas progresivas y evaluación temprana de señales de alarma. No inventes respuestas ni guardes un diagnóstico supuesto.'},
    ]},
  ])
}

function snapshot(input:Record<string,unknown>):GenerativeUiBlock | null {
  const data=record(input.snapshot)
  if (!data) return null
  const p=patient(data.patient)
  if (!p || !Array.isArray(data.records) || !Array.isArray(data.episodes)) return null
  if (data.records.length>1000 || data.episodes.length>200) return null
  return canvas('HealthIA · Historia longitudinal','Consulta verificada desde health_patient_snapshot',[
    {type:'heading',text:p.displayName.slice(0,150)},
    {type:'group',layout:'grid',children:[
      {type:'metric',label:'Datos registrados',value:String(data.records.length)},
      {type:'metric',label:'Episodios clínicos',value:String(data.episodes.length)},
    ]},
    {type:'alert',status:'info',message:'Los datos ausentes no equivalen a hallazgos negativos. Para documentación clínica profesional, utiliza /health.'},
    {type:'group',layout:'row',children:[
      {type:'button',label:'Continuar entrevista',action:'draft',
        prompt:'Kira, continúa la entrevista del perfil '+p.id+' con el siguiente dato más relevante para el motivo referido. Revisa el expediente antes de proponer nuevas preguntas.'},
      {type:'button',label:'Ver datos registrados',action:'draft',
        prompt:'Kira, consulta health_records_query para el patient_id '+p.id+' y resume solo datos verificables con su procedencia, fecha y unidades.'},
    ]},
  ])
}

function canonicalToolName(input:unknown):string|null {
  if (typeof input!=='string') return null
  const prefixes=['mcp__tool_healthia__','mcp__tool-healthia__']
  const normalized=prefixes.reduce((value,prefix)=>value.startsWith(prefix)?value.slice(prefix.length):value,input)
  return ['health_patient_workspace','health_patient_create','health_patient_snapshot']
    .includes(normalized) && (!input.startsWith('mcp__') || normalized!==input) ? normalized : null
}

/**
 * Extract bounded, schema-validated cards only from completed first-party receipts.
 * Background activation and profile lookup never authorize the patient workspace.
 * @param root - Tool result or nested first-party tool execution receipts.
 * @returns Native HealthIA blocks for explicit workspace and confirmed patient actions.
 */
export function healthiaCardsFromToolResult(root:unknown):GenerativeUiBlock[] {
  const stack:[unknown,number][]=[[root,0]],cards:GenerativeUiBlock[]=[]
  let visited=0
  while(stack.length && visited++<MAX_NODES && cards.length<MAX_CARDS){
    const entry=stack.pop()
    if(!entry)break
    const [value,depth]=entry,tool=record(value)
    if(!tool)continue
    if(depth<8 && Array.isArray(tool.subCalls))
      for(const child of tool.subCalls.slice(0,20).reverse())stack.push([child,depth+1])
    if(tool.kind!=='tool-result' || tool.isError===true)continue
    const name=canonicalToolName(record(tool.call)?.name)
    if(!name || !Array.isArray(tool.content))continue
    const text=tool.content.flatMap(chunk=>{
      const block=record(chunk)
      return block?.type==='text' && typeof block.text==='string'?[block.text]:[]
    }).join('')
    if(text.length<2 || text.length>MAX_JSON)continue
    let data:Record<string,unknown>|null=null
    try {data=record(JSON.parse(text))}catch{continue}
    if(!data)continue
    let card:GenerativeUiBlock|null=null
    // A mere activation or background identity lookup must never launch an
    // onboarding form. Only the explicit workspace operation owns that UI.
    if(name==='health_patient_workspace' && data.workspace==='patient_management')
      card=profileList(data,'Gestión de perfiles solicitada')
    else if(name==='health_patient_create')
      card=profileCreated(data)
    else if(name==='health_patient_snapshot')
      card=snapshot(data)
    if(card)cards.push(card)
  }
  return cards
}
