// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { parseClinicalIntake } from '../src/client/HealthiaEditorSupport.ts'
import { HealthiaWorkspace, HEALTHIA_NAV, type HealthiaRole } from '../src/client/HealthiaWorkspace.tsx'

afterEach(() => {cleanup();vi.unstubAllGlobals()})

function ScreenHarness() {
  const [role, setRole] = useState<HealthiaRole>('doctor')
  const [section, setSection] = useState('overview')
  const onReturn = vi.fn()
  return <HealthiaWorkspace role={role} section={section}
    onRoleChange={value => { setRole(value); setSection('overview') }}
    onSectionChange={setSection} onReturn={onReturn} />
}

describe('PHOENIX embedded Healthia', () => {
  it('uses a minimal seven-item clinician menu without duplicate Healthia branding', () => {
    expect(HEALTHIA_NAV.doctor.map(item => item.label)).toEqual([
      'Inicio', 'Agenda', 'Pacientes', 'Consultas', 'Documentos', 'Gestión', 'Herramientas',
    ])
    render(<ScreenHarness />)
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeTruthy()
    expect(screen.queryByText('Healthia')).toBeNull()
    expect(screen.queryByText('Capacidades')).toBeNull()
    expect(screen.queryByText('Intercambios')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Servicio clínico protegido' })).toBeNull()
    expect(screen.queryByText('Información y acceso técnico')).toBeNull()
    fireEvent.click(screen.getByText('Accesos manuales'))
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }))
    fireEvent.click(screen.getByText('Información y acceso técnico'))
    expect(screen.getByRole('link', { name: 'Servicio clínico protegido' }).getAttribute('href')).toBe('/health')
  })

  it('never opens a real clinical encounter without a verified professional session', () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      if (input.endsWith('/health/api/session')) return new Response(JSON.stringify({error:'locked'}), {status:401,headers:{'content-type':'application/json'}})
      if (input.endsWith('/health/api/status')) return new Response(JSON.stringify({initialized:true,enabled:true}), {status:200,headers:{'content-type':'application/json'}})
      throw Error('Unexpected clinical request')
    }))
    render(<ScreenHarness />)
    fireEvent.click(screen.getByRole('button', { name: /Nueva consulta/ }))
    expect(screen.queryByRole('button', { name: 'Guardar consulta' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Historia clínica estructurada' })).toBeNull()
  })

  it('does not authorize the patient portal by a visual role switch', () => {
    render(<ScreenHarness />)
    expect(screen.queryByRole('button', { name: 'Paciente' })).toBeNull()
    fireEvent.click(screen.getByText('Vista: Médico'))
    fireEvent.click(screen.getByRole('button', { name: 'Paciente' }))
    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeTruthy()
    expect(screen.getByText(/no inicia sesión ni concede acceso/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mi expediente' }))
    expect(screen.getByText(/depende de la identidad autenticada/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Autorizaciones' }))
    expect(screen.getByText(/Ningún expediente se comparte/)).toBeTruthy()
  })

  it('keeps a real clinic home and visible named navigation when professional session is locked',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      const uri=String(input)
      if(uri.endsWith('/health/api/session'))return new Response(JSON.stringify({error:'locked'}),{
        status:401,headers:{'content-type':'application/json'},
      })
      if(uri.endsWith('/health/api/status'))return new Response(JSON.stringify({initialized:true,enabled:true}),{
        status:200,headers:{'content-type':'application/json'},
      })
      if(uri.endsWith('/health/api/branding'))return new Response(JSON.stringify({logoDataUrl:null}),{
        status:200,headers:{'content-type':'application/json'},
      })
      throw Error('Una sesión bloqueada no debe acceder a datos: '+uri)
    }))
    render(<ScreenHarness/>)
    expect(screen.getByRole('heading',{name:'Tu jornada clínica, en un solo espacio'})).toBeTruthy()
    expect(screen.getByText('Accesos manuales').closest('details')?.open).toBe(false)
    fireEvent.click(screen.getByText('Accesos manuales'))
    const nav=screen.getByRole('navigation',{name:'Secciones del espacio clínico'})
    expect(within(nav).getByRole('button',{name:'Pacientes'})).toBeTruthy()
    expect(within(nav).getByRole('button',{name:'Consultas'})).toBeTruthy()
    expect(screen.getByRole('navigation',{name:'Accesos clínicos rápidos'})).toBeTruthy()
    expect(screen.getByText('Así trabajará tu clínica')).toBeTruthy()
    expect(screen.queryByText('Pacientes autorizados')).toBeNull()
    expect(screen.queryByText('Reintentar conexión')).toBeNull()
    expect(screen.queryByRole('heading',{name:'Inicio de sesión profesional'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Abrir acceso protegido'}))
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Inicio de sesión profesional'})).toBeTruthy())
  })

  it('authenticates within the home and replaces the access gate with real authorized patients',async()=>{
    let loggedIn=false
    const requested:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(input:string,options?:RequestInit)=>{
      const route=String(input).split('/health/api/')[1]??''
      requested.push(route)
      const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
        status,headers:{'content-type':'application/json'},
      })
      if(route==='session')return loggedIn
        ?reply({actor:{username:'doctor1',role:'clinician',org:'Centro ficticio'},csrf:'a'.repeat(48)})
        :reply({error:'locked'},401)
      if(route==='status')return reply({initialized:true,enabled:true})
      if(route==='branding')return reply({logoDataUrl:null})
      if(route==='login'&&options?.method==='POST'){
        loggedIn=true
        return reply({actor:{username:'doctor1',role:'clinician',org:'Centro ficticio'},csrf:'a'.repeat(48)})
      }
      if(route==='patients')return reply({items:[{
        id:'00000000-0000-4000-8000-000000000001',name:'Paciente Sintético',
        dateOfBirth:'2000-01-01',version:1,
      }]})
      if(route==='appointments')return reply({items:[]})
      throw Error('Unexpected clinical endpoint '+route)
    }))
    render(<ScreenHarness/>)
    fireEvent.click(screen.getByRole('button',{name:'Abrir acceso protegido'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Acceder'})).toBeTruthy())
    expect(requested).not.toContain('patients')
    fireEvent.change(screen.getByRole('textbox',{name:'Usuario profesional'}),{target:{value:'doctor1'}})
    fireEvent.change(screen.getByLabelText('Contraseña'),{target:{value:'password123'}})
    fireEvent.click(screen.getByRole('button',{name:'Acceder'}))
    await waitFor(()=>expect(screen.getByText('Paciente Sintético')).toBeTruthy())
    expect(requested).toContain('patients')
    expect(screen.getByText('Pacientes autorizados')).toBeTruthy()
    expect(screen.queryByRole('heading',{name:'Inicio de sesión profesional'})).toBeNull()
  })

  it('moves the legacy editable form structure into Tools, not the main menu', () => {
    render(<ScreenHarness />)
    fireEvent.click(screen.getByText('Accesos manuales'))
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }))
    expect(screen.queryByRole('textbox', { name: 'Etiqueta de nuevo campo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Editar estructura de formularios' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Etiqueta de nuevo campo' }), {
      target: { value: 'Campo demostrativo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar campo' }))
    expect(screen.getByText('Campo demostrativo')).toBeTruthy()
    expect(screen.getByText(/borradores sin publicar/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Minimizar espacio clínico'}))
    expect(screen.queryByRole('button',{name:'Agregar campo'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Restaurar espacio clínico'}))
    expect(screen.getByText('Campo demostrativo')).toBeTruthy()
    expect(screen.getByRole('button',{name:'Agregar campo'})).toBeTruthy()
  })
})

describe('Protected conversational admission',()=>{
  it('extracts explicit values without deriving a birth date from age',()=>{
    expect(parseClinicalIntake('Crea paciente Ana Pérez, edad: 42 años, sexo: femenino, correo: ana@example.com, lugar de nacimiento: Santiago')).toEqual({
      name:'Ana Pérez',age:'42',sexAtBirth:'female',email:'ana@example.com',birthplace:'Santiago',
    })
  })
  it('rejects invalid dates, contradictory fields and future birth dates',()=>{
    expect(parseClinicalIntake('nombre: Ana, nombre: María, fecha de nacimiento: 2020-02-30, sexo: masculino, sexo: femenino')).toEqual({})
    expect(parseClinicalIntake('fecha de nacimiento: 2999-01-01')).toEqual({})
    expect(parseClinicalIntake('fecha de nacimiento: 1984-03-12')).toEqual({dateOfBirth:'1984-03-12'})
  })
})
