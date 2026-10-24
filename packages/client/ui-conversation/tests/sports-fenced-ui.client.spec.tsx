// @vitest-environment jsdom
import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it} from 'vitest'
import {AssistantMarkdown} from '../src/client/chat/AssistantMarkdown.tsx'
import {splitGenerativeUiText,parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
import type {ChatViewSlotProps} from '../src/client/contract/slots.ts'

// Matches the concrete shape shown on 24 Oct 2026: a valid sports_game_card
// with home/away scores, starters, stadium, source and a follow-up prompt.
const screenshotGame = {
  component:'sports_game_card',version:1,props:{
    title:'MLB · 849802',subtitle:'Partido 2026-10-24',status:'Pre-Game',
    when:'24 oct 2026, 8:00 p. m.',venue:'American Family Field',
    home:{label:'Milwaukee Brewers',score:'0'},away:{label:'Tampa Bay Rays',score:'0'},
    source:'MLB Stats API · 2026-10-24T20:44:58.819Z',
    highlights:[
      {label:'Abridor visitante',value:'Drew Rasmussen'},
      {label:'Abridor local',value:'Logan Henderson'},
      {label:'Equipo local',value:'Milwaukee Brewers · ID 158'},
      {label:'Equipo visitante',value:'Tampa Bay Rays · ID 139'},
    ],
    askPrompt:'Kira, amplía la información verificable del partido MLB 849802 incluyendo pitchers probables, rendimiento reciente, bullpen, ausencias y fuente por estadística.',
    note:'Lanzadores probables pueden cambiar; no se confirmó el roster definitivo.',
  },
}
const fence=String.fromCharCode(96).repeat(3)
const formatted=fence+'generative-ui\n'+JSON.stringify(screenshotGame)+'\n'+fence
const tr=((key:string)=>key) as ChatViewSlotProps['t']
afterEach(cleanup)
describe('MLB screenshot regression: card never becomes plaintext code',()=>{
  it('accepts screenshot-shaped scoreboard including scores and highlights',()=>{
    expect(parseGenerativeUiBlock(screenshotGame)).toEqual(screenshotGame)
    const parsed=splitGenerativeUiText('Hoy hay un partido.\n\n'+formatted)
    expect(parsed.map(x=>x.kind)).toEqual(['markdown','ui'])
    expect(parsed[1]).toMatchObject({kind:'ui',block:{component:'sports_game_card'}})
  })
  it('renders the sports card from a complete assistant reply, not a code box',()=>{
    render(<AssistantMarkdown blocks={[{kind:'text',text:'Hoy hay un partido.\n\n'+formatted}]}
      streaming={false} renderMessageImages={()=>null} t={tr} />)
    expect(screen.getByText('MLB · 849802')).toBeTruthy()
    expect(screen.getByText('American Family Field')).toBeTruthy()
    expect(document.querySelector('[data-generative-ui="sports_game_card"]')).toBeTruthy()
    expect(screen.queryByText('generative-ui')).toBeNull()
  })
  it('reassembles a generative-ui fence cut across assistant text blocks',()=>{
    const cut=Math.floor(formatted.length/2)
    render(<AssistantMarkdown blocks={[
      {kind:'text',text:'Cartelera oficial.\n\n'+formatted.slice(0,cut)},
      {kind:'text',text:formatted.slice(cut)},
    ]} streaming={false} renderMessageImages={()=>null} t={tr} />)
    expect(document.querySelector('[data-generative-ui="sports_game_card"]')).toBeTruthy()
    expect(screen.queryByText('generative-ui')).toBeNull()
  })
  it('renders an explicit notice if a sports contract is unsafe, not a raw JSON slab',()=>{
    const unsafe={...screenshotGame,props:{...screenshotGame.props,home:{label:'Milwaukee Brewers',logo:'https://evil.example/track.gif'}}}
    const parsed=splitGenerativeUiText(fence+'generative-ui\n'+JSON.stringify(unsafe)+'\n'+fence)
    expect(parsed[0]?.kind).toBe('notice')
    expect(parsed.map(x=>x.kind)).not.toContain('ui')
    expect(JSON.stringify(parsed)).not.toContain('track.gif')
  })
})
