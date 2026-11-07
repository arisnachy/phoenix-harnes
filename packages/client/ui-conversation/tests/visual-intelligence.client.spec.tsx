// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VisualIntelligence } from '../src/client/chat/VisualIntelligence.tsx'
import {
  auditVisualIntelligence, chooseVisualView, isVisualImageUrl, isVisualLiveEndpoint,
  parseVisualIntelligence, visualCsv, visualExcelXml,
} from '../src/client/chat/VisualIntelligenceContract.ts'
import { parseGenerativeUiBlock, splitGenerativeUiText } from '../src/client/chat/GenerativeUi.tsx'

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
beforeEach(()=>{localStorage.clear()})
const base={
  component:'visual_intelligence',version:1,props:{
    id:'consultorio_general',title:'Inteligencia del consultorio',view:'auto',
    columns:['Servicio','Pacientes','Costo'],
    rows:[['Medicina',12,700],['Psicología',8,850],['Pediatría',6,950]],
    sources:[{title:'Registro local de prueba',url:'https://upload.wikimedia.org/'}],
  },
}
function parsed(v:unknown){
  const result=parseVisualIntelligence(v)
  if(!result)throw new Error('Fixture incompatible con el contrato')
  return result
}
describe('visual intelligence contract',()=>{
  it('detects a safe and bounded universal generative UI in the chat parser',()=>{
    expect(parseVisualIntelligence(base)).not.toBeNull()
    expect(parseGenerativeUiBlock(base)?.component).toBe('visual_intelligence')
    const fence=String.fromCharCode(96).repeat(3)
    const source='Resumen.\n\n'+fence+'generative-ui\n'+JSON.stringify(base)+'\n'+fence+'\n\nDetalles.'
    expect(splitGenerativeUiText(source).map(x=>x.kind)).toEqual(['markdown','ui','markdown'])
    expect(chooseVisualView(parsed(base).props)).toBe('comparison')
  })
  it('chooses chart, gallery, map, document or dashboard deterministically',()=>{
    const p=parsed(base).props
    expect(chooseVisualView({...p,rows:[],columns:[],
      labels:['a','b'],series:[{label:'Incidencia',values:[3,8]}]})).toBe('chart')
    expect(chooseVisualView({...p,rows:[],columns:[],
      media:[{kind:'image',title:'Figura',url:'https://upload.wikimedia.org/test.png'}]})).toBe('gallery')
    expect(chooseVisualView({...p,rows:[],columns:[],
      places:[{label:'Santiago',lat:19.45,lng:-70.7}]})).toBe('map')
    expect(chooseVisualView({...p,rows:[],columns:[],
      document:{title:'Informe',content:'Resumen'}})).toBe('document')
    expect(chooseVisualView({...p,rows:[],columns:[],
      metrics:[{label:'Usuarios',value:'20'}]})).toBe('dashboard')
  })
  it('rejects scripts, extra properties, injection URLs, invalid geography and malformed series',()=>{
    const wrap=(props:Record<string,unknown>)=>parseVisualIntelligence({...base,props})
    const p=base.props
    expect(wrap({...p,onclick:'run()'})).toBeNull()
    expect(wrap({...p,id:'../secret'})).toBeNull()
    expect(wrap({...p,live:{endpoint:'https://evil.test/secret'}})).toBeNull()
    expect(wrap({...p,sources:[{title:'Bad',url:'javascript:alert(1)'}]})).toBeNull()
    expect(wrap({...p,places:[{label:'invalido',lat:120,lng:2}]})).toBeNull()
    expect(wrap({...p,labels:['A','B'],series:[{label:'Tasa',values:[1,Infinity]}]})).toBeNull()
    expect(wrap({...p,media:[{kind:'image',title:'tracker',url:'https://evil.test/pixel.png'}]})).toBeNull()
    expect(wrap({...p,actions:[{label:'Ejecutar',prompt:'Tarea',onClick:'unsafe'}]})).toBeNull()
    expect(isVisualImageUrl('https://images.nasa.gov/planet.jpg')).toBe(true)
    expect(isVisualImageUrl('https://images.nasa.gov.evil.test/tracker.jpg')).toBe(false)
    expect(isVisualLiveEndpoint('/api/phoenix/metrics')).toBe(true)
    expect(isVisualLiveEndpoint('//evil.test/a')).toBe(false)
    expect(isVisualLiveEndpoint('/api/../private')).toBe(false)
  })
  it('audits missing provenance and prevents spreadsheet formula injection',()=>{
    const c=parsed({...base,props:{...base.props,labels:['A','B'],series:[{label:'Casos',values:[1,2]}],sources:undefined}})
    expect(auditVisualIntelligence(c)).toContain('La gráfica no incluye fuentes verificables.')
    const csv=visualCsv(['Nombre','Valor'],[['=HYPERLINK("https://bad")',15],['+sum(1,2)',20]])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+sum(1,2)")
    const xml=visualExcelXml(['Nombre'],[['<img onerror=bad>']])
    expect(xml).toContain('&lt;img')
    expect(xml).not.toContain('<img')
  })
})
describe('rendered interactive visual intelligence',()=>{
  it('filters sorts groups and pages tables without round trips',()=>{
    const rows=Array.from({length:36},(_,i)=>['Especialidad '+(i+1),i%3,100+i])
    const spec=parsed({...base,props:{...base.props,rows,view:'table'}})
    render(<VisualIntelligence spec={spec}/>)
    expect(screen.getByText(/36 de 36 filas/)).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox',{name:'Buscar en tabla'}),{target:{value:'Especialidad 17'}})
    expect(screen.getByText(/1 de 36 filas/)).not.toBeNull()
    expect(screen.getByText('Especialidad 17')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox',{name:'Buscar en tabla'}),{target:{value:''}})
    fireEvent.change(screen.getByRole('combobox',{name:'Agrupar por'}),{target:{value:'1'}})
    expect(screen.getByLabelText('Grupos calculados')).not.toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Siguiente'}))
    expect(screen.getByText(/Página 2\/4/)).not.toBeNull()
  })
  it('explores numeric series with point selection and range controls',()=>{
    const spec=parsed({...base,props:{...base.props,columns:undefined,rows:undefined,view:'auto',
      labels:['Enero','Febrero','Marzo'],series:[{label:'Casos',values:[12,18,11]}]}})
    const {container}=render(<VisualIntelligence spec={spec}/>)
    expect(container.querySelector('[data-selected-view="chart"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Febrero'}))
    expect(screen.getByText(/18 · Casos/)).not.toBeNull()
    fireEvent.change(screen.getByRole('combobox',{name:'Tipo de gráfico'}),{target:{value:'bar'}})
    expect(container.querySelector('rect')).not.toBeNull()
  })
  it('renders trusted media with selectable carousel and bento layouts',()=>{
    const items=[
      {title:'Corazón',kind:'image',url:'https://upload.wikimedia.org/heart.png'},
      {title:'Documentación',kind:'document',url:'https://example.org/readme'},
      {title:'Video',kind:'video',url:'https://example.org/demo'},
      {title:'Producto',kind:'product',url:'https://example.org/product'},
    ]
    const spec=parsed({...base,props:{...base.props,columns:undefined,rows:undefined,media:items}})
    const {container}=render(<VisualIntelligence spec={spec}/>)
    expect(container.querySelector('[data-selected-view="bento"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Siguiente'}))
    expect(screen.getByText('2 / 4')).not.toBeNull()
    expect(screen.getByRole('link',{name:'Abrir fuente externa'}).getAttribute('href')).toBe('https://example.org/readme')
    fireEvent.click(screen.getByRole('button',{name:'Vista carrusel'}))
    expect(screen.getByRole('button',{name:'Vista Bento'})).not.toBeNull()
  })
  it('edits a document and offers version control and export',()=>{
    const spec=parsed({...base,props:{...base.props,columns:undefined,rows:undefined,document:{title:'Informe de prueba',content:'Versión original'}}})
    render(<VisualIntelligence spec={spec}/>)
    fireEvent.change(screen.getByRole('textbox',{name:'Contenido editable'}),{target:{value:'Texto revisado'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar versión'}))
    expect(screen.getByText(/revisión 2/)).not.toBeNull()
    expect(screen.getByRole('textbox',{name:'Contenido editable'})).toHaveProperty('value','Texto revisado')
  })
  it('shows evidence without claiming independent verification and disables unauthorised actions',()=>{
    const spec=parsed({...base,props:{...base.props,columns:undefined,rows:undefined,
      metrics:[{label:'Pacientes',value:'9',status:'positive'}],
      actions:[{label:'Enviar a Kira',prompt:'Analiza estos datos',mode:'draft'}],
      sources:[{title:'Referencia declarada',url:'https://example.org/report',quality:'unverified'}]}})
    const {container}=render(<VisualIntelligence spec={spec}/>)
    expect(container.querySelector('[data-selected-view="dashboard"]')).not.toBeNull()
    expect(screen.getByText(/presencia no implica validación independiente/)).not.toBeNull()
    expect((screen.getByRole('button',{name:'Enviar a Kira'}) as HTMLButtonElement).disabled).toBe(true)
  })
  it('routes authorized external action only after user clicks',()=>{
    const action=vi.fn()
    const spec=parsed({...base,props:{...base.props,actions:[{label:'Preparar',prompt:'Preparar informe',mode:'draft'}]}})
    render(<VisualIntelligence spec={spec} onAction={action}/>)
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button',{name:'Preparar'}))
    expect(action).toHaveBeenCalledWith('Preparar informe','draft')
  })
  it('does not claim live data until same-origin endpoint responds',async()=>{
    const response={ok:true,json:async()=>({metrics:[{label:'Ventas',value:'24'}]})}
    const fetcher=vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch',fetcher)
    const spec=parsed({...base,props:{...base.props,columns:undefined,rows:undefined,live:{endpoint:'/api/visual/live',intervalSeconds:120}}})
    render(<VisualIntelligence spec={spec}/>)
    await waitFor(()=>expect(screen.getByText('24')).not.toBeNull())
    expect(fetcher).toHaveBeenCalledWith('/api/visual/live',expect.objectContaining({credentials:'same-origin',cache:'no-store'}))
    expect(screen.getByText(/Última actualización real:/)).not.toBeNull()
  })
})


describe('model-authored JSON recovery and view routing', () => {
  const modelData = {
    component: 'visual_intelligence', version: 1,
    props: {
      id: 'demo-panel-proyectos', title: 'Panel interactivo de proyectos',
      view: 'auto',
      metrics: [
        { label: 'Tareas abiertas', value: 12, status: 'normal' },
        { label: 'En riesgo', value: '2', status: 'warning' },
        { label: 'Avance promedio', value: '68%', status: 'normal' },
      ],
      labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'],
      series: [{ label: 'Tareas completadas', values: [3, 4, 2, 5, 6] }],
      columns: ['Proyecto', 'Estado'], rows: [['A', 'Activo'], ['B', 'Pendiente']],
    },
  }
  it('recovers the exact status and numeric shorthand seen in the screenshot', () => {
    const fixed = parsed(modelData)
    expect(fixed.props.metrics?.[0]).toMatchObject({ label: 'Tareas abiertas', value: '12', status: 'neutral' })
    expect(fixed.props.metrics?.[2]?.status).toBe('neutral')
    expect(chooseVisualView(fixed.props)).toBe('dashboard')
    const delimiter = String.fromCharCode(96).repeat(3)
    const answer = ['Aquí tienes el panel interactivo.', delimiter + 'generative-ui', JSON.stringify(modelData), delimiter, 'Ahora puedes explorarlo.'].join('\n')
    const segments = splitGenerativeUiText(answer)
    expect(segments.map(s => s.kind)).toEqual(['markdown', 'ui', 'markdown'])
    expect(segments[1]).toMatchObject({ kind: 'ui', block: { component: 'visual_intelligence' } })
    expect(segments.some(s => s.kind === 'markdown' && s.text.includes('"component"'))).toBe(false)
  })
  it('normalizes safe, recognized intent aliases without dropping data', () => {
    const normalized = parsed({...modelData,props:{...modelData.props,id:'Panel General',view:'gráfica',
      metrics:[{label:'Operaciones',value:123,status:'ÉXITO'}]}})
    expect(normalized.props.id).toBe('panel-general')
    expect(normalized.props.view).toBe('chart')
    expect(normalized.props.metrics?.[0]).toMatchObject({value:'123',status:'positive'})
  })
  it('chooses a matching visualization when multiple datasets exist', () => {
    const p=parsed(modelData).props
    expect(chooseVisualView({...p,title:'Tabla de proyectos'})).toBe('table')
    expect(chooseVisualView({...p,title:'Comparación entre proyectos'})).toBe('comparison')
    expect(chooseVisualView({...p,title:'Evolución semanal de proyectos'})).toBe('chart')
    expect(chooseVisualView({...p,title:'Panel ejecutivo de proyectos'})).toBe('dashboard')
  })
  it('turns rejected known visual JSON into a readable notice, never a code wall', () => {
    const bad = {...modelData,props:{...modelData.props,
      sources:[{title:'Trampa',url:'javascript:alert(1)'}]}}
    expect(parseVisualIntelligence(bad)).toBeNull()
    const fence = String.fromCharCode(96).repeat(3)
    const message='Explicación.\n'+fence+'generative-ui\n'+JSON.stringify(bad)+'\n'+fence
    const parts=splitGenerativeUiText(message)
    expect(parts.map(x=>x.kind)).toEqual(['markdown','notice'])
    expect(parts.some(x=>x.kind==='markdown' && x.text.includes('javascript:'))).toBe(false)
  })
  it('recovers bare model-authored visual JSON and hides incomplete streaming drafts', () => {
    const bare='Vista previa\n'+JSON.stringify(modelData)+'\nFin.'
    const parts=splitGenerativeUiText(bare)
    expect(parts.map(x=>x.kind)).toEqual(['markdown','ui','markdown'])
    const incomplete=bare.slice(0,bare.lastIndexOf('}'))
    const streaming=splitGenerativeUiText(incomplete,{streaming:true})
    expect(streaming.some(x=>x.kind==='markdown'&&x.text.includes('metrics'))).toBe(false)
  })
  it('does not repair unrecognized statuses or execute arbitrary model instructions', () => {
    const invalid={...modelData,props:{...modelData.props,
      metrics:[{label:'Tareas',value:'3',status:'__proto__'}]}}
    expect(parseVisualIntelligence(invalid)).toBeNull()
    expect(parseVisualIntelligence({...modelData,props:{...modelData.props,
      onClick:'window.location="evil.example"'}})).toBeNull()
    expect(parseVisualIntelligence({...modelData,props:{...modelData.props,
      sources:[{title:'Evidencia',url:'https://evil.example/a',checkedAt:undefined}]}})).toBeNull()
  })
})
