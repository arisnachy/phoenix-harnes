// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { clinicianDoseCalculation, HealthiaOperationsBoard } from '../src/client/HealthiaOperationsBoard.tsx'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const patientId='00000000-0000-4000-8000-000000000001'
const invoiceId='00000000-0000-4000-8000-000000000002'
const answer=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json'},
})
describe('Healthia real protected operational forms',()=>{
  it('computes arithmetic only from a clinician-provided validated dose',()=>{
    expect(clinicianDoseCalculation(20,10,250)).toBe(200)
    expect(clinicianDoseCalculation(20,20,250)).toBe(250)
    expect(clinicianDoseCalculation(0,20,250)).toBeUndefined()
    expect(clinicianDoseCalculation(20,-1,250)).toBeUndefined()
    expect(clinicianDoseCalculation(20,20,NaN)).toBeUndefined()
  })
  it('creates an internal invoice through the Host with role, CSRF and exact minor units',async()=>{
    const writes:Array<{path:string;body:Record<string,unknown>;csrf:string|undefined}>=[]
    vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
      const path=String(input).split('/health/api/')[1]!
      const method=init?.method??'GET'
      if(path==='session')return answer({actor:{username:'admin',role:'admin',org:'Hospital test'},csrf:'a'.repeat(48)})
      if(path==='patients'&&method==='GET')return answer({items:[{
        id:patientId,version:1,name:'Persona sintética',dateOfBirth:'2000-01-01',
      }]})
      if(path==='encounters')return answer({items:[]})
      if(path==='staff')return answer({items:[]})
      if(path==='assignments')return answer({items:[]})
      if(path==='invoices'&&method==='GET')return answer({items:[]})
      if(path==='invoices'&&method==='POST'){
        const body=JSON.parse(String(init?.body)) as Record<string,unknown>
        const headers=init?.headers as Record<string,string>|undefined
        writes.push({path,body,csrf:headers?.['x-phoenix-csrf']})
        return answer({record:{id:invoiceId,version:1,...body,paidCents:0}},201)
      }
      throw Error('Unexpected route: '+path)
    }))
    render(<HealthiaOperationsBoard section="management"/>)
    await waitFor(()=>expect(screen.getByRole('button',{name:'Guardar registro protegido'})).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox',{name:'Paciente'}),{target:{value:patientId}})
    fireEvent.change(screen.getByRole('textbox',{name:'Servicio o concepto facturable'}),
      {target:{value:'Consulta documentada'}})
    fireEvent.change(screen.getByRole('spinbutton',{name:'Importe en RD$ (comprobante interno)'}),
      {target:{value:'123.45'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar registro protegido'}))
    await waitFor(()=>expect(writes.length).toBe(1))
    expect(writes[0]!.body).toMatchObject({patientId,concept:'Consulta documentada',amountCents:12345})
    expect(writes[0]!.csrf).toBe('a'.repeat(48))
    expect(screen.getByText(/No genera NCF/i)).toBeTruthy()
    expect(window.localStorage.getItem('clinical-invoice')).toBeNull()
  })
  it('isolates billing roles from the professional patient and consultation APIs',async()=>{
    const requests:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      const path=String(input).split('/health/api/')[1]!
      requests.push(path)
      if(path==='session')return answer({actor:{username:'billing1',role:'billing',org:'Hospital test'},csrf:'b'.repeat(48)})
      if(path==='patient-options')return answer({items:[{id:patientId,name:'Persona sintética'}]})
      if(path==='invoices')return answer({items:[]})
      throw Error('Billing accessed forbidden route: '+path)
    }))
    render(<HealthiaOperationsBoard section="management"/>)
    await waitFor(()=>expect(screen.getByRole('combobox',{name:'Paciente'})).toBeTruthy())
    expect(requests).toContain('patient-options')
    expect(requests).not.toContain('patients')
    expect(requests).not.toContain('encounters')
    expect(screen.queryByRole('button',{name:'Equipo y asignaciones'})).toBeNull()
  })
})
