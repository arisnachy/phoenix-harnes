// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {recoverSpreadsheet,evaluateSheetCell} from '../src/client/chat/SpreadsheetSurface.tsx'
import {SharedFileSurface} from '../src/client/chat/SharedFileSurface.tsx'
import {parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const id='12345678-1234-1234-1234-123456789abc'
const sheet=(rows:string[][])=>JSON.stringify({columns:['Precio','Cantidad','Total'],rows})
const record=(revision:number,content:string)=>({id,kind:'sheet',title:'Inventario',mime:'application/vnd.phoenix.sheet+json',content,revision,bytes:0,deleted:false})
describe('shared chat file workbench',()=>{
  it('recovers safe model scalars and a missing id without allowing executable props',()=>{
    const value={component:'spreadsheet',version:1,props:{title:'Ejemplo',columns:['A','B','C'],rows:[[2,true],[null,'=A2',3]]}}
    const spec=recoverSpreadsheet(value)
    expect(spec?.props.rows).toEqual([['2','true',''],['','=A2','3']])
    expect(recoverSpreadsheet(value)?.props.id).toBe(spec?.props.id)
    expect(parseGenerativeUiBlock(value)?.component).toBe('spreadsheet')
    expect(recoverSpreadsheet({...value,props:{...value.props,onChange:'evil'}})).toBeNull()
  })
  it('supports references beyond P in the larger shared workbook',()=>{
    const row=Array.from({length:40},()=> '2')
    row[39]='=AA2+Z2'
    expect(evaluateSheetCell([row],0,39)).toBe(4)
  })
  it('edits and saves the canonical revision, rather than a browser-only copy',async()=>{
    let current=record(1,sheet([['20','2','=A2*B2']]))
    const requests:unknown[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>{
      if(init?.method==='PUT'){
        const change=JSON.parse(String(init.body)) as {revision:number;content:string}
        requests.push(change)
        if(change.revision!==current.revision)return new Response('{}',{status:409})
        current=record(current.revision+1,change.content)
      }
      return new Response(JSON.stringify({item:current}),{status:200})
    }))
    render(<SharedFileSurface itemId={id}/>)
    const cell=await screen.findByRole('textbox',{name:'A2'}) as HTMLInputElement
    expect(cell.value).toBe('20')
    fireEvent.change(cell,{target:{value:'30'}})
    expect((screen.getByRole('textbox',{name:'C2'}) as HTMLInputElement).value).toBe('60')
    fireEvent.click(screen.getByRole('button',{name:'Guardar'}))
    await waitFor(()=>expect(screen.getByText(/Versión 2 · Sincronizado/)).toBeTruthy())
    expect(requests).toEqual([{revision:1,content:sheet([['30','2','=A2*B2']])}])
  })
  it('keeps a dirty draft when the canonical write conflicts',async()=>{
    const current=record(1,sheet([['20','2','=A2*B2']]))
    vi.stubGlobal('fetch',vi.fn(async(_url:string,init?:RequestInit)=>init?.method==='PUT'
      ?new Response('{}',{status:409}):new Response(JSON.stringify({item:current}),{status:200})))
    render(<SharedFileSurface itemId={id}/>)
    const cell=await screen.findByRole('textbox',{name:'A2'}) as HTMLInputElement
    fireEvent.change(cell,{target:{value:'30'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar'}))
    await screen.findByText(/Conflicto de versiones/)
    expect(cell.value).toBe('30')
  })
})
