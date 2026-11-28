// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhoenixSpace, isSpaceHtml, spaceHtmlSource, spacePreviewDocument } from '../src/client/PhoenixSpace.tsx'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const html='<!doctype html><html><body><h1>PHOENIX</h1><img src="data:image/png;base64,AAAA"></body></html>'
const item={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',kind:'app',space:'personal',
  title:'PHOENIX visual',mime:'application/vnd.phoenix.canvas+html',content:html,
  sourceKey:null,revision:1,deleted:false,createdAt:'2026-11-23',updatedAt:'2026-11-23',bytes:0}

describe('PHOENIX Space visual opening',()=>{
  it('identifies HTML by MIME, extension and legacy content, but not plain JSON apps',()=>{
    expect(isSpaceHtml({kind:'app',title:'Page',mime:item.mime},html)).toBe(true)
    expect(isSpaceHtml({kind:'file',title:'index.html',mime:'application/octet-stream'},'')).toBe(true)
    expect(isSpaceHtml({kind:'app',title:'Page',mime:'application/vnd.phoenix.app+json'},html)).toBe(true)
    expect(isSpaceHtml({kind:'app',title:'Page',mime:'application/vnd.phoenix.app+json'},'{"title":"Page"}')).toBe(false)
  })
  it('preserves inline images and resolves bundled image and CSS references',()=>{
    const bundle=JSON.stringify({entry:'site/index.html',files:{
      'site/index.html':'<img src="assets/logo.png"><div style="background:url(assets/logo.png)"></div>',
      'site/assets/logo.png':'AAAA',
    }})
    expect(spaceHtmlSource(bundle)).toContain('src="data:image/png;base64,AAAA"')
    expect(spaceHtmlSource(bundle)).toContain('url("data:image/png;base64,AAAA")')
    const result=spacePreviewDocument(html)
    expect(result).toContain('img-src data: blob:')
    expect(result).toContain('src="data:image/png;base64,AAAA"')
    expect(result).toContain("connect-src 'none'")
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<img'))
    expect(spacePreviewDocument(html,true)).toContain('img-src data: blob: https:')
  })
  it('moves and deletes directly from the library and restores from trash',async()=>{
    let current={...item}
    const requests:Record<string,unknown>[]=[]
    vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
      if(input.includes('/items?')){
        const trash=input.includes('deleted=1')
        return new Response(JSON.stringify({items:current.deleted===trash?[current]:[]}))
      }
      if(input.endsWith('/items/'+item.id)&&init?.method==='PUT'){
        const change=JSON.parse(String(init.body)) as Record<string,unknown>
        requests.push(change)
        current={...current,...change,revision:current.revision+1}
        return new Response(JSON.stringify({item:current}))
      }
      throw Error('Unexpected request')
    }))
    render(<PhoenixSpace onClose={vi.fn()}/>)
    fireEvent.change(await screen.findByRole('combobox',{name:'Mover PHOENIX visual'}),{target:{value:'docencia'}})
    expect(await screen.findByText('Movido a docencia')).toBeTruthy()
    expect(requests[0]).toEqual({revision:1,space:'docencia'})
    await screen.findByText('Aplicaciones · docencia')
    fireEvent.click(screen.getByRole('button',{name:'Eliminar PHOENIX visual'}))
    expect(await screen.findByText('Movido a Papelera')).toBeTruthy()
    expect(requests[1]).toEqual({revision:2,deleted:true})
    fireEvent.click(screen.getByRole('button',{name:'Papelera',exact:true}))
    fireEvent.click(await screen.findByRole('button',{name:'Restaurar PHOENIX visual'}))
    expect(await screen.findByText('Recuperado')).toBeTruthy()
    expect(requests[2]).toEqual({revision:3,deleted:false})
  })
  it('opens a saved canvas visually and shows source only when requested',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
      if(input.includes('/items?'))return new Response(JSON.stringify({items:[item]}))
      if(input.endsWith('/items/'+item.id))return new Response(JSON.stringify({item}))
      throw Error('Unexpected request')
    }))
    render(<PhoenixSpace onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button',{name:/PHOENIX visual/}))
    const frame=await screen.findByTitle('PHOENIX visual · Vista visual')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('srcdoc')).toContain('<h1>PHOENIX</h1>')
    expect(screen.queryByRole('textbox',{name:'Código fuente HTML'})).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Ver código'}))
    expect(screen.getByRole('textbox',{name:'Código fuente HTML'})).toHaveProperty('value',html)
    fireEvent.click(screen.getByRole('button',{name:'Vista visual'}))
    expect(screen.getByTitle('PHOENIX visual · Vista visual')).toBeTruthy()
  })
})
