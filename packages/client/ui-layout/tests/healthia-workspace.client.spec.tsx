// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
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

  it('moves the legacy editable form structure into Tools, not the main menu', () => {
    render(<ScreenHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Herramientas' }))
    expect(screen.queryByRole('textbox', { name: 'Etiqueta de nuevo campo' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Editar estructura de formularios' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Etiqueta de nuevo campo' }), {
      target: { value: 'Campo demostrativo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar campo' }))
    expect(screen.getByText('Campo demostrativo')).toBeTruthy()
    expect(screen.getByText(/borradores sin publicar/)).toBeTruthy()
  })
})
