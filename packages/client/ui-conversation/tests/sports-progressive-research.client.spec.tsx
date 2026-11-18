// @vitest-environment jsdom
import {describe,it,expect,afterEach} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {parseGenerativeUiBlock,GenerativeUi} from '../src/client/chat/GenerativeUi.tsx'
import {sportsCardsFromToolResult} from '../src/client/chat/sports-tool-cards.ts'
afterEach(cleanup)
const logo='https://a.espncdn.com/i/teamlogos/nba/500/gs.png'
const portrait='https://a.espncdn.com/i/headshots/nba/players/full/3975.png'
const table={component:'sports_research_table',version:1,props:{
  sport:'basketball',league:'nba',eventId:'401001',stage:'rosters',
  title:'Visitors vs Home',checkedAt:'2026-11-17T12:00:00.000Z',
  source:'ESPN · roster verificado',note:'No es pronóstico',
  home:{name:'Home',logo},away:{name:'Visitors'},
  rows:[{label:'Jugador 1',home:'Jugador local · 21 puntos',away:'Jugador visitante · 18 puntos',
    homeImage:portrait,state:'reported',note:'Estadística observada'}],
  missing:['Quintetos sin confirmar'],
}}
describe('PHOENIX inline step-by-step research comparisons',()=>{
  it('shows an unboxed accessible three-column table with official images',()=>{
    const parsed=parseGenerativeUiBlock(table)
    expect(parsed).not.toBeNull()
    if(!parsed)throw Error('Rejected progressive table')
    const {container}=render(<GenerativeUi block={parsed}/>)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('Jugador local · 21 puntos')).toBeTruthy()
    expect(screen.getByText('Jugador visitante · 18 puntos')).toBeTruthy()
    expect(screen.getByText(/Quintetos sin confirmar/)).toBeTruthy()
    expect(screen.getByText(/Etapa 2 de 6/)).toBeTruthy()
    expect(container.querySelectorAll('img').length).toBe(2)
    expect(container.querySelector('[data-generative-ui="sports_research_table"]')).toBeTruthy()
    expect(container.querySelector('[data-generative-ui="sports_ticket_card"]')).toBeNull()
  })
  it('rejects unsafe images/links, arbitrary HTML and excessive data',()=>{
    expect(parseGenerativeUiBlock({...table,props:{...table.props,
      home:{name:'Home',logo:'https://tracker.evil/images.png'}}})).toBeNull()
    expect(parseGenerativeUiBlock({...table,props:{...table.props,
      rows:[{...table.props.rows[0],url:'javascript:alert(1)'}]}})).toBeNull()
    expect(parseGenerativeUiBlock({...table,props:{...table.props,
      rows:[{...table.props.rows[0],dangerouslySetInnerHTML:{__html:'<script>'}}]}})).toBeNull()
    expect(parseGenerativeUiBlock({...table,props:{...table.props,
      rows:Array.from({length:65},(_,i)=>({...table.props.rows[0],label:String(i)}))}})).toBeNull()
  })
  it('extracts independently returned stage tables from first-party tools',()=>{
    const make=(stage:string)=>({...table,props:{...table.props,stage}})
    const record=(stage:string)=>({kind:'tool-result',
      call:{name:'sports_chat_research_stage'},isError:false,
      content:[{type:'text',text:JSON.stringify({uiBlock:make(stage)})}]})
    const root={subCalls:[record('teams'),record('rosters'),record('availability'),
      record('context'),record('news'),record('odds')]}
    const cards=sportsCardsFromToolResult(root)
    expect(cards.length).toBe(6)
    expect(cards.every(c=>c.component==='sports_research_table')).toBe(true)
  })
})
