// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { canApplyClinicalAction, publicClinicalEditorState, type ClinicalEditorViewState } from '../src/client/HealthiaEditorSupport.ts'
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

  it('separates vitals and requires explicit confirmation before filling the current encounter',()=>{
    render(<HealthiaClinicalNote />)
    fireEvent.click(screen.getByRole('button',{name:'Signos vitales'}))
    expect(screen.queryByRole('textbox',{name:'Examen físico por sistemas'})).toBeNull()
    fireEvent.change(screen.getByRole('textbox',{name:'Entrada rápida de mediciones'}),{
      target:{value:'PA 120/80, pulso 76, temperatura 36.7 °C, peso 72 kg, talla 170 cm'},
    })
    fireEvent.click(screen.getByRole('button',{name:'Extraer mediciones'}))
    const systolic=screen.getByRole('spinbutton',{name:/Presión sistólica/}) as HTMLInputElement
    expect(systolic.value).toBe('')
    fireEvent.click(screen.getByRole('button',{name:'Confirmar mediciones actuales'}))
    expect(systolic.value).toBe('120')
    expect(screen.getByText('93.3 mmHg')).toBeTruthy()
    expect(screen.getByText('24.9 kg/m²')).toBeTruthy()
  })
  it('recovers prior history only into empty fields and does not carry previous vital values',()=>{
    render(<HealthiaClinicalNote initialValues={{personal:'Historia actual'}}
      patient={{medicalHistory:{pastMedical:'Anterior',familyHistory:'Historia familiar',weight:'88'}}}/>)
    fireEvent.click(screen.getByRole('button',{name:'Antecedentes'}))
    fireEvent.click(screen.getByRole('button',{name:'Recuperar antecedentes previos'}))
    expect((screen.getByRole('textbox',{name:'Antecedentes personales patológicos'}) as HTMLTextAreaElement).value).toBe('Historia actual')
    expect((screen.getByRole('textbox',{name:'Heredofamiliares'}) as HTMLTextAreaElement).value).toBe('Historia familiar')
    fireEvent.click(screen.getByRole('button',{name:'Signos vitales'}))
    expect((screen.getByRole('spinbutton',{name:/Peso/}) as HTMLInputElement).value).toBe('')
  })
  it('requires authorization and explicit acceptance of a field model suggestion',async()=>{
    const model={id:'ollama/test',label:'Modelo de prueba',location:'local' as const}
    const refine=vi.fn(async()=>({text:'Relato revisado',numericWarnings:[],provider:'ollama',model:'test'}))
    render(<HealthiaClinicalNote initialValues={{hea:'Relato original'}} encounterVersion={1}
      loadModels={async()=>[model]} refineField={refine}/>)
    fireEvent.click(screen.getAllByRole('button',{name:/Mejorar con IA/})[1]!)
    await waitFor(()=>expect(screen.getByRole('checkbox')).toBeTruthy())
    expect((screen.getByRole('button',{name:'Generar propuesta'}) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button',{name:'Generar propuesta'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Aceptar texto revisado'})).toBeTruthy())
    const field=screen.getByRole('textbox',{name:'Historia de la enfermedad actual'}) as HTMLTextAreaElement
    expect(field.value).toBe('Relato original')
    expect(refine).toHaveBeenCalledWith('hea','Relato original',model,true)
    fireEvent.click(screen.getByRole('button',{name:'Aceptar texto revisado'}))
    expect(field.value).toBe('Relato revisado')
  })
  it('discards an asynchronous suggestion when the clinician edits its source',async()=>{
    const model={id:'ollama/test',label:'Modelo de prueba',location:'local' as const}
    let resolve!:(result:{text:string;numericWarnings:string[];provider:string;model:string})=>void
    const refine=()=>new Promise<{text:string;numericWarnings:string[];provider:string;model:string}>(r=>{resolve=r})
    render(<HealthiaClinicalNote initialValues={{hea:'Relato original'}} encounterVersion={1} loadModels={async()=>[model]} refineField={refine}/>)
    fireEvent.click(screen.getAllByRole('button',{name:/Mejorar con IA/})[1]!)
    await waitFor(()=>expect(screen.getByRole('checkbox')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button',{name:'Generar propuesta'}))
    fireEvent.change(screen.getByRole('textbox',{name:'Historia de la enfermedad actual'}),{target:{value:'Relato nuevo'}})
    resolve({text:'Propuesta caducada',numericWarnings:[],provider:'ollama',model:'test'})
    await waitFor(()=>expect(screen.getByText(/propuesta fue descartada/)).toBeTruthy())
    expect(screen.queryByRole('button',{name:'Aceptar texto revisado'})).toBeNull()
  })

  it('never exposes the active encounter binding or data in public inspection',()=>{
    const v:ClinicalEditorViewState={step:'interview',binding:'mount-A:1',visibleFieldIds:['hea'],filledFields:1,
      dirty:false,hasEncounter:true,canEdit:true,modelEnabled:true}
    expect(canApplyClinicalAction(v,'mount-A:1')).toBe(true)
    expect(canApplyClinicalAction(v,'mount-B:1')).toBe(false)
    expect(canApplyClinicalAction({...v,binding:'mount-A:2'},v.binding)).toBe(false)
    expect(canApplyClinicalAction({...v,canEdit:false},v.binding)).toBe(false)
    expect(publicClinicalEditorState(v)).not.toHaveProperty('binding')
  })
  it('prepares a contextual review only after model consent, without overwriting any field',async()=>{
    const model={id:'ollama/test',label:'Modelo de prueba',location:'local' as const}
    const refine=vi.fn(async()=>({text:'Hipótesis a verificar y pregunta pendiente',numericWarnings:[],provider:'ollama',model:'test'}))
    render(<HealthiaClinicalNote initialValues={{hea:'Relato original',personal:'Antecedente documentado'}}
      encounterVersion={1} onSave={async()=>{}} loadModels={async()=>[model]} refineField={refine}/>)
    fireEvent.click(screen.getByRole('button',{name:'Diagnóstico'}))
    fireEvent.click(screen.getByRole('button',{name:'Analizar contexto de la consulta'}))
    await waitFor(()=>expect(screen.getByRole('checkbox')).toBeTruthy())
    expect(refine).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button',{name:'Generar propuesta'}))
    await waitFor(()=>expect(screen.getByText('Hipótesis a verificar y pregunta pendiente')).toBeTruthy())
    expect(refine).toHaveBeenCalledWith('context-review',expect.stringContaining('Antecedente documentado'),model,true)
    expect(screen.queryByRole('button',{name:'Aceptar texto revisado'})).toBeNull()
    expect((screen.getByRole('textbox',{name:'Impresión clínica y razonamiento'}) as HTMLTextAreaElement).value).toBe('')
  })
})
