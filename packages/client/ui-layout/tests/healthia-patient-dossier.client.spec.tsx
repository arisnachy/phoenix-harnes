// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HealthiaClinicalApi } from '../src/client/HealthiaClinicalApi.ts'
import type { ClinicalPatient, ClinicalSession } from '../src/client/HealthiaClinicalApi.ts'
import { HealthiaPatientDossier } from '../src/client/HealthiaPatientDossier.tsx'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const patientId='00000000-0000-4000-8000-000000000002'
const otherId='00000000-0000-4000-8000-000000000003'
const patient:ClinicalPatient={
  id:patientId,version:1,name:'Paciente Ejemplo',dateOfBirth:'2000-01-01',
  medicalHistory:{pastMedical:'Asma documentada',currentMedications:'Salbutamol según historia',problems:'Asma'},
  allergyReview:null,
}
const session:ClinicalSession={
  actor:{username:'medico-prueba',role:'clinician',org:'institucion-prueba'},
  csrf:'b'.repeat(48),
}
const answer=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'},
})
const context=(target=patient)=>({
  patient:target,
  encounters:[{id:'e1',patientId,complaint:'Consulta inicial',status:'signed',createdAt:'2026-01-02T00:00:00Z'}],
  orders:[],prescriptions:[],observations:[],followups:[],appointments:[],attachments:[],
  timeline:[{id:'e1',patientId,complaint:'Consulta inicial',createdAt:'2026-01-02T00:00:00Z'}],
  pending:{orders:0,followups:0,attachments:0},
})

describe('PHOENIX Healthia patient dossier',()=>{
  it('renders patient-scoped clinical history and commits versioned medical review directly to Host',async()=>{
    const calls:Array<{path:string;method:string;body?:Record<string,unknown>;csrf?:string}>=[]
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      const path=String(url)
      const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined
      const header=init?.headers as Record<string,string>|undefined
      calls.push({path,method:init?.method??'GET',
        ...(body===undefined?{}:{body}),...(header?.['x-phoenix-csrf']?{csrf:header['x-phoenix-csrf']}:{})})
      if(path.endsWith('/patient-context/'+patientId))return answer({context:context()})
      if(path.endsWith('/patients/'+patientId)&&init?.method==='PATCH')
        return answer({record:{...patient,version:2,medicalHistory:body?.record??patient.medicalHistory}})
      throw Error('Unexpected API call '+path)
    })
    vi.stubGlobal('fetch',fetcher)
    const onPatientUpdated=vi.fn()
    render(<HealthiaPatientDossier session={session} patient={patient} onPatientUpdated={onPatientUpdated}/>)
    await waitFor(()=>expect(screen.getByText('Asma documentada')).toBeTruthy())
    expect(screen.getByText('Consulta inicial')).toBeTruthy()
    expect(screen.getByText('No existe revisión de alergias documentada.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Antecedentes'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Enfermedades y antecedentes patológicos'}),{
      target:{value:'Asma persistente verificada'},
    })
    fireEvent.click(screen.getByRole('button',{name:'Guardar antecedentes revisados'}))
    await waitFor(()=>expect(onPatientUpdated).toHaveBeenCalled())
    const written=calls.find(x=>x.method==='PATCH')
    expect(written?.path).toBe('/health/api/patients/'+patientId)
    expect(written?.csrf).toBe(session.csrf)
    expect(written?.body).toMatchObject({action:'history',version:1,
      record:{pastMedical:'Asma persistente verificada'}})
    expect(calls.every(call=>call.path.startsWith('/health/api/'))).toBe(true)
    expect(window.localStorage.getItem('healthia-record')).toBeNull()
  })

  it('rejects any clinical data linked to another patient, without displaying it',async()=>{
    const wrong={...context(),orders:[{id:'another-order',patientId:otherId,description:'EXTERNAL-SENSITIVE-MARKER'}]}
    vi.stubGlobal('fetch',vi.fn(async()=>answer({context:wrong})))
    render(<HealthiaPatientDossier session={session} patient={patient} onPatientUpdated={vi.fn()}/>)
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('incompatibles'))
    expect(screen.queryByText('EXTERNAL-SENSITIVE-MARKER')).toBeNull()
  })

  it('keeps reception outside longitudinal clinical history',()=>{
    const fetcher=vi.fn()
    vi.stubGlobal('fetch',fetcher)
    render(<HealthiaPatientDossier session={{...session,actor:{...session.actor,role:'reception'}}}
      patient={patient} onPatientUpdated={vi.fn()}/>)
    expect(screen.getByText(/requieren una relación asistencial autorizada/)).toBeTruthy()
    expect(screen.queryByRole('button',{name:'Antecedentes'})).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('Healthia patient API protections',()=>{
  it('never trusts a different patient or a rejected chart update receipt',async()=>{
    const api=new HealthiaClinicalApi(vi.fn(async()=>answer({context:{...context(),patient:{...patient,id:otherId}}})) as unknown as typeof fetch)
    await expect(api.patientContext(session,patientId)).rejects.toThrow('no corresponde')
    const bad=new HealthiaClinicalApi(vi.fn(async()=>answer({record:{...patient,id:otherId}})) as unknown as typeof fetch)
    await expect(bad.updatePatientHistory(session,patient,{pastMedical:'Test'})).rejects.toThrow('no corresponde')
  })
  it('requires an explicit allergy status and sends no unverified negative findings',async()=>{
    const changes:Array<Record<string,unknown>>=[]
    const api=new HealthiaClinicalApi(vi.fn(async(_url:string,init?:RequestInit)=>{
      if(init?.body)changes.push(JSON.parse(String(init.body)) as Record<string,unknown>)
      return answer({record:{...patient,version:2,allergyReview:{status:'none-known',details:''}}})
    }) as unknown as typeof fetch)
    await expect(api.reviewPatientAllergies(session,patient,'documented','')).rejects.toThrow('inválida')
    await api.reviewPatientAllergies(session,patient,'none-known','')
    expect(changes).toEqual([{version:1,action:'allergy-review',status:'none-known',details:''}])
  })
})
