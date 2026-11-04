/**
 * Reviewed, deterministic local clinical tools.
 * These calculations never diagnose, prescribe, or sign a patient record.
 * Do not send patient identifiers or notes to this boundary.
 */
export type ClinicalToolId = 'bmi_adult' | 'mean_arterial_pressure' | 'lmp_estimate'

/** Metadata for a reviewed deterministic clinical tool and its input fields. */
export interface ClinicalToolDefinition {
  readonly id: ClinicalToolId
  readonly version: string
  readonly title: string
  readonly description: string
  readonly fields: readonly {id:string;label:string;kind:'number'|'date';unit?:string}[]
  readonly reference: string
  readonly notice: string
}
/** Built-in, versioned catalog. Custom executable AI code is not accepted here. */
export const HEALTH_CLINICAL_TOOLS:readonly ClinicalToolDefinition[]=[
  {
    id:'bmi_adult',version:'1.0.0',title:'IMC del adulto',
    description:'Cálculo aritmético; no clasifica crecimiento pediátrico, embarazo ni composición corporal.',
    fields:[{id:'ageYears',label:'Edad',kind:'number',unit:'años'},
      {id:'weightKg',label:'Peso medido',kind:'number',unit:'kg'},
      {id:'heightCm',label:'Talla medida',kind:'number',unit:'cm'}],
    reference:'kg / m²',notice:'Resultado orientativo: interpretar con datos clínicos reales. No constituye diagnóstico.',
  },
  {
    id:'mean_arterial_pressure',version:'1.0.0',title:'Presión arterial media estimada',
    description:'Aproximación en reposo a partir de PA sistólica y diastólica medidas.',
    fields:[{id:'systolic',label:'Presión sistólica',kind:'number',unit:'mmHg'},
      {id:'diastolic',label:'Presión diastólica',kind:'number',unit:'mmHg'}],
    reference:'(PAS + 2 × PAD) / 3',notice:'Aproximación, no sustituye medición ni valoración hemodinámica.',
  },
  {
    id:'lmp_estimate',version:'1.0.0',title:'Edad gestacional estimada por FUM',
    description:'Estimación a partir del primer día de la última menstruación; no confirma datación obstétrica.',
    fields:[{id:'lmp',label:'Fecha de última menstruación',kind:'date'},
      {id:'asOf',label:'Fecha de valoración',kind:'date'}],
    reference:'FUM + 280 días; intervalo en semanas y días',
    notice:'Estimación sujeta a regularidad del ciclo y confirmación obstétrica/ecográfica; no modifica fecha gestacional confirmada.',
  },
] as const

function inputObject(input:unknown):Record<string,unknown> {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Datos de cálculo inválidos')
  return input as Record<string,unknown>
}
function numeric(input:Record<string,unknown>,key:string,min:number,max:number):number {
  const raw=input[key]
  if(typeof raw!=='number'||!Number.isFinite(raw)||raw<min||raw>max)
    throw new Error('Dato numérico ausente o fuera de los límites de la herramienta: '+key)
  return raw
}
function utcDate(raw:unknown,key:string):Date{
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(raw))
    throw new Error('Fecha ISO requerida: '+key)
  const [year,month,day]=raw.split('-').map(Number)
  const date=new Date(Date.UTC(year!,month!-1,day!))
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month!-1||
    date.getUTCDate()!==day)throw new Error('Fecha calendario inexistente: '+key)
  return date
}
function isoDate(value:Date):string {return value.toISOString().slice(0,10)}
function checkKeys(input:Record<string,unknown>,allowed:string[]):void{
  if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('El cálculo contiene campos no autorizados')
}

/** Execute a bounded clinical calculation locally; never create a diagnosis or prescription.
 * @param id - Stable tool identifier from the authorized catalog.
 * @param raw - Exact numerical/date inputs without patient identifiers or free-text PHI.
 * @returns Deterministic result with version, reference and review-required status.
 */
export function runHealthClinicalTool(id:string,raw:unknown):{
  id:ClinicalToolId;version:string;output:Record<string,number|string>;reference:string;notice:string;status:'review-required'
}{
  const tool=HEALTH_CLINICAL_TOOLS.find(item=>item.id===id)
  if(!tool)throw new Error('Herramienta clínica no disponible')
  const values=inputObject(raw)
  checkKeys(values,tool.fields.map(field=>field.id))
  let output:Record<string,number|string>
  switch(id){
    case 'bmi_adult':{
      const age=numeric(values,'ageYears',18,120)
      const weight=numeric(values,'weightKg',20,350)
      const height=numeric(values,'heightCm',100,240)
      output={ageYears:age,bmi:Number((weight/((height/100)**2)).toFixed(1))}
      break
    }
    case 'mean_arterial_pressure':{
      const sbp=numeric(values,'systolic',60,300)
      const dbp=numeric(values,'diastolic',30,200)
      if(sbp<=dbp)throw new Error('La presión sistólica debe superar a la diastólica')
      output={mapMmHg:Number(((sbp+2*dbp)/3).toFixed(1))}
      break
    }
    case 'lmp_estimate':{
      const lmp=utcDate(values.lmp,'lmp')
      const asOf=utcDate(values.asOf,'asOf')
      const days=Math.round((asOf.getTime()-lmp.getTime())/86_400_000)
      if(days<0||days>294)throw new Error('Intervalo gestacional incompatible con la calculadora')
      const due=new Date(lmp.getTime()+280*86_400_000)
      output={weeks:Math.floor(days/7),days:days%7,estimatedDueDate:isoDate(due)}
      break
    }
    default:throw new Error('Herramienta clínica no disponible')
  }
  return {id:tool.id,version:tool.version,output,reference:tool.reference,
    notice:tool.notice,status:'review-required'}
}
