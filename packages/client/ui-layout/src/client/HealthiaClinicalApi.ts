/**
 * Host-native encrypted clinic client. Calls only the existing loopback
 * /health/api endpoints. All credentials and CSRF tokens stay in React memory;
 * no clinical information is exposed to model, chat, storage or global events.
 */
export type ClinicalActor = {
  readonly username: string
  readonly role: 'admin'|'clinician'|'psychologist'|'nurse'|'reception'|'lab'|'radiology'|'pharmacy'|'billing'
  readonly org: string
}
export type ClinicalSession = { readonly actor: ClinicalActor; readonly csrf: string }
export type ClinicalPatient = {
  readonly id: string; readonly version: number; readonly name: string
  readonly dateOfBirth: string; readonly phone?: string; readonly email?: string
  readonly documentType?: 'cedula'|'passport'|'other'; readonly documentNumber?: string
  readonly customFields?: Readonly<Record<string,string>>
  readonly medicalHistory?: Readonly<Record<string,string>>
  readonly medicalHistoryReview?: {readonly reviewedAt?:string;readonly reviewedBy?:string}
  readonly allergyReview?: {readonly status:'none-known'|'documented';readonly details:string;
    readonly reviewedAt?:string;readonly reviewedBy?:string}|null
  readonly emailConsent?: boolean; readonly emailVerified?:boolean
  readonly notes?:string
}

/** Entries are server-filtered by the institution, assigned clinician and patient. */
export type ClinicalChartItem = {
  readonly id:string;readonly patientId?:string;readonly createdAt?:string;
  readonly status?:string;readonly [key:string]:unknown
}
export type ClinicalPatientContext = {
  readonly patient:ClinicalPatient
  readonly encounters:readonly ClinicalChartItem[]
  readonly orders:readonly ClinicalChartItem[]
  readonly prescriptions:readonly ClinicalChartItem[]
  readonly observations:readonly ClinicalChartItem[]
  readonly followups:readonly ClinicalChartItem[]
  readonly appointments:readonly ClinicalChartItem[]
  readonly attachments:readonly ClinicalChartItem[]
  readonly timeline:readonly ClinicalChartItem[]
  readonly pending:{readonly orders:number;readonly followups:number;readonly attachments:number}
}
export type ClinicalIntakeTemplate = {
  readonly version:1;readonly revision:number
  readonly fields:readonly {readonly id:string;readonly label:string;
    readonly kind:'text'|'number'|'date'|'email'|'tel'|'select';readonly required:boolean;
    readonly choices?:readonly string[]}[]
}
export type ClinicalIdentityMatches = {
  readonly matches:readonly {readonly id:string;readonly name:string;
    readonly dateOfBirth:string;readonly reason:string}[]
  readonly restrictedCount:number
}

export type ClinicalEncounter = {
  readonly id: string; readonly version: number; readonly patientId: string
  readonly practitioner: string; readonly specialty: string; readonly complaint: string
  readonly history: string; readonly exam: string; readonly assessment: string
  readonly plan: string; readonly status: 'draft'|'reviewed'|'signed'
  readonly signedBy?: string|null; readonly signedAt?: string|null
}
export type ClinicalStatus = {readonly initialized:boolean;readonly enabled:boolean}
export type ClinicalBranding = {readonly logoDataUrl:string|null}
type Requester = typeof fetch
type ApiMethod = 'GET'|'POST'|'PATCH'
const roles: ReadonlySet<string> = new Set([
  'admin','clinician','psychologist','nurse','reception','lab','radiology','pharmacy','billing',
])
const UUID = /^[0-9a-f-]{36}$/u

export class ProtectedClinicError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Respuesta clínica inválida')
  return value as Record<string, unknown>
}
function actorOf(value: unknown): ClinicalActor {
  const actor=object(value)
  if(typeof actor.username!=='string' || typeof actor.org!=='string' || !roles.has(String(actor.role)))
    throw Error('Identidad clínica no verificable')
  return {username:actor.username as string,role:actor.role as ClinicalActor['role'],org:actor.org as string}
}
function sessionOf(value: unknown): ClinicalSession {
  const data=object(value)
  if(typeof data.csrf!=='string'||!/^[a-f0-9]{48}$/u.test(data.csrf))
    throw Error('Protección CSRF clínica no verificable')
  return { actor:actorOf(data.actor), csrf:data.csrf }
}
function listOf<T>(value: unknown, check:(item:unknown)=>item is T):readonly T[] {
  const root=object(value)
  if(!Array.isArray(root.items)||root.items.length>500||!root.items.every(check))
    throw Error('Listado clínico inválido')
  return root.items
}
function patientOf(item: unknown): item is ClinicalPatient {
  if(!item || typeof item!=='object'||Array.isArray(item))return false
  const x=item as Record<string,unknown>
  return typeof x.id==='string'&&typeof x.version==='number'
    &&typeof x.name==='string'&&typeof x.dateOfBirth==='string'
}
function encounterOf(item: unknown): item is ClinicalEncounter {
  if(!item || typeof item!=='object'||Array.isArray(item))return false
  const x=item as Record<string,unknown>
  return typeof x.id==='string'&&typeof x.version==='number'
    &&typeof x.patientId==='string'&&typeof x.complaint==='string'
    &&typeof x.practitioner==='string'&&typeof x.specialty==='string'
    && typeof x.history==='string'&&typeof x.exam==='string'
    &&typeof x.assessment==='string'&&typeof x.plan==='string'
    &&['draft','reviewed','signed'].includes(String(x.status))
}

export class HealthiaClinicalApi {
  constructor(private readonly requester?: Requester) {}

  private async request(path:string,method:ApiMethod='GET',session?:ClinicalSession,
    body?:Record<string, unknown>):Promise<unknown> {
    if(!/^[a-z][a-z-]*(?:\/[0-9a-f-]{36})?$/u.test(path)
      ||path.includes('..')||!['GET','POST','PATCH'].includes(method))
      throw Error('Ruta clínica no autorizada')
    const headers:Record<string,string>={
      'accept':'application/json','content-type':'application/json','x-phoenix-health':'1',
      ...(session&&method!=='GET'?{'x-phoenix-csrf':session.csrf}:{})
    }
    let response:Response
    try {
      response=await (this.requester ?? fetch)('/health/api/'+path, {
        method,headers,credentials:'same-origin',cache:'no-store',
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        signal:AbortSignal.timeout(path==='setup'||path==='login'?30000:10000),
      })
    } catch (cause) {
      const timedOut=cause instanceof Error && /timeout|aborted/i.test(cause.name+' '+cause.message)
      throw new ProtectedClinicError(timedOut
        ? 'La conexión clínica agotó el tiempo de respuesta. Comprueba el Host y reintenta.'
        : 'No se pudo conectar con el servicio clínico local. Comprueba que PHOENIX esté activo y reintenta.',503)
    }
    // Error bodies may contain data; never copy response details into logs.
    if(!response.ok) {
      const msg=response.status===401?'Inicia sesión profesional para continuar.'
        :response.status===403?'No tienes permiso para este registro clínico.'
        :response.status===409?'El registro cambió; actualiza antes de guardar.'
        :response.status===404?'Recurso clínico no encontrado.'
        :response.status===429?'Demasiados intentos; inténtalo más tarde.'
        :'El servicio clínico rechazó la operación. Revisa los datos y permisos.'
      throw new ProtectedClinicError(msg,response.status)
    }
    if(!response.headers.get('content-type')?.includes('application/json'))
      throw Error('Respuesta del servicio no es JSON')
    return response.json() as Promise<unknown>
  }
  async status():Promise<ClinicalStatus> {
    const v=object(await this.request('status'))
    if(typeof v.enabled!=='boolean'||typeof v.initialized!=='boolean')throw Error('Estado clínico inválido')
    return {initialized:v.initialized,enabled:v.enabled}
  }
  async session():Promise<ClinicalSession> {
    return sessionOf(await this.request('session'))
  }
  async branding():Promise<string|null> {
    const value=object(await this.request('branding'))
    if(value.logoDataUrl!==null && (typeof value.logoDataUrl!=='string'
      || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value.logoDataUrl)))
      throw Error('Logo clínico inválido')
    return value.logoDataUrl
  }
  async setup(organization:string,username:string,password:string,logoDataUrl?:string|null):Promise<void> {
    if(password.length<6||password.length>256)throw Error('La contraseña requiere al menos 6 caracteres')
    await this.request('setup','POST',undefined,{organization,username,password,
      ...(logoDataUrl?{logoDataUrl}:{})})
  }
  async updateBranding(session:ClinicalSession,logoDataUrl:string|null):Promise<string|null> {
    const value=object(await this.request('branding','POST',session,{logoDataUrl}))
    if(value.logoDataUrl!==null && typeof value.logoDataUrl!=='string')throw Error('Logo clínico inválido')
    return value.logoDataUrl
  }
  async login(username:string,password:string):Promise<ClinicalSession> {
    return sessionOf(await this.request('login','POST',undefined,{username,password}))
  }
  async logout(session:ClinicalSession):Promise<void> {
    await this.request('logout','POST',session)
  }
  async patients(session:ClinicalSession):Promise<readonly ClinicalPatient[]> {
    return listOf(await this.request('patients','GET',session),patientOf)
  }
  async createPatient(session:ClinicalSession,input:{
    name:string;dateOfBirth:string;phone?:string;email?:string;
    documentType?:string;documentNumber?:string;customFields?:Readonly<Record<string,string>>;
    notes?:string;confirmDistinct?:boolean;distinctReason?:string;
  }):Promise<ClinicalPatient> {
    const v=object(await this.request('patients','POST',session,{...input}))
    if(!patientOf(v.record))throw Error('Confirmación de paciente inválida')
    return v.record
  }

  /** Read the authorized longitudinal projection. The Host never returns other patients. */
  async patientContext(session:ClinicalSession,patientId:string):Promise<ClinicalPatientContext> {
    if(!UUID.test(patientId))throw Error('Identificador de paciente inválido')
    const root=object(await this.request('patient-context/'+patientId,'GET',session))
    const context=object(root.context)
    if(!patientOf(context.patient)||(context.patient as ClinicalPatient).id!==patientId)
      throw Error('El expediente recibido no corresponde al paciente solicitado')
    const names=['encounters','orders','prescriptions','observations','followups',
      'appointments','attachments','timeline'] as const
    const lists:Record<string,readonly ClinicalChartItem[]>={}
    for(const name of names) {
      const items=context[name]
      if(!Array.isArray(items)||items.length>500||!items.every(item=>{
        if(!item||typeof item!=='object'||Array.isArray(item))return false
        const row=item as Record<string,unknown>
        return typeof row.id==='string'&&row.patientId===patientId
      }))throw Error('El servicio devolvió referencias clínicas incompatibles con el paciente')
      lists[name]=items as ClinicalChartItem[]
    }
    const pending=object(context.pending)
    if(!['orders','followups','attachments'].every(key=>
      Number.isSafeInteger(pending[key])&&(pending[key] as number)>=0))
      throw Error('Estado del expediente inválido')
    return {patient:context.patient as ClinicalPatient,
      encounters:lists.encounters!,orders:lists.orders!,
      prescriptions:lists.prescriptions!,observations:lists.observations!,
      followups:lists.followups!,appointments:lists.appointments!,
      attachments:lists.attachments!,timeline:lists.timeline!,
      pending:pending as ClinicalPatientContext['pending']}
  }
  /** Medical history is submitted directly to the encrypted EHR, never to chat. */
  async updatePatientHistory(session:ClinicalSession,patient:ClinicalPatient,
    history:Readonly<Record<string,string>>):Promise<ClinicalPatient> {
    if(!UUID.test(patient.id)||!Number.isSafeInteger(patient.version)||patient.version<1)
      throw Error('Identidad o versión de paciente inválida')
    const record=object(await this.request('patients/'+patient.id,'PATCH',session,{
      action:'history',version:patient.version,record:{...history}
    }))
    if(!patientOf(record.record)||(record.record as ClinicalPatient).id!==patient.id)
      throw Error('La confirmación no corresponde al expediente solicitado')
    return record.record as ClinicalPatient
  }
  /** A verified negative allergy review is never inferred from empty fields. */
  async reviewPatientAllergies(session:ClinicalSession,patient:ClinicalPatient,
    status:'none-known'|'documented',details:string):Promise<ClinicalPatient> {
    if(!UUID.test(patient.id)||!Number.isSafeInteger(patient.version)||patient.version<1
      ||!['none-known','documented'].includes(status)||details.length>2500
      ||status==='documented'&&!details.trim())
      throw Error('Revisión de alergias inválida')
    const response=object(await this.request('patients/'+patient.id,'PATCH',session,{
      version:patient.version,action:'allergy-review',status,details:status==='documented'?details.trim():''
    }))
    if(!patientOf(response.record)||(response.record as ClinicalPatient).id!==patient.id)
      throw Error('La confirmación no corresponde al paciente')
    return response.record as ClinicalPatient
  }
  async patientIntakeTemplate(session:ClinicalSession):Promise<ClinicalIntakeTemplate> {
    const root=object(await this.request('patient-intake-template','GET',session))
    const template=object(root.template)
    if(template.version!==1||!Number.isSafeInteger(template.revision)
      ||!Array.isArray(template.fields)||template.fields.length>64
      ||!template.fields.every(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)
        &&typeof entry.id==='string'&&typeof entry.label==='string'
        &&typeof entry.kind==='string'&&typeof entry.required==='boolean'))
      throw Error('Formulario de admisión no verificable')
    return template as ClinicalIntakeTemplate
  }
  async patientIdentityMatches(session:ClinicalSession,input:{
    name:string;dateOfBirth:string;documentType?:string;documentNumber?:string;
    phone?:string;email?:string
  }):Promise<ClinicalIdentityMatches> {
    const root=object(await this.request('patient-identity-match','POST',session,{...input}))
    const result=object(root.result)
    if(!Array.isArray(result.matches)||result.matches.length>8
      ||!Number.isSafeInteger(result.restrictedCount))
      throw Error('Resultado de identidades inválido')
    return result as ClinicalIdentityMatches
  }

  async encounters(session:ClinicalSession):Promise<readonly ClinicalEncounter[]> {
    return listOf(await this.request('encounters','GET',session),encounterOf)
  }
  async createEncounter(session:ClinicalSession,values:{
    patientId:string;specialty:string;complaint:string;
  }):Promise<ClinicalEncounter> {
    const v=object(await this.request('encounters','POST',session,{...values,mode:'manual'}))
    if(!encounterOf(v.record))throw Error('Confirmación de consulta inválida')
    return v.record
  }
  async saveEncounter(session:ClinicalSession,encounter:ClinicalEncounter,values:{
    history:string;exam:string;assessment:string;plan:string;
  }):Promise<ClinicalEncounter> {
    if(!UUID.test(encounter.id)||!Number.isSafeInteger(encounter.version)
      ||encounter.status==='signed')throw Error('Consulta firmada o versión inválida')
    if(!values.history.trim()||values.history.length>4000||Object.values(values).some(value=>value.length>4000))
      throw Error('La nota supera el límite o no contiene historia clínica.')
    const v=object(await this.request('encounters/'+encounter.id,'PATCH',session,{
      version:encounter.version,action:'document',...values
    }))
    if(!encounterOf(v.record)||v.record.id!==encounter.id||v.record.patientId!==encounter.patientId)
      throw Error('Confirmación de consulta no coincide con el paciente')
    return v.record
  }
}
