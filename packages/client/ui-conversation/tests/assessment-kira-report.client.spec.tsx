// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  registerAssessmentForKira, getAssessmentForKira, createKiraAssessmentPrompt,
  parseAssessmentKiraReport, AssessmentKiraReport,
} from '../src/client/chat/AssessmentKiraReport.tsx'
import { parseGenerativeUiBlock } from '../src/client/chat/GenerativeUi.tsx'
import { buildAssessmentPdfBytes, type AssessmentReportData } from '../src/client/chat/AssessmentReportPdf.ts'

afterEach(cleanup)

const original:AssessmentReportData = {
  title:'Prueba registrada · validación por confirmar',
  discipline:'Medicina',date:'2026-11-07',participant:'Caso A',
  professional:'Profesional tratante',context:'Consulta externa',
  method:'Administración declarada en instrumento',version:'Versión de prueba',
  source:'Fuente pendiente de cotejo',score:'8',range:'0–21',
  classification:'Resultado descriptivo; no diagnóstico.',
  limitations:['No sustituye la evaluación clínica'],warnings:['Versión por verificar'],
  domains:[{label:'Dimensión A',value:'8 (0–21)'}],
  rows:[{question:'Reactivo 1',answer:'Respuesta autorizada',score:8}],
  observations:'Observación registrada',recommendations:'Valorar contexto',
  verified:false,
}
function spec(sessionId:string){
  return {
    component:'assessment_report',version:1,props:{
      sessionId,
      summary:'Resumen de respuestas observadas, sin historia inventada.',
      interpretation:'Interpretación provisional de la medición dentro de sus límites.',
      guidelineBasis:'Manual no verificado para esta versión; no inferir baremos.',
      limitations:'No consta comparación normativa específica.',
      recommendations:'Valoración profesional y contextualización de hallazgos.',
      followUp:'Seguimiento según criterio clínico.',
      references:[],
    },
  }
}
const pdfText=(bytes:Uint8Array):string=>Array.from(bytes).map(b=>String.fromCharCode(b)).join('')
describe('Kira authored assessment reports with protected computed answers',()=>{
  it('retains clinical inputs in memory only and requests an evidence-bound interpretation',()=>{
    const id=registerAssessmentForKira(original)
    expect(getAssessmentForKira(id)?.rows[0]?.answer).toBe('Respuesta autorizada')
    const prompt=createKiraAssessmentPrompt(id,original)
    expect(prompt).toContain('guía oficial')
    expect(prompt).toContain('NO inventes anamnesis')
    expect(prompt).toContain('Versión de prueba')
    expect(prompt).toContain(id)
    expect(prompt).toContain('no vuelvas a incluirlos ni los modifiques')
  })
  it('rejects unsafe links, extra fields, and unsupported report structures',()=>{
    const id=registerAssessmentForKira(original)
    expect(parseAssessmentKiraReport(spec(id))).not.toBeNull()
    expect(parseGenerativeUiBlock(spec(id))).not.toBeNull()
    expect(parseAssessmentKiraReport({...spec(id),props:{
      ...spec(id).props,references:[{title:'Falsa fuente',url:'javascript:alert(1)'}],
    }})).toBeNull()
    expect(parseAssessmentKiraReport({...spec(id),props:{
      ...spec(id).props,references:[{title:'Fuente ficticia',url:'https://example.org/guia'}],
    }})).toBeNull()
    expect(parseAssessmentKiraReport({...spec(id),props:{
      ...spec(id).props,score:'0',
    }})).toBeNull()
  })
  it('emits a complete PDF with Kira analysis and the unmodified original response',()=>{
    const id=registerAssessmentForKira(original)
    const parsed=parseAssessmentKiraReport(spec(id))!
    const before=getAssessmentForKira(id)!
    const bytes=buildAssessmentPdfBytes({
      ...before,kiraNarrative:{
        summary:parsed.props.summary,interpretation:parsed.props.interpretation,
        guidelineBasis:parsed.props.guidelineBasis,limitations:parsed.props.limitations,
        recommendations:parsed.props.recommendations,followUp:parsed.props.followUp,
        references:parsed.props.references,
      },
    })
    const text=pdfText(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('Resumen de respuestas observadas')
    expect(text).toContain('Manual no verificado')
    expect(text).toContain('Reactivo 1')
    expect(text).toContain('Respuesta autorizada')
    expect(text).toContain('ANEXO')
    expect(getAssessmentForKira(id)?.score).toBe('8')
  })
  it('requires professional review to allow PDF export',()=>{
    const id=registerAssessmentForKira(original)
    render(<AssessmentKiraReport spec={parseAssessmentKiraReport(spec(id))!}/>)
    const button=screen.getByRole('button',{name:/Generar PDF profesional/})
    expect(button).toHaveProperty('disabled',true)
    fireEvent.click(screen.getByRole('checkbox',{name:/He revisado los resultados/}))
    expect(button).toHaveProperty('disabled',false)
  })
})
