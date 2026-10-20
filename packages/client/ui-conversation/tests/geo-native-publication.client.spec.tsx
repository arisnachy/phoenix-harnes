// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { HardnessArtifactNodeView } from '../src/client/chat/HardnessArtifactNodeView.tsx'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks()})

describe('native geographic map delivery and recovery',()=>{
  it('mounts a real inline geo viewer from the native tool artifact, even with no model fence',()=>{
    const data={
      artifactId:'phoenix-geo-map:geo-tool-1',mime:'application/vnd.phoenix.geo+json',
      title:'Mapa geográfico real · datos de prueba',
      data:{component:'geo_map',version:1,props:{
        id:'geo-view-test',title:'Mapa geográfico real · datos de prueba',
        source:'Datos sintéticos para probar el renderizado, no datos oficiales',
        theme:'health',metric:'Personas de prueba, no prevalencia',
        subtitle:'No es un ranking territorial',
        center:{lng:-70.69,lat:19.78},zoom:10,
        layers:[{id:'muestras',name:'Puntos individuales',kind:'points',features:[
          {id:'sitio',label:'Punto verificable',coordinates:[[-70.69,19.78]],
            detail:'Este registro es solo una prueba técnica',value:27},
        ]}],
      }},
    }
    const props={node:{
      kind:'hardness-artifact',key:'geo-artifact',id:data.artifactId,target:'chat',
      anchorSeq:1,location:{kind:'unresolved'},visibility:'visible',
      data:{...data,callId:'geo-tool-1',seq:1,time:1},
    }} as ComponentProps<typeof HardnessArtifactNodeView>
    render(<HardnessArtifactNodeView {...props}/>)
    expect(document.querySelector('[data-hardness-artifact="phoenix-geo-map:geo-tool-1"]')).toBeTruthy()
    expect(document.querySelector('[data-phoenix-geo-map="geo-view-test"]')).toBeTruthy()
    expect(screen.getByRole('region',{name:'Mapa interactivo: Mapa geográfico real · datos de prueba'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Seleccionar Punto verificable'}))
    expect(screen.getByText('Este registro es solo una prueba técnica')).toBeTruthy()
    expect(screen.getByRole('button',{name:'PDF · Informe'})).toBeTruthy()
    expect(screen.queryByText(/"component": "geo_map"/)).toBeNull()
  })
  it('recovers a real-world health map with geo tooling instead of a fictional island',()=>{
    const action=vi.fn()
    const blocks=[{kind:'text',text:'El mapa interactivo de hipertensión en República Dominicana quedó publicado arriba en el chat.'}]
    render(<AssistantMarkdown
      blocks={blocks as unknown as ComponentProps<typeof AssistantMarkdown>['blocks']}
      streaming={false}
      renderMessageImages={()=>null}
      onUiAction={action}
      t={((key:string)=>key) as ComponentProps<typeof AssistantMarkdown>['t']}
    />)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Solicitar visor geográfico'}))
    expect(action).toHaveBeenCalledWith(expect.stringContaining('phoenix_geo_map'),'draft')
    expect(action.mock.calls[0]?.[0]).toContain('no inventes provincias')
  })
  it('keeps fictional-map recovery routed to the narrative engine',()=>{
    const action=vi.fn()
    render(<AssistantMarkdown
      blocks={[{kind:'text',text:'El mapa de Isla Bruma quedó publicado.'}]
        as unknown as ComponentProps<typeof AssistantMarkdown>['blocks']}
      streaming={false}
      renderMessageImages={()=>null}
      onUiAction={action}
      t={((key:string)=>key) as ComponentProps<typeof AssistantMarkdown>['t']}
    />)
    fireEvent.click(screen.getByRole('button',{name:'Solicitar visor narrativo'}))
    expect(action).toHaveBeenCalledWith(expect.stringContaining('phoenix_scene_map'),'draft')
  })
})
