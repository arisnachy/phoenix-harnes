// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { assessmentCatalog } from '../src/client/chat/AssessmentCatalog.ts'
import {
  removeAssessmentDefinition, saveAssessmentDefinition, savedAssessmentDefinitions,
} from '../src/client/chat/AssessmentDefinitionLibrary.ts'
import { SmartFormWorkspace } from '../src/client/chat/SmartFormSurface.tsx'

afterEach(()=>{
  cleanup()
  localStorage.clear()
})

describe('authorized professional assessment templates',()=>{
  it('persists only explicitly saved, validated source/version protocols',()=>{
    const spec=assessmentCatalog.find(entry=>entry.id==='apgar')!.spec!
    expect(savedAssessmentDefinitions()).toEqual([])
    expect(saveAssessmentDefinition(spec)).toBe(true)
    expect(savedAssessmentDefinitions()).toHaveLength(1)
    expect(savedAssessmentDefinitions()[0]?.props.title).toBe(spec.props.title)
    expect(localStorage.getItem('phoenix.assessment.definitions.v1')).not.toContain('Paciente')
    expect(saveAssessmentDefinition(spec)).toBe(true)
    expect(savedAssessmentDefinitions()).toHaveLength(1)
  })

  it('rejects unversioned definitions and invalid injected patient response keys',()=>{
    const original=assessmentCatalog.find(entry=>entry.id==='apgar')!.spec!
    const invalid={...original,props:{...original.props,version:undefined}}
    expect(saveAssessmentDefinition(invalid)).toBe(false)
    const leaked={...original,props:{...original.props,patientAnswers:{name:'Paciente'}}}
    expect(saveAssessmentDefinition(leaked)).toBe(false)
    expect(savedAssessmentDefinitions()).toHaveLength(0)
  })

  it('ignores tampered storage entries and reports corrupted JSON safely',()=>{
    localStorage.setItem('phoenix.assessment.definitions.v1','{broken')
    expect(savedAssessmentDefinitions()).toEqual([])
    localStorage.setItem('phoenix.assessment.definitions.v1',JSON.stringify([
      {component:'scale_form',version:1,props:{title:'Falsa prueba'}},
    ]))
    expect(savedAssessmentDefinitions()).toEqual([])
  })

  it('restores a saved instrument in the library with explicit deletion',()=>{
    const spec=assessmentCatalog.find(entry=>entry.id==='qsofa')!.spec!
    expect(saveAssessmentDefinition(spec)).toBe(true)
    render(<SmartFormWorkspace />)
    expect(screen.getByRole('button',{
      name:'Abrir autorizado: '+spec.props.title,
    })).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{
      name:'Eliminar instrumento',
    }))
    expect(savedAssessmentDefinitions()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button',{
      name:'Eliminar instrumento (confirmar)',
    }))
    expect(savedAssessmentDefinitions()).toHaveLength(0)
    expect(screen.queryByRole('button',{
      name:'Abrir autorizado: '+spec.props.title,
    })).toBeNull()
  })

  it('never writes answers to persistent assessment templates',()=>{
    const spec=assessmentCatalog.find(entry=>entry.id==='glasgow')!.spec!
    saveAssessmentDefinition(spec)
    const stored=localStorage.getItem('phoenix.assessment.definitions.v1')??''
    expect(stored).toContain('Respuesta ocular')
    expect(stored).not.toContain('participant')
    expect(stored).not.toContain('patient')
    expect(removeAssessmentDefinition(spec)).toBe(true)
    expect(savedAssessmentDefinitions()).toHaveLength(0)
  })
})
