// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { HealthiaWorkspace, type HealthiaRole } from '../src/client/HealthiaWorkspace.tsx'

afterEach(() => cleanup())

function ScreenHarness() {
  const [role, setRole] = useState<HealthiaRole>('doctor')
  const [section, setSection] = useState('overview')
  const onReturn = vi.fn()
  return <HealthiaWorkspace role={role} section={section}
    onRoleChange={value => { setRole(value); setSection('overview') }}
    onSectionChange={setSection} onReturn={onReturn} />
}

describe('Healthia adaptive surface', () => {
  it('offers the authenticated clinical entry without putting patient data in chat', () => {
    render(<ScreenHarness />)
    const entry = screen.getByRole('link', { name: /Abrir servicio clínico protegido/ })
    expect(entry.getAttribute('href')).toBe('/health')
    expect(entry.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText(/Kira y el chat continúan disponibles/)).toBeTruthy()
  })

  it('shows patient preview without claiming portal or medical record access', () => {
    render(<ScreenHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Paciente' }))
    expect(screen.getByText('Portal no activado')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Abrir servicio clínico protegido/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Autorizaciones' }))
    expect(screen.getByText(/Ningún expediente se comparte/)).toBeTruthy()
  })

  it('edits only local draft field labels and keeps future exchange disabled', () => {
    render(<ScreenHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Formularios' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Etiqueta de nuevo campo' }), { target: { value: 'Campo demostrativo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar campo' }))
    expect(screen.getByText('Campo demostrativo')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Intercambios' }))
    expect(screen.getByText(/sin transmisión automática/)).toBeTruthy()
  })
})
