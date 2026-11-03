// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {AssistantMarkdown} from '../src/client/chat/AssistantMarkdown.tsx'
import {parsePlainOutputCard,splitPlainOutputText} from '../src/client/chat/PlainOutputFormatter.tsx'
import type {ChatViewSlotProps} from '../src/client/contract/slots.ts'

const fence='\x60\x60\x60'
const receipt=[
  '╔══════════════ TICKET DE DEMOSTRACIÓN ══════════════╗',
  '║ Estado: FICTICIO — no válido para apostar           ║',
  '╠════════════════════════════════════════════════════╣',
  '║ MLB · Juego inventado                                ║',
  '║ Cóndores de Puerto Norte vs. Lobos de Sierra         ║',
  '║ Mercado: Ganador del partido (ML)                    ║',
  '║ Selección: Cóndores de Puerto Norte                   ║',
  '║ Cuota: 1.80                                          ║',
  '╠════════════════════════════════════════════════════╣',
  '║ Monto: 10 unidades                                   ║',
  '║ Retorno potencial: 18 unidades                       ║',
  '║ Ganancia potencial: 8 unidades                       ║',
  '╚════════════════════════════════════════════════════╝',
].join('\n')
const prose='Aquí va tu boleto.\n\n'+fence+'text\n'+receipt+'\n'+fence+'\n\nLos equipos son ficticios.'
const tr=((key:string)=>key) as ChatViewSlotProps['t']
afterEach(cleanup)

describe('native presentation formatter for plain ASCII output',()=>{
  it('recognizes the captured legacy receipt without inventing data',()=>{
    const card=parsePlainOutputCard(receipt)
    expect(card?.ticket).toBe(true)
    expect(card?.simulated).toBe(true)
    expect(card?.title).toBe('TICKET DE DEMOSTRACIÓN')
    expect(card?.sections).toHaveLength(3)
    expect(card?.sections.flat()).toContainEqual({kind:'field',label:'Cuota',value:'1.80'})
    expect(card?.sections.flat()).toContainEqual({kind:'field',label:'Monto',value:'10 unidades'})
  })
  it('splits narrative before and after a text fence into a Phoenix-native card',()=>{
    const pieces=splitPlainOutputText(prose)
    expect(pieces.map(x=>x.kind)).toEqual(['markdown','formatted','markdown'])
    expect(pieces[1]).toMatchObject({kind:'formatted',card:{ticket:true,simulated:true}})
  })
  it('renders the ticket in chat rather than a text code block',()=>{
    render(<AssistantMarkdown blocks={[{kind:'text',text:prose}]} streaming={false}
      renderMessageImages={()=>null} t={tr}/>)
    expect(document.querySelector('[data-phoenix-formatted-output="ticket"]')).toBeTruthy()
    expect(screen.getByRole('heading',{name:'TICKET DE DEMOSTRACIÓN'})).toBeTruthy()
    expect(screen.getByText('Ganador del partido (ML)')).toBeTruthy()
    expect(screen.getByText('10 unidades')).toBeTruthy()
    expect(screen.getByText('Contenido ficticio o de demostración · No válido para apostar')).toBeTruthy()
    expect(screen.getByText('Ver texto original')).toBeTruthy()
    expect(screen.queryByText('text')).toBeNull()
    expect(screen.getByText(/Los equipos son ficticios/)).toBeTruthy()
  })
  it('reassembles legacy ASCII ticket fences split across streaming blocks',()=>{
    const cut=Math.floor(prose.length/2)
    render(<AssistantMarkdown blocks={[
      {kind:'text',text:prose.slice(0,cut)},
      {kind:'reasoning',text:'private thoughts'},
      {kind:'text',text:prose.slice(cut)},
    ]} streaming={false} renderMessageImages={()=>null} t={tr}/>)
    expect(document.querySelector('[data-phoenix-formatted-output="ticket"]')).toBeTruthy()
    expect(screen.queryByText('private thoughts')).toBeNull()
  })
  it('does not transform code, Markdown tables, or unrelated ASCII art',()=>{
    const python=fence+'python\nprint("hello")\n'+fence
    const markdown='| Tipo | Valor |\n|---|---|\n| Dos | 2 |'
    expect(splitPlainOutputText(python)).toEqual([{kind:'markdown',text:python}])
    expect(splitPlainOutputText(markdown)).toEqual([{kind:'markdown',text:markdown}])
    const art=fence+'text\n┌────────────┐\n│ :-)        │\n└────────────┘\n'+fence
    expect(splitPlainOutputText(art)).toEqual([{kind:'markdown',text:art}])
  })
  it('keeps unknown formatted samples inert, safe, and unverified',()=>{
    const generic=[
      '┌──────────── Formulario ─────────────┐',
      '│ Nombre: Prueba                    │',
      '│ Código: P-1                       │',
      '│ Estado: Borrador                  │',
      '└────────────────────────────────────┘',
    ].join('\n')
    const card=parsePlainOutputCard(generic)
    expect(card?.ticket).toBe(false)
    expect(card?.simulated).toBe(false)
    expect(card?.sections.flat()).toContainEqual({kind:'field',label:'Estado',value:'Borrador'})
    expect(parsePlainOutputCard(receipt+'x'.repeat(12_500))).toBeNull()
  })
})
