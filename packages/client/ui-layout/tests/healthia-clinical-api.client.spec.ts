import { describe, expect, it, vi } from 'vitest'
import {
  HealthiaClinicalApi, ProtectedClinicError,
  type ClinicalEncounter, type ClinicalSession,
} from '../src/client/HealthiaClinicalApi.ts'

const actor={username:'clinician-test',role:'clinician' as const,org:'local-test'}
const session:ClinicalSession={actor,csrf:'b'.repeat(48)}
const visit:ClinicalEncounter={
  id:'00000000-0000-4000-8000-000000000001',
  version:1,patientId:'00000000-0000-4000-8000-000000000002',
  practitioner:actor.username,specialty:'Medicina familiar',
  complaint:'Cefalea',history:'',exam:'',assessment:'',plan:'',status:'draft',
}
function result(body:unknown,status=200) {
  return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
}

describe('PHOENIX clinical API boundary',()=>{
  it('uses only same-origin protected routes with bearer CSRF for mutations',async()=>{
    const requests:Array<{input:string;init:RequestInit}>=[]
    const fake=vi.fn(async (input:string|URL|Request,init?:RequestInit)=>{
      requests.push({input:String(input),init:init!})
      if(String(input).endsWith('/session'))return result({actor,csrf:session.csrf})
      if(String(input).endsWith('/patients'))return init?.method==='GET'
        ?result({items:[{id:visit.patientId,version:1,name:'Paciente Ficticio',dateOfBirth:'2000-01-01'}]})
        :result({record:{id:visit.patientId,version:1,name:'Paciente Ficticio',dateOfBirth:'2000-01-01'}},201)
      if(String(input).endsWith('/encounters'))return result({items:[visit]})
      if(String(input).endsWith('/encounters/'+visit.id))return result({record:{...visit,version:2,history:'Nota'}},200)
      throw Error('unexpected')
    }) as unknown as typeof fetch
    const api=new HealthiaClinicalApi(fake)
    const acquired=await api.session()
    expect(acquired).toEqual(session)
    expect(await api.patients(acquired)).toHaveLength(1)
    expect(await api.createPatient(acquired,{name:'Paciente Ficticio',dateOfBirth:'2000-01-01'})).toMatchObject({id:visit.patientId})
    expect(await api.encounters(acquired)).toHaveLength(1)
    expect(await api.saveEncounter(acquired,visit,{history:'Nota',exam:'',assessment:'',plan:''})).toMatchObject({id:visit.id,version:2})
    expect(requests.every(x=>x.input.startsWith('/health/api/'))).toBe(true)
    expect(requests.every(x=>x.init.credentials==='same-origin'&&x.init.cache==='no-store')).toBe(true)
    expect(requests.filter(x=>x.init.method!=='GET').every(x=> {
      const headers=x.init.headers as Record<string,string>
      return headers['x-phoenix-csrf']===acquired.csrf&&headers['x-phoenix-health']==='1'
    })).toBe(true)
    expect(JSON.stringify(requests)).not.toContain('password')
  })

  it('creates the administrator with six characters and supports safe institution branding',async()=>{
    const calls:Array<{path:string;body?:Record<string,unknown>}>=[]
    const api=new HealthiaClinicalApi(vi.fn(async (path:string,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined
      calls.push({path,...(body===undefined?{}:{body})})
      return result(path.endsWith('/branding')?{logoDataUrl:null}:{initialized:true},200)
    }) as unknown as typeof fetch)
    await expect(api.setup('Clínica Alfa','doctor','12345')).rejects.toThrow('6 caracteres')
    await api.setup('Clínica Alfa','doctor','123456')
    expect(calls.find(x=>x.path.endsWith('/setup'))?.body?.password).toBe('123456')
    expect(await api.branding()).toBeNull()
    expect(await api.updateBranding(session,null)).toBeNull()
    expect(calls.some(x=>x.path.endsWith('/branding')&&x.body?.logoDataUrl===null)).toBe(true)
  })

  it('requires authentic CSRF and authorized identity; never trusts a visual role',async()=>{
    const api=new HealthiaClinicalApi(vi.fn(async()=>result({actor,csrf:'invalid'})) as unknown as typeof fetch)
    await expect(api.session()).rejects.toThrow('CSRF')
    const bad=new HealthiaClinicalApi(vi.fn(async()=>result({actor:{...actor,role:'superuser'},csrf:'b'.repeat(48)})) as unknown as typeof fetch)
    await expect(bad.session()).rejects.toThrow('Identidad')
  })

  it('never claims persistence when the Host rejects or changes the version',async()=>{
    const unauthorized=new HealthiaClinicalApi(vi.fn(async()=>result({error:'not authorized'},403)) as unknown as typeof fetch)
    await expect(unauthorized.saveEncounter(session,visit,{history:'Nota',exam:'',assessment:'',plan:''}))
      .rejects.toMatchObject({status:403})
    const stale=new HealthiaClinicalApi(vi.fn(async()=>result({error:'conflict'},409)) as unknown as typeof fetch)
    await expect(stale.saveEncounter(session,visit,{history:'Nota',exam:'',assessment:'',plan:''}))
      .rejects.toMatchObject({status:409})
    await expect(stale.saveEncounter(session,{...visit,status:'signed'},{history:'Nota',exam:'',assessment:'',plan:''}))
      .rejects.toThrow('firmada')
    await expect(stale.saveEncounter(session,visit,{history:'a'.repeat(4001),exam:'',assessment:'',plan:''}))
      .rejects.toThrow('límite')
    expect(new ProtectedClinicError('Prueba',401).status).toBe(401)
  })

  it('never accepts confirmation for another patient or encounter',async()=>{
    const api=new HealthiaClinicalApi(vi.fn(async()=>result({record:{...visit,version:2,patientId:'someone-else'}})) as unknown as typeof fetch)
    await expect(api.saveEncounter(session,visit,{history:'Nota',exam:'',assessment:'',plan:''}))
      .rejects.toThrow('no coincide')
  })
})

describe('Persistent protected ASK',()=>{
  it('recovers only matching encounter versions and confirms persistence',async()=>{
    let version='1'
    const calls:RequestInit[]=[]
    const api=new HealthiaClinicalApi(vi.fn(async (_path:string,init?:RequestInit)=>{
      calls.push(init!)
      if(init?.method==='GET')return result({draft:{values:{encounterVersion:version,answerKey:'onset',answerText:'Dato ficticio'}}})
      if(init?.method==='PATCH')return result({savedAt:'2026-11-24T12:00:00Z'})
      return result({cleared:true})
    }) as unknown as typeof fetch)
    expect(await api.loadInterviewDraft(session,visit)).toEqual({key:'onset',text:'Dato ficticio'})
    version='2'
    expect(await api.loadInterviewDraft(session,visit)).toBeNull()
    await api.saveInterviewDraft(session,visit,'onset','Dato ficticio')
    expect(JSON.parse(String(calls.at(-1)?.body)).values.encounterVersion).toBe('1')
    expect((calls.at(-1)?.headers as Record<string,string>)['x-phoenix-csrf']).toBe(session.csrf)
    await api.clearInterviewDraft(session,visit)
    expect(calls.at(-1)?.method).toBe('POST')
  })
  it('does not report saved when the clinical host rejects the draft',async()=>{
    const api=new HealthiaClinicalApi(vi.fn(async()=>result({error:'conflict'},409)) as unknown as typeof fetch)
    await expect(api.saveInterviewDraft(session,visit,'onset','Dato ficticio')).rejects.toThrow()
  })
})
