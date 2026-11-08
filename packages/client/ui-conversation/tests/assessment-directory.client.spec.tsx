// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  assessmentDirectory, searchAssessmentDirectory,
} from '../src/client/chat/AssessmentDirectory.ts'
import { assessmentCatalog } from '../src/client/chat/AssessmentCatalog.ts'
import { scoreScale, scaleProtocolWarnings } from '../src/client/chat/ScaleForm.tsx'
import { SmartFormWorkspace } from '../src/client/chat/SmartFormSurface.tsx'

afterEach(cleanup)

describe('professional evidence-bound instrument directory',()=>{
  it('indexes broad domains with stable unique identifiers',()=>{
    expect(assessmentDirectory.length).toBeGreaterThan(200)
    const ids=new Set(assessmentDirectory.map(x=>x.id))
    expect(ids.size).toBe(assessmentDirectory.length)
    for(const area of ['Neuropsicología','Psicología','Medicina','Rehabilitación','Universal']){
      expect(assessmentDirectory.some(x=>x.area===area)).toBe(true)
    }
  })

  it('does not misrepresent a bibliography as a ready-to-administer test',()=>{
    for(const item of assessmentDirectory){
      expect(item.state).toBe('catalog-only')
      expect(item.version).toBe('Verificar versión oficial')
      expect(item.language).toBe('Confirmar adaptación autorizada')
      expect(item.sourcePortal.startsWith('https://')).toBe(true)
      expect(item).not.toHaveProperty('spec')
    }
    expect(assessmentCatalog.find(x=>x.id==='phq9-es')?.spec?.props.items).toHaveLength(9)
  })

  it('searches across accents, publisher and specialty without remote calls',()=>{
    expect(searchAssessmentDirectory('neuropsicologia','Neuropsicología').length).toBeGreaterThan(0)
    expect(searchAssessmentDirectory('wais','Neuropsicología').length).toBeGreaterThan(0)
    expect(searchAssessmentDirectory('apgar','Medicina').length).toBeGreaterThan(0)
    expect(searchAssessmentDirectory('braden','Psicología')).toHaveLength(0)
    expect(searchAssessmentDirectory('PROMIS','Medicina').length).toBeGreaterThan(0)
    expect(searchAssessmentDirectory('NO_SUCH_INSTRUMENT_347')).toHaveLength(0)
  })

  it('preserves distinct versions of a clinically named instrument',()=>{
    const wells=searchAssessmentDirectory('Wells Score','Medicina')
    expect(wells).toHaveLength(2)
    expect(new Set(wells.map(x=>x.id)).size).toBe(2)
  })

  it('computes complete Apgar, Glasgow and qSOFA using their actual component ranges',()=>{
    const cases=[
      {id:'apgar',items:5,min:0,max:10},
      {id:'glasgow',items:3,min:3,max:15},
      {id:'qsofa',items:3,min:0,max:3},
    ] as const
    for(const test of cases){
      const spec=assessmentCatalog.find(x=>x.id===test.id)?.spec
      expect(spec).toBeDefined()
      if(!spec)continue
      expect(spec.props.items).toHaveLength(test.items)
      expect(spec.props.scoring).toMatchObject({min:test.min,max:test.max})
      expect(scaleProtocolWarnings(spec)).toEqual([])
      const floor=Object.fromEntries(spec.props.items.map(item=>[
        item.id,Math.min(...item.options.map(option=>option.score)),
      ]))
      const ceiling=Object.fromEntries(spec.props.items.map(item=>[
        item.id,Math.max(...item.options.map(option=>option.score)),
      ]))
      expect(scoreScale(spec,floor).total).toBe(test.min)
      expect(scoreScale(spec,ceiling).total).toBe(test.max)
      expect(scoreScale(spec,{}).total).toBeNull()
    }
  })

  it('filters by specialty and paginates without flooding the UI',()=>{
    render(<SmartFormWorkspace />)
    expect(screen.getByLabelText('Directorio profesional de instrumentos')).toBeTruthy()
    const selector=screen.getByRole('combobox',{name:'Filtrar instrumentos por especialidad'})
    fireEvent.change(selector,{target:{value:'Neuropsicología'}})
    expect(screen.getByText(/referencias encontradas/)).toBeTruthy()
    expect(screen.getByRole('button',{name:/Mostrar más instrumentos/})).toBeTruthy()
    expect(screen.queryAllByRole('button',{name:'Preparar instrumento con Kira'})).toHaveLength(0)
    fireEvent.change(selector,{target:{value:'Universal'}})
    expect(screen.getByText(/referencias encontradas/)).toBeTruthy()
  })

  it('can research professional instruments not found among offline references',()=>{
    const onAction=vi.fn()
    render(<SmartFormWorkspace onAction={onAction}/>)
    fireEvent.change(screen.getByRole('searchbox'),{
      target:{value:'Instrumento clínico no listado XYZ'},
    })
    fireEvent.click(screen.getByRole('button',{name:/Investigar este instrumento con Kira/}))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[1]).toBe('submit')
    expect(onAction.mock.calls[0]?.[0]).toContain('No inventes reactivos')
    expect(onAction.mock.calls[0]?.[0]).toContain('Instrumento clínico no listado XYZ')
  })

  it('passes the named instrument and licensing constraints to Kira',()=>{
    const onAction=vi.fn()
    render(<SmartFormWorkspace onAction={onAction}/>)
    const buttons=screen.getAllByRole('button',{name:'Preparar instrumento con Kira'})
    expect(buttons.length).toBe(24)
    fireEvent.click(buttons[0]!)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction.mock.calls[0]?.[1]).toBe('draft')
    expect(onAction.mock.calls[0]?.[0]).toContain('NO inventes preguntas')
    expect(onAction.mock.calls[0]?.[0]).toContain('versión exacta')
  })
})
