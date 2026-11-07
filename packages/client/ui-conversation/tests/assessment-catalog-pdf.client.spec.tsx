// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { assessmentCatalog, findAssessment } from '../src/client/chat/AssessmentCatalog.ts'
import { buildAssessmentPdfBytes, generateAssessmentPdf } from '../src/client/chat/AssessmentReportPdf.ts'
import { scaleAssessmentReport, smartAssessmentReport } from '../src/client/chat/AssessmentReportModel.ts'
import { parseScaleForm, scoreScale, ScaleForm } from '../src/client/chat/ScaleForm.tsx'
import { starterForms } from '../src/client/chat/SmartFormLibrary.ts'
import { calculateSmartForm, initialSmartValues } from '../src/client/chat/SmartFormEngine.ts'
import { SmartFormWorkspace } from '../src/client/chat/SmartFormSurface.tsx'
afterEach(cleanup)
const identity={
  participant:'Caso de prueba 001',professional:'Dra. Evaluadora, matrícula 123',
  context:'Cribado en consulta; primera entrevista.',observations:'Paciente colaborador.',
  recommendations:'Revisión clínica y seguimiento según evolución.',
}
function answers(specId:string,score:number) {
  const entry=assessmentCatalog.find(item=>item.id===specId)!
  const spec=entry.spec!
  return {spec,values:Object.fromEntries(spec.props.items.map(item=>[
    item.id,item.options.findIndex(option=>option.score===score),
  ]))}
}
const pdfText=(bytes:Uint8Array):string=>Array.from(bytes).map(b=>String.fromCharCode(b)).join('')

describe('professional assessment catalog and complete local PDF',()=>{
  it('supplies full authentic item counts and exact score ranges',()=>{
    const phq=assessmentCatalog.find(x=>x.id==='phq9-es')!
    const gad=assessmentCatalog.find(x=>x.id==='gad7-es')!
    const mini=assessmentCatalog.find(x=>x.id==='mini-cog-register')!
    expect(phq.access).toBe('reproducible')
    expect(phq.spec?.props.items).toHaveLength(9)
    expect(phq.spec?.props.scoring).toMatchObject({min:0,max:27})
    expect(gad.spec?.props.items).toHaveLength(7)
    expect(gad.spec?.props.scoring).toMatchObject({min:0,max:21})
    expect(mini.spec?.props.items).toHaveLength(2)
    expect(mini.access).toBe('external-protocol')
    expect(findAssessment('mini').some(x=>x.id==='mini-cog-register')).toBe(true)
    expect(assessmentCatalog.find(x=>x.id==='moca')?.spec).toBeUndefined()
  })

  it('calculates real PHQ-9 bands without pretending a clinical diagnosis',()=>{
    const {spec,values}=answers('phq9-es',2)
    const a=Object.fromEntries(spec.props.items.map(i=>[i.id,i.options[2]!.score]))
    expect(scoreScale(spec,a).total).toBe(18)
    const report=scaleAssessmentReport(spec,values,identity,true,new Date('2026-11-07T12:00:00Z'))
    expect(report?.score).toBe('18')
    expect(report?.classification).toContain('Moderadamente graves')
    expect(report?.warnings.some(w=>w.includes('ítem 9'))).toBe(true)
    expect(report?.rows).toHaveLength(9)
    expect(report?.rows[0]?.question).toContain('poco interés')
    expect(report?.rows[0]?.answer).toContain('Más de la mitad')
    expect(report?.participant).toContain('Caso de prueba')
    expect(report?.verified).toBe(true)
  })

  it('does not report incomplete questionnaires as completed PDF reports',()=>{
    const {spec,values}=answers('phq9-es',0)
    delete values.q9
    expect(scaleAssessmentReport(spec,values,identity,true)).toBeNull()
  })

  it('produces a parsable PDF 1.4 with every original answer and many pages',()=>{
    const {spec,values}=answers('phq9-es',0)
    const report=scaleAssessmentReport(spec,values,identity,true)!
    const bytes=buildAssessmentPdfBytes(report)
    const content=pdfText(bytes)
    expect(content.startsWith('%PDF-1.4')).toBe(true)
    expect(content).toContain('/Type /Catalog')
    expect(content).toContain('/Type /Pages')
    expect(content).toContain('/Count ')
    expect(content).toContain('xref')
    expect(content).toContain('%%EOF')
    expect(content).toContain('Caso de prueba 001')
    expect(content).toContain('Puntaje: 0')
    expect(content).toContain('9. ')
    expect(content).toContain('ANEXO')
    expect(content).toContain('Dra. Evaluadora')
    const pdf=generateAssessmentPdf(report)
    expect(pdf.type).toBe('application/pdf')
    expect(pdf.size).toBe(bytes.length)
  })

  it('exports a generic mathematical form with actual completed inputs',()=>{
    const bmi=starterForms.find(x=>x.props.id==='calculadora_imc')!
    const values={...initialSmartValues(bmi),peso:70,talla:168}
    const result=calculateSmartForm(bmi,values)
    const report=smartAssessmentReport(bmi,values,result,identity)
    expect(result.ready).toBe(true)
    expect(report?.rows).toHaveLength(2)
    expect(report?.rows[0]?.answer).toBe('70')
    expect(report?.verified).toBe(false)
    expect(buildAssessmentPdfBytes(report!).length).toBeGreaterThan(2000)
  })

  it('renders actual instrument questions and a PDF control after completion',()=>{
    const spec=assessmentCatalog.find(x=>x.id==='gad7-es')!.spec!
    render(<ScaleForm spec={spec} verified />)
    expect(screen.getAllByRole('combobox')).toHaveLength(7)
    const download=screen.getByRole('button',{name:/Generar informe PDF completo/})
    expect(download).toHaveProperty('disabled',true)
    for(const select of screen.getAllByRole('combobox')){
      fireEvent.change(select,{target:{value:'0'}})
    }
    expect(download).toHaveProperty('disabled',false)
    expect(screen.getByText('7 de 7 respuestas')).toBeTruthy()
  })

  it('exposes the real instruments in the universal form library',()=>{
    render(<SmartFormWorkspace />)
    expect(screen.getByText('Instrumentos reales · medicina, psicología y neuropsicología')).toBeTruthy()
    expect(screen.getByText('PHQ-9 · síntomas depresivos')).toBeTruthy()
    expect(screen.getByText('GAD-7 · síntomas de ansiedad')).toBeTruthy()
    expect(screen.getByText('MoCA · evaluación cognitiva')).toBeTruthy()
    const importInput=screen.getByLabelText('Importar instrumento autorizado')
    expect(importInput).toHaveProperty('disabled',true)
    fireEvent.click(screen.getByRole('checkbox',{
      name:/Confirmo que dispongo de autorización/,
    }))
    expect(importInput).toHaveProperty('disabled',false)
  })

  it('rejects incomplete or misleading scoring definitions through native parsing',()=>{
    const phq=assessmentCatalog.find(x=>x.id==='phq9-es')!.spec!
    expect(parseScaleForm(phq)).not.toBeNull()
    expect(parseScaleForm({...phq,props:{...phq.props,
      items:phq.props.items.map((x,i)=>i===1?{...x,options:[]}:x),
    }})).toBeNull()
    expect(()=>buildAssessmentPdfBytes({...scaleAssessmentReport(phq,
      Object.fromEntries(phq.props.items.map(item=>[item.id,0])),identity,true)!,
      rows:[]})).toThrow()
  })
})
