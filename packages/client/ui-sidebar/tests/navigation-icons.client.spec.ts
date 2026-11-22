// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  choosePhoenixNavigationIcon, phoenixNavigationIconScope, readPhoenixNavigationIcons,
  writePhoenixNavigationIcon, PHOENIX_NAVIGATION_ICON_CHOICES, isPhoenixUiIconName,
} from '@phoenix-ai/dsh-client-ui-primitives'

afterEach(() => {
  window.localStorage.removeItem('phoenix.navigation-icons.v1')
})

describe('PHOENIX semantic navigation icons', () => {
  it('uses stable Healthia IDs independent of translated labels and roles', () => {
    expect(choosePhoenixNavigationIcon('healthia', 'patient', 'appointments', 'Réservations')).toBe('calendar-days')
    expect(choosePhoenixNavigationIcon('healthia', 'patient', 'records', 'Mi expediente')).toBe('clipboard-list')
    expect(choosePhoenixNavigationIcon('healthia', 'patient', 'consent', 'Autorizaciones')).toBe('shield-check')
    expect(choosePhoenixNavigationIcon('healthia', 'doctor', 'patients', 'Pacientes')).toBe('users')
    expect(choosePhoenixNavigationIcon('healthia', 'doctor', 'encounters', 'Consultas')).toBe('stethoscope')
    expect(choosePhoenixNavigationIcon('healthia', 'doctor', 'documents', 'Documentos')).toBe('files')
    expect(choosePhoenixNavigationIcon('healthia', 'doctor', 'tools', 'Herramientas')).toBe('wrench')
  })

  it('classifies generated sections semantically with a bundled safe fallback', () => {
    expect(choosePhoenixNavigationIcon('app-presupuesto', 'doctor', 'first', 'Presupuesto anual')).toBe('wallet')
    expect(choosePhoenixNavigationIcon('app-deportes', 'doctor', 'match', 'Resultados NBA')).toBe('basketball')
    expect(choosePhoenixNavigationIcon('app-example', 'doctor', 'custom', 'XYZ sin significado')).toBe('layout-grid')
    expect(PHOENIX_NAVIGATION_ICON_CHOICES.every(item => isPhoenixUiIconName(item.name))).toBe(true)
  })

  it('persists only validated user choices; restores automatic icons', () => {
    expect(phoenixNavigationIconScope('healthia', 'patient', 'appointments')).toBe('healthia.patient.appointments')
    const saved = writePhoenixNavigationIcon('healthia', 'patient', 'appointments', 'trophy')
    expect(choosePhoenixNavigationIcon('healthia', 'patient', 'appointments', 'Citas', saved)).toBe('trophy')
    expect(readPhoenixNavigationIcons()['healthia.patient.appointments']).toBe('trophy')
    const cleared = writePhoenixNavigationIcon('healthia', 'patient', 'appointments', undefined)
    expect(choosePhoenixNavigationIcon('healthia', 'patient', 'appointments', 'Citas', cleared)).toBe('calendar-days')
  })

  it('rejects arbitrary icon code and malformed stored overrides', () => {
    expect(() => writePhoenixNavigationIcon('healthia', 'doctor', 'tools', '<svg onload=alert(1)>')).toThrow('NAVIGATION_ICON_INVALID_NAME')
    expect(() => writePhoenixNavigationIcon('invalid.app', 'doctor', 'records', 'users')).toThrow('NAVIGATION_ICON_INVALID_SCOPE')
    window.localStorage.setItem('phoenix.navigation-icons.v1', JSON.stringify({
      version: 1, icons: { 'healthia.doctor.tools': 'not-an-icon-or-svg' },
    }))
    expect(readPhoenixNavigationIcons()).toEqual({})
    expect(choosePhoenixNavigationIcon('healthia', 'doctor', 'tools', 'Herramientas')).toBe('wrench')
  })
})
