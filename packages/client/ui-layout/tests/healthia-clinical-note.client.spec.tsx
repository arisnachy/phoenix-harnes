// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  HealthiaClinicalNote, clinicalBmi, formatClinicalNote, formatClinicalNoteParts,
  CLINICAL_NOTE_SECTIONS, fieldsForKind,
} from '../src/client/HealthiaClinicalNote.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Healthia clinical note from the supplied legacy intake concepts', () => {
  it('retains personal/family/surgical/obstetric histories and actual illness chronology', () => {
    const ids = new Set(CLINICAL_NOTE_SECTIONS.flatMap(s => s.fields.map(f => f.id)))
    for (const id of ['chief','hea','ros','personal','surgical','family','allergies','medications','gyneco','fum','sys','dia','hr','physical','assessment','differential','plan','tests','followup']) {
      expect(ids.has(id)).toBe(true)
    }
    const history = CLINICAL_NOTE_SECTIONS.find(s => s.id === 'background')!
    expect(fieldsForKind(history, 'obstetric').map(f => f.id)).toContain('fum')
    expect(fieldsForKind(history, 'pediatric').map(f => f.id)).toContain('perinatal')
    expect(fieldsForKind(history, 'first').map(f => f.id)).not.toContain('fum')
  })

  it('only prints supplied clinical facts, with no invented normals, diagnoses or signatures', () => {
    const content = formatClinicalNote('first', {
      chief: 'Cefalea de dos días', hea: 'Inicio gradual, sin documentación adicional.',
      hr: '78', sys: '120', dia: '80',
    })
    expect(content).toContain('BORRADOR SIN FIRMAR')
    expect(content).toContain('Historia de la enfermedad actual: Inicio gradual')
    expect(content).toContain('Frecuencia cardíaca: 78 lpm')
    expect(content).not.toContain('Examen físico por sistemas:')
    expect(content).not.toContain('Alergias declaradas:')
    expect(content).not.toContain('Impresión clínica y razonamiento:')
    expect(content).not.toContain('Diagnóstico definitivo')
    expect(content).toContain('Pendiente de revisión')
  })

  it('calculates BMI from explicit weight and height with unit validation', () => {
    expect(clinicalBmi({ weight: '75', height: '175' })).toBe(24.5)
    expect(clinicalBmi({ weight: '75' })).toBeUndefined()
    expect(clinicalBmi({ weight: '0', height: '175' })).toBeUndefined()
    expect(clinicalBmi({ weight: '75', height: 'abc' })).toBeUndefined()
    expect(formatClinicalNote('first', { weight: '75', height: '175' })).toContain('IMC calculado: 24.5 kg/m²')
  })

  it('splits a complete clinical encounter without losing free text, diagnoses or advice',()=>{
    const long='Enfermedad actual documentada: '+('A'.repeat(5000))
    const sections=formatClinicalNoteParts('first',{
      chief:'Dolor abdominal documentado',hea:long,
      sys:'120',dia:'80',physical:'Exploración física registrada',
      assessment:'Impresión provisional, sujeta a confirmación',
      icd10:'Código por verificar',
      tests:'Estudio a considerar',
      imaging:'Ecografía considerada',
      healthEducation:'Recomendaciones individualizadas',
      followup:'Reevaluación programada',
    })
    expect(sections.history).toContain(long)
    expect(sections.history).not.toContain('Exploración física registrada')
    expect(sections.exam).toContain('Exploración física registrada')
    expect(sections.assessment).toContain('Código por verificar')
    expect(sections.plan).toContain('Ecografía considerada')
    expect(sections.plan).toContain('Recomendaciones individualizadas')
    expect(sections.plan).toContain('Reevaluación programada')
    expect(formatClinicalNote('first',{chief:'Prueba'})).toContain('BORRADOR SIN FIRMAR')
  })

  it('offers structured editable forms, a review-only preview and an explicit discard action', () => {
    render(<HealthiaClinicalNote />)
    expect(screen.getByRole('combobox', { name: 'Tipo de consulta' })).toBeTruthy()
    expect(screen.getByText(/No hay guardado ni firma clínica habilitados/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo de consulta' }), {
      target: { value: 'Dolor abdominal' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Vista previa de nota' }))
    expect(screen.getByRole('region', { name: 'Vista previa clínica' }).textContent).toContain('Dolor abdominal')
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))
    expect(screen.queryByRole('region', { name: 'Vista previa clínica' })).toBeNull()
    expect((screen.getByRole('textbox', { name: 'Motivo de consulta' }) as HTMLInputElement).value).toBe('')
  })
})
