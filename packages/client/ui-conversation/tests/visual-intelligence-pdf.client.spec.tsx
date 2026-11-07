// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildVisualIntelligencePdf, visualIntelligencePdfBlob } from '../src/client/chat/VisualIntelligencePdf.ts'
import { VisualIntelligence } from '../src/client/chat/VisualIntelligence.tsx'
import { parseVisualIntelligence } from '../src/client/chat/VisualIntelligenceContract.ts'

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
function demo(rows=15){
  const input={
    component:'visual_intelligence',version:1,props:{
      id:'informe-proyecto',title:'Comparar formas de organizar un proyecto · DEMO',
      subtitle:'Evaluación transparente de alternativas',
      view:'comparison',
      columns:['Opción','Tiempo estimado','Esfuerzo','Ventaja'],
      rows:Array.from({length:rows},(_,i)=>[
        'Alternativa '+(i+1),i+2+' días','Medio',
        i===rows-1?'Este es el último dato de la tabla y no debe faltar en el PDF':'Menos tareas repetitivas',
      ]),
      metrics:[{label:'Alternativas',value:String(rows),status:'neutral'}],
      labels:['Enero','Febrero','Marzo'],
      series:[{label:'Tareas completadas',values:[4,9,13]}],
      sources:[{title:'Datos de demostración',url:'https://example.org/demo',quality:'unverified'}],
      document:{title:'Conclusión de prueba',content:'Contenido editado\nCon otra línea añadida.'},
    },
  }
  const parsed=parseVisualIntelligence(input)
  if(!parsed)throw Error('Invalid test fixture')
  return parsed
}
function asText(bytes:Uint8Array):string{
  return Array.from(bytes,b=>String.fromCharCode(b)).join('')
}
describe('universal, data-native professional PDF export',()=>{
  it('generates a structurally valid PDF, not the application screenshot',()=>{
    const bytes=buildVisualIntelligencePdf(demo(),{timestamp:new Date('2026-11-07T12:00:00Z')})
    const content=asText(bytes)
    expect(content.startsWith('%PDF-1.4')).toBe(true)
    expect(content).toContain('/Type /Catalog')
    expect(content).toContain('/Type /Pages')
    expect(content).toContain('xref')
    expect(content).toContain('startxref')
    expect(content).toContain('%%EOF')
    expect(content).toContain('INFORME PROFESIONAL')
    expect(content).toContain('Comparar formas de organizar un proyecto')
    expect(content).toContain('INDICADORES PRINCIPALES')
    expect(content).toContain('EVOLUCI')
    expect(content).toContain('REGISTRO DE DATOS')
    expect(content).toContain('Alternativa 15')
    expect(content).toContain('Este es el')
    expect(content).toContain('CONCLUSI')
    expect(content).toContain('https://example.org/demo')
    expect(content).not.toContain('Escribe un mensaje al agente')
    expect(content).not.toContain('Copiar')
    expect(content).not.toContain('Fenix Eclipse')
    expect(content).not.toContain('127.0.0.1')
    expect(content).not.toContain('window.print')
    expect(visualIntelligencePdfBlob(demo()).type).toBe('application/pdf')
  })
  it('paginates all rows and repeats the page header for large tables',()=>{
    const bytes=buildVisualIntelligencePdf(demo(140))
    const content=asText(bytes)
    const count=Number(/\/Type \/Pages \/Kids \[ [^\]]+ \] \/Count (\d+)/.exec(content)?.[1]??0)
    expect(count).toBeGreaterThan(3)
    expect(content).toContain('Alternativa 140')
    expect(content.split('INFORME PROFESIONAL').length-1).toBe(count)
    expect(content).toContain('/Type /Page /Parent')
  })
  it('prevents model values from injecting PDF commands',()=>{
    const source=demo()
    const input={...source,props:{...source.props,
      document:{title:'Ensayo',content:'Prueba ) Tj ET 0 0 re f ( vulnerable\\ test'},
      rows:[['A','(Text)',null,'Cancelación: ¿áéíóú?']]}}
    const spec=parseVisualIntelligence(input)
    expect(spec).not.toBeNull()
    const text=asText(buildVisualIntelligencePdf(spec!))
    expect(text).toContain('\\) Tj ET')
    expect(text).toContain('\\( vulnerable')
    expect(text).not.toContain('Prueba ) Tj ET')
  })
  it('embeds a confirmed live snapshot, but does not fabricate an unavailable one',()=>{
    const source=demo()
    const live=parseVisualIntelligence({...source,props:{...source.props,live:{endpoint:'/api/visual/metrics'}}})!
    const offline=asText(buildVisualIntelligencePdf(live))
    expect(offline).toContain('no existe una lectura confirmada')
    const observed=asText(buildVisualIntelligencePdf(live,{snapshot:{
      metrics:[{label:'Operaciones',value:'31'}],observedAt:'2026-11-07T13:00:00.000Z',
    }}))
    expect(observed).toContain('Operaciones')
    expect(observed).toContain('31')
  })
  it('the print button downloads a PDF file without printing the chat',()=>{
    const created:Blob[]=[]
    const create=vi.fn((blob:Blob)=>{created.push(blob);return 'blob:phoenix-report'})
    const revoke=vi.fn()
    const NativeURL=URL
    vi.stubGlobal('URL',class extends NativeURL {static createObjectURL=create;static revokeObjectURL=revoke})
    const print=vi.spyOn(window,'print').mockImplementation(()=>{})
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    render(<VisualIntelligence spec={demo()}/>)
    fireEvent.click(screen.getByRole('button',{name:'Descargar PDF profesional'}))
    expect(print).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(created[0]?.type).toBe('application/pdf')
    expect(click).toHaveBeenCalledTimes(1)
  })
})
