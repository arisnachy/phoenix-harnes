// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SceneMap, parseSceneMapSpec } from '../src/client/chat/SceneMap.tsx'
import { parseGenerativeUiBlock, splitGenerativeUiText, GenerativeUi } from '../src/client/chat/GenerativeUi.tsx'

afterEach(()=>{cleanup();vi.restoreAllMocks()})
const island=()=>({
  component:'scene_map',version:1,
  props:{
    id:'isla-bruma',title:'Isla Bruma',subtitle:'Mundo de fantasía interactivo',theme:'fantasy',
    places:[
      { id:'puerto',name:'Puerto de la Niebla',x:20,y:60,kind:'port',description:'Barcas desde el oeste' },
      { id:'bosque',name:'Bosque Susurrante',x:42,y:50,kind:'forest',description:'Árboles milenarios' },
      { id:'torre',name:'Torre del Viento',x:66,y:32,kind:'tower',description:'Guardianes de la isla' },
      { id:'ruinas',name:'Ruinas del Alba',x:69,y:73,kind:'ruins',description:'Santuario olvidado' },
      { id:'capital',name:'Ciudad de Sal',x:53,y:48,kind:'city',description:'Capital de los cartógrafos' },
    ],
    routes:[{ from:'puerto',to:'bosque',label:'Sendero de musgo' },{ from:'bosque',to:'capital' }],
  },
})
describe('motor nativo de mapas ficticios / Isla Bruma',()=>{
  it('valida el contrato para publicar UI real sin navegador ni servicios externos',()=>{
    const spec=island()
    expect(parseSceneMapSpec(spec)).not.toBeNull()
    expect(parseGenerativeUiBlock(spec)).not.toBeNull()
    expect(parseSceneMapSpec({ ...spec,props:{ ...spec.props,script:'alert(1)' } })).toBeNull()
    expect(parseSceneMapSpec({ ...spec,props:{ ...spec.props,places:[...spec.props.places,{ ...spec.props.places[0],id:'puerto' }] } })).toBeNull()
    expect(parseSceneMapSpec({ ...spec,props:{ ...spec.props,routes:[{ from:'inexistente',to:'puerto' }] } })).toBeNull()
    expect(parseSceneMapSpec({ ...spec,props:{ ...spec.props,places:spec.props.places.map(p=>({ ...p,x:101 })) } })).toBeNull()
  })
  it('publica un mapa con JSON y en bloque generative-ui',()=>{
    const raw=JSON.stringify(island())
    expect(splitGenerativeUiText(raw).map(s=>s.kind)).toEqual(['ui'])
    const mixed='Mapa interactivo de Isla Bruma:\n\n'+['```generative-ui',raw,'```'].join('\n')+'\nExplora sus sitios.'
    expect(splitGenerativeUiText(mixed).map(s=>s.kind)).toEqual(['markdown','ui','markdown'])
    expect(splitGenerativeUiText('```generative-ui\n'+raw.slice(0,35),{ streaming:true })
      .some(s=>s.kind==='ui')).toBe(false)
  })
  it('renderiza mapa offline con lugares interactivos y panel',()=>{
    const spec=parseSceneMapSpec(island())!
    const action=vi.fn()
    render(<SceneMap spec={spec} onAction={action} />)
    expect(screen.getByRole('heading',{ name:'Isla Bruma' })).not.toBeNull()
    expect(screen.getByRole('img',{ name:/Mapa ficticio interactivo Isla Bruma/ })).not.toBeNull()
    expect(screen.getByRole('button',{ name:'Ver mapa completo' })).not.toBeNull()
    expect(screen.getByRole('button',{ name:'Exportar SVG' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button',{ name:'Explorar Torre del Viento' }))
    expect(screen.getByText('Guardianes de la isla')).not.toBeNull()
    fireEvent.click(screen.getByRole('button',{ name:/Preguntar a Kira/ }))
    expect(action).toHaveBeenCalledWith(expect.stringContaining('Torre del Viento'),'draft')
    fireEvent.click(screen.getByRole('button',{ name:'Ver mapa completo' }))
    expect(screen.getByText('Barcas desde el oeste')).not.toBeNull()
  })
  it('aísla mapas diferentes en el mismo transcript',()=>{
    const spec=parseSceneMapSpec(island())!
    const other=parseSceneMapSpec({ ...island(),props:{ ...island().props,id:'isla-nueva',title:'Isla Nueva' } })!
    const a=render(<><SceneMap spec={spec}/><SceneMap spec={other}/></>)
    expect(a.container.querySelectorAll('[data-phoenix-scene-map]')).toHaveLength(2)
    const symbols=a.container.querySelectorAll('linearGradient')
    expect(symbols).toHaveLength(2)
    expect(symbols[0]?.getAttribute('id')).not.toBe(symbols[1]?.getAttribute('id'))
  })
  it('pasa por el router GenerativeUi verdadero',()=>{
    const spec=parseGenerativeUiBlock(island())
    expect(spec).not.toBeNull()
    if(spec)render(<GenerativeUi block={spec}/>)
    expect(screen.getByRole('heading',{ name:'Isla Bruma' })).not.toBeNull()
  })
})
