// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HealthiaClinicOperations, restoreClinicalNote } from '../src/client/HealthiaClinicOperations.tsx'
import { formatClinicalNote } from '../src/client/HealthiaClinicalNote.tsx'
import type { ClinicalEncounter } from '../src/client/HealthiaClinicalApi.ts'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const patient={id:'00000000-0000-4000-8000-000000000002',version:1,name:'Paciente de prueba',dateOfBirth:'2000-01-01'}
const baseVisit:ClinicalEncounter={
  id:'00000000-0000-4000-8000-000000000001',version:1,patientId:patient.id,
  practitioner:'doctor-prueba',specialty:'Medicina familiar',complaint:'Cefalea',history:'',
  exam:'',assessment:'',plan:'',status:'draft',
}
const actor={username:'doctor-prueba',role:'clinician',org:'test-org'}
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
})

describe('Native clinic inside PHOENIX (protected Host ownership)',()=>{
  it('creates and documents a patient encounter with verified identity and CSRF',async()=>{
    const calls:Array<{path:string;method:string;body?:Record<string,unknown>;csrf?:string}>=[]
    let createdPatient=false
    let opened=false
    const fetcher=vi.fn(async(input:string,init?:RequestInit)=>{
      const path=String(input).split('/health/api/')[1]!
      const method=init?.method??'GET'
      const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined
      const headers=init?.headers as Record<string,string>|undefined
      calls.push({path,method,...(body===undefined?{}:{body}),...(headers?.['x-phoenix-csrf']===undefined?{}:{csrf:headers['x-phoenix-csrf']})})
      if(path==='session')return answer({actor,csrf:'a'.repeat(48)})
      if(path==='patients'&&method==='GET')return answer({items:createdPatient?[patient]:[]})
      if(path==='patients'&&method==='POST') {createdPatient=true;return answer({record:patient},201)}
      if(path==='encounters'&&method==='GET')return answer({items:opened?[baseVisit]:[]})
      if(path==='encounters'&&method==='POST') {opened=true;return answer({record:baseVisit},201)}
      if(path==='encounters/'+baseVisit.id&&method==='PATCH')return answer({
        record:{...baseVisit,version:2,history:String(body?.history),exam:String(body?.exam),
          assessment:String(body?.assessment),plan:String(body?.plan)},
      })
      throw Error('Unexpected clinical request '+path)
    })
    vi.stubGlobal('fetch',fetcher)
    render(<HealthiaClinicOperations area="patients"/>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar paciente'})).toBeTruthy())
    fireEvent.click(screen.getByRole('button',{name:'Registrar paciente'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Nombre completo'}),{target:{value:patient.name}})
    fireEvent.change(screen.getByLabelText('Fecha de nacimiento'),{target:{value:patient.dateOfBirth}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar paciente'}))
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Paciente registrado'))
    expect(calls.find(x=>x.path==='patients'&&x.method==='POST')?.csrf).toBe('a'.repeat(48))
    cleanup()
    // A newly mounted view retrieves the committed patient; no localStorage record.
    render(<HealthiaClinicOperations area="encounters"/>)
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'Paciente del expediente'})).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox',{name:'Paciente del expediente'}),{target:{value:patient.id}})
    fireEvent.click(screen.getByRole('button',{name:'Nueva consulta'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Motivo de consulta'}),{target:{value:'Cefalea'}})
    fireEvent.click(screen.getByRole('button',{name:'Abrir consulta'}))
    await waitFor(()=>expect(screen.getByRole('region',{name:'Historia clínica estructurada'})).toBeTruthy())
    fireEvent.change(screen.getByRole('textbox',{name:'Historia de la enfermedad actual'}),
      {target:{value:'Inicio gradual de cefalea'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar borrador clínico'}))
    await waitFor(()=>expect(calls.some(x=>x.path==='encounters/'+baseVisit.id&&x.method==='PATCH')).toBe(true))
    const written=calls.find(x=>x.method==='PATCH')!
    expect(written.csrf).toBe('a'.repeat(48))
    expect(String(written.body?.history)).toContain('Inicio gradual de cefalea')
    expect(written.body?.action).toBe('document')
    expect(written.body?.version).toBe(1)
    expect(window.localStorage.getItem('clinical-record')).toBeNull()
  })

  it('keeps institutional settings collapsed and carries a patient into the consultation view',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      const path=String(input).split('/health/api/')[1]!
      if(path==='session')return answer({actor,csrf:'a'.repeat(48)})
      if(path==='patients')return answer({items:[patient]})
      if(path==='encounters')return answer({items:[]})
      if(path==='branding')return answer({logoDataUrl:null})
      throw Error('Unexpected request: '+path)
    }))
    const onPatientChange=vi.fn()
    const onNavigate=vi.fn()
    const view=render(<HealthiaClinicOperations area="patients"
      onPatientChange={onPatientChange} onNavigate={onNavigate}/>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Registrar paciente'})).toBeTruthy())
    expect(screen.queryByText('Logo de la institución')).toBeNull()
    expect(screen.queryByRole('button',{name:'Cerrar sesión clínica'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:/Paciente de prueba/}))
    expect(onPatientChange).toHaveBeenCalledWith(patient.id)
    fireEvent.click(screen.getByRole('button',{name:'Ir a consultas'}))
    expect(onNavigate).toHaveBeenCalledWith('encounters')
    view.unmount()
    render(<HealthiaClinicOperations area="encounters" selectedPatientId={patient.id}/>)
    await waitFor(()=>expect(screen.getByLabelText('Paciente activo')).toBeTruthy())
    expect((screen.getByRole('combobox',{name:'Paciente del expediente'}) as HTMLSelectElement).value).toBe(patient.id)
  })

  it('creates the local administrator with a six-character password and Healthia fallback',async()=>{
    const calls:Array<{path:string;method:string;body?:Record<string,unknown>}>=[]
    const fetcher=vi.fn(async(input:string,init?:RequestInit)=>{
      const path=String(input).split('/health/api/')[1]!
      const method=init?.method??'GET'
      const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:undefined
      calls.push({path,method,...(body===undefined?{}:{body})})
      if(path==='session')return answer({error:'requires login'},401)
      if(path==='status')return answer({initialized:false,enabled:true})
      if(path==='branding')return answer({logoDataUrl:null})
      if(path==='setup'&&method==='POST')return answer({initialized:true},201)
      if(path==='login')return answer({actor:{username:'doctor1',role:'admin',org:'Hospital demo'},csrf:'a'.repeat(48)})
      if(path==='patients')return answer({items:[]})
      if(path==='encounters')return answer({items:[]})
      throw Error('Unexpected request: '+path)
    })
    vi.stubGlobal('fetch',fetcher)
    render(<HealthiaClinicOperations area="patients"/>)
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Inicializar clínica local'})).toBeTruthy())
    expect(screen.getByText('Healthia')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox',{name:'Centro o institución'}),{target:{value:'Hospital demo'}})
    fireEvent.change(screen.getByRole('textbox',{name:'Usuario profesional'}),{target:{value:'doctor1'}})
    fireEvent.change(screen.getByLabelText('Contraseña'),{target:{value:'123456'}})
    fireEvent.click(screen.getByRole('button',{name:'Crear clínica local'}))
    await waitFor(()=>expect(screen.getByText('Sesión profesional activa')).toBeTruthy())
    expect(calls.find(x=>x.path==='setup'&&x.method==='POST')?.body).toMatchObject({
      organization:'Hospital demo',username:'doctor1',password:'123456',
    })
  })

  it('restores a generated note without treating missing fields as negative findings',()=>{
    const entry:ClinicalEncounter={...baseVisit,history:[
      'Primera consulta · BORRADOR SIN FIRMAR','',
      'ENTREVISTA','Motivo de consulta: Cefalea',
      'Historia de la enfermedad actual: Inicio gradual','',
      'EXPLORACIÓN','Peso: 75 kg','Talla: 175 cm','IMC calculado: 24.5 kg/m²','',
      'Pendiente de revisión, vinculación al paciente y firma profesional.',
    ].join('\n')}
    const result=restoreClinicalNote(entry)
    expect(result.values.hea).toBe('Inicio gradual')
    expect(result.values.weight).toBe('75')
    expect(result.values.height).toBe('175')
    expect(result.values.allergies).toBeUndefined()
  })

  it('round-trips multiline illness histories without turning their prose into separate facts',()=>{
    const text='Inicio de cefalea.\nDiagnósticos diferenciales o incertidumbres: texto relatado por el paciente.\n\nSegunda descripción sin hallazgos confirmados.'
    const encounter:ClinicalEncounter={
      ...baseVisit,
      history:formatClinicalNote('first',{chief:'Cefalea',hea:text,allergies:'No documentadas'}),
    }
    const restored=restoreClinicalNote(encounter)
    expect(restored.values.hea).toBe(text)
    expect(restored.values.differential).toBeUndefined()
    expect(restored.values.allergies).toBe('No documentadas')
  })

  it('returns no editable clinical history from a signed record without a session',()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      if(String(input).endsWith('/health/api/session'))return answer({error:'locked'},401)
      return answer({initialized:true,enabled:true})
    }))
    render(<HealthiaClinicOperations area="encounters"/>)
    return waitFor(()=>{
      expect(screen.getByRole('region',{name:'Acceso clínico protegido'})).toBeTruthy()
      expect(screen.queryByRole('button',{name:'Guardar borrador clínico'})).toBeNull()
    })
  })
})
