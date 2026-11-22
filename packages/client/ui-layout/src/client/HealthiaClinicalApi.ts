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
}
export type ClinicalEncounter = {
  readonly id: string; readonly version: number; readonly patientId: string
  readonly practitioner: string; readonly specialty: string; readonly complaint: string
  readonly history: string; readonly exam: string; readonly assessment: string
  readonly plan: string; readonly status: 'draft'|'reviewed'|'signed'
  readonly signedBy?: string|null; readonly signedAt?: string|null
}
export type ClinicalStatus = {readonly initialized:boolean;readonly enabled:boolean}
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
  return actor as ClinicalActor
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
  constructor(private readonly requester: Requester = fetch) {}

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
      response=await this.requester('/health/api/'+path, {
        method,headers,credentials:'same-origin',cache:'no-store',
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        signal:AbortSignal.timeout(10000),
      })
    } catch {
      throw new ProtectedClinicError('El servicio clínico local no responde.',503)
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
  async setup(organization:string,username:string,password:string):Promise<void> {
    await this.request('setup','POST',undefined,{organization,username,password})
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
  }):Promise<ClinicalPatient> {
    const v=object(await this.request('patients','POST',session,{...input}))
    if(!patientOf(v.record))throw Error('Confirmación de paciente inválida')
    return v.record
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
