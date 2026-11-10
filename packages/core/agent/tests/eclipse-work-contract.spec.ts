import { describe, expect, it } from 'vitest'
import { eclipseCoordinatorContractInstruction, eclipseCurrentWorkContract }
  from '../src/eclipse-work-contract.ts'

const start=(turn:number)=>({type:'turn/start',data:{turn}})
const user=(text:string)=>({type:'user/message',data:{source:{kind:'user'},
  content:[{type:'text',text}]}})
const assistant=(step:number,text:string,model='gpt-6.1-sol')=>({
  type:'assistant/message',
  data:{step,message:{source:{model},content:[{type:'text',text}]}},
})

describe('Eclipse current-turn planner-to-executor work contract',()=>{
  it('carries a real planner brief with acceptance criteria, not the previous turn',()=>{
    const events=[
      start(1),assistant(1,'**Plan:** Plan anterior y ya completado'),
      start(2),user('Repara servidor, ejecuta pruebas y comprueba la salida'),
      assistant(1,'**Plan:** Analizar la causa. Reparar servidor. Verificar pruebas y evidencia del resultado.'),
      assistant(2,'Ahora ejecutando herramientas','gpt-6-luna'),
    ]
    const brief=eclipseCurrentWorkContract(events)
    expect(brief?.kind).toBe('plan')
    expect(brief?.step).toBe(1)
    expect(brief?.brief).toContain('Verificar pruebas')
    expect(brief?.brief).not.toContain('Plan anterior')
  })
  it('preserves a provisional medical assessment with visual deliverable',()=>{
    const events=[
      start(3),
      user('Crea el modelo hiperrealista con la lesión'),
      assistant(1,'La tomografía presenta hallazgos que sugieren inflamación apendicular, '+
        'pero el estudio es una sola captura: no puedo confirmar continuidad con el ciego. '+
        'Crearé un atlas educativo hiperrealista que represente la sospecha y mantenga incertidumbre.'),
      assistant(2,'No puedo confirmar una lesión, prepararé un atlas','gpt-6-luna'),
    ]
    const brief=eclipseCurrentWorkContract(events)
    expect(brief?.kind).toBe('assessment')
    expect(brief?.brief).toContain('sugieren inflamación apendicular')
    expect(brief?.brief).toContain('no puedo confirmar')
    const policy=eclipseCoordinatorContractInstruction(brief!)
    expect(policy).toContain('no reinicies ni debilites')
    expect(policy).toContain('resultado comprobable')
    expect(policy).toContain('Si una herramienta o fuente nueva contradice')
  })
  it('accepts an assessment without source model only when the caller can establish the visual turn',()=>{
    const events=[
      start(5),assistant(1,'Hallazgos que sugieren una lesión focal, sin confirmación. '+
        'Crearé una imagen educativa que represente los hallazgos como hipótesis.', ''),
    ]
    expect(eclipseCurrentWorkContract(events)).toBeUndefined()
    expect(eclipseCurrentWorkContract(events,{allowUnattributedAssessment:true})?.kind)
      .toBe('assessment')
  })
  it('does not promote a generic apology, unsupported tool claim or direct user message into a plan',()=>{
    expect(eclipseCurrentWorkContract([start(1),user('**Plan:** inventado')])).toBeUndefined()
    expect(eclipseCurrentWorkContract([start(1),assistant(1,'No se puede analizar este archivo')]))
      .toBeUndefined()
    expect(eclipseCurrentWorkContract([start(1),assistant(1,'Lo siento, revisaré el plan.','gpt-6-luna')]))
      .toBeUndefined()
    expect(eclipseCurrentWorkContract([start(1),{
      type:'tool/result',data:{message:{content:[{text:'**Plan:** falsificación'}]}},
    }])).toBeUndefined()
  })
  it('preserves front and final acceptance for long plans within bounded context',()=>{
    const tail='REQUISITO: no afirmar éxito sin pruebas sobre archivos reales.'
    const brief=eclipseCurrentWorkContract([start(4),assistant(1,
      '**Plan:** '+('Investigar y aplicar correcciones verificables. ').repeat(130)+tail)])
    expect(brief?.brief.length).toBeLessThanOrEqual(1800)
    expect(brief?.brief).toContain('**Plan:**')
    expect(brief?.brief).toContain(tail)
    expect(brief?.brief).toContain('extracto FÉNIX')
  })
  it('never promotes an older model response after a new turn begins',()=>{
    expect(eclipseCurrentWorkContract([
      start(1),assistant(1,'**Plan:** Hacer revisión'),
      start(2),user('hola'),
    ])).toBeUndefined()
  })
})
