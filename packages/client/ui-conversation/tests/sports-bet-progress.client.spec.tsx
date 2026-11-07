// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {evaluateSportsPick,SportsBetProgress,validTrackedPick,type SportsTrackedPick} from '../src/client/chat/SportsBetProgress.tsx'
import type {PhoenixLiveGame,PhoenixLiveMeta} from '../src/client/chat/SportsLive.tsx'
import {parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'

const meta:PhoenixLiveMeta={updatedAt:Date.now(),stale:false,error:false,enabled:true}
const hockey:PhoenixLiveGame={id:'401900001',home:'Carolina Hurricanes',away:'Chicago Blackhawks',
  homeScore:'3',awayScore:'2',phase:'in',status:'3rd period'}
const grade=(market:SportsTrackedPick['market'],side:SportsTrackedPick['side'],line?:number)=>
  evaluateSportsPick({receipt:'12126409',market,side,...(line===undefined?{}:{line})},hockey,'hockey')
afterEach(()=>{cleanup();localStorage.clear()})
beforeEach(()=>{localStorage.clear()})
describe('PHOENIX user ticket goals and scoreboard evidence',()=>{
  it('never declares a live winner, even when over already crossed',()=>{
    expect(grade('moneyline','home').state).toBe('leading')
    expect(grade('moneyline','away').state).toBe('trailing')
    expect(grade('total','over',4.5)).toMatchObject({state:'leading'})
    expect(grade('total','under',4.5).state).toBe('trailing')
    expect(grade('spread','away',1.5).state).toBe('leading')
    expect(grade('spread','away',0.5).state).toBe('trailing')
    expect(grade('spread','away',0.5).target).toMatch(/necesita 1/)
  })
  it('grades final full-game totals and half-goal handicaps provisionally',()=>{
    const final={...hockey,phase:'post' as const}
    expect(evaluateSportsPick({receipt:'1',market:'moneyline',side:'home'},final,'hockey').state).toBe('won')
    expect(evaluateSportsPick({receipt:'1',market:'spread',side:'away',line:1.5},final,'hockey').state).toBe('won')
    expect(evaluateSportsPick({receipt:'1',market:'spread',side:'away',line:0.5},final,'hockey').state).toBe('lost')
    expect(evaluateSportsPick({receipt:'1',market:'total',side:'over',line:5},final,'hockey').state).toBe('push')
    expect(evaluateSportsPick({receipt:'1',market:'total',side:'under',line:5.5},final,'hockey').state).toBe('won')
  })
  it('does not infer soccer regulation or hockey three-way outcome from full-time ESPN score',()=>{
    const final={...hockey,phase:'post' as const}
    expect(evaluateSportsPick({receipt:'1',market:'moneyline',side:'home'},final,'soccer').state).toBe('review')
    expect(evaluateSportsPick({receipt:'1',market:'three-way',side:'home'},final,'hockey').state).toBe('review')
    expect(evaluateSportsPick({receipt:'1',market:'moneyline',side:'home'},{...final,homeScore:undefined},'hockey').state).toBe('pending')
  })
  it('validates trusted structured picks, rejects missing lines, fake markets and extra keys',()=>{
    expect(validTrackedPick({receipt:'12126409',market:'spread',side:'away',line:1.5})).toBe(true)
    expect(validTrackedPick({receipt:'12126409',market:'spread',side:'away'})).toBe(false)
    expect(validTrackedPick({receipt:'12126409',market:'moneyline',side:'over'})).toBe(false)
    expect(validTrackedPick({receipt:'12126409',market:'moneyline',side:'home',script:'alert(1)'})).toBe(false)
    const p={title:'Chicago at Carolina',source:'ESPN',when:'7 nov',
      home:{label:'Carolina Hurricanes'},away:{label:'Chicago Blackhawks'},sport:'hockey',league:'nhl',
      eventDate:'2026-11-07',trackedBets:[{receipt:'12126409',market:'moneyline',side:'home'}]}
    expect(parseGenerativeUiBlock({component:'sports_game_card',version:1,props:p})).not.toBeNull()
    expect(parseGenerativeUiBlock({component:'sports_game_card',version:1,props:{
      ...p,trackedBets:[{receipt:'12126409',market:'spread',side:'home'}]}})).toBeNull()
  })
  it('saves multiple references for a shared match and reloads after remount',()=>{
    const props={sport:'hockey',league:'nhl',date:'2026-11-07',home:'Carolina Hurricanes',
      away:'Chicago Blackhawks',game:hockey,meta}
    const view=render(<SportsBetProgress {...props}/>)
    fireEvent.click(screen.getByText('Registrar mi apuesta para seguir el objetivo'))
    fireEvent.change(screen.getByPlaceholderText('Ej.: 12126409'),{target:{value:'12126409'}})
    fireEvent.click(screen.getByText('Guardar selección'))
    expect(screen.getByText('Boleto 12126409')).toBeTruthy()
    view.unmount()
    render(<SportsBetProgress {...props}/>)
    expect(screen.getByText('Boleto 12126409')).toBeTruthy()
    expect(screen.getByText(/Cumpliendo por ahora/)).toBeTruthy()
  })
})
