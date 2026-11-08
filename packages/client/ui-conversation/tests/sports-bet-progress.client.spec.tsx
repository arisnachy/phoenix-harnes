// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {evaluateSportsPick,SportsBetProgress,validTrackedPick,type SportsTrackedPick} from '../src/client/chat/SportsBetProgress.tsx'
import type {PhoenixLiveGame,PhoenixLiveMeta} from '../src/client/chat/SportsLive.tsx'
import {parseGenerativeUiBlock,GenerativeUi} from '../src/client/chat/GenerativeUi.tsx'
import {importSportsReceipt,readSportsReceiptGoals} from '../src/client/chat/SportsTicketAutoLink.ts'

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
  it('receives two actual ticket goals automatically from native cards and restores them without manual inputs',()=>{
    const make=(receipt:string)=>parseGenerativeUiBlock({component:'sports_ticket_card',version:1,props:{
      title:'Boleto '+receipt,source:'ESPN + comprobante del usuario',
      ticketReference:receipt,legs:[{
        event:'Chicago Blackhawks vs Carolina Hurricanes',
        homeTeam:'Carolina Hurricanes',awayTeam:'Chicago Blackhawks',
        sport:'hockey',league:'nhl',providerLeague:'nhl',eventId:'401900001',
        eventDate:'2026-11-07',selection:'Carolina Hurricanes',market:'moneyline',price:'-460',
        bookmaker:'Juancito Sport',trackedBet:{receipt,market:'moneyline',side:'home'},
      }],requestedLegs:1,combinedOdds:'No disponible',
      note:'Recibo del usuario, no aceptado ni liquidado mediante API.',
    }})
    const cardA=make('12126409'),cardB=make('12126415')
    if(!cardA||!cardB)throw Error('Rejected attributed receipt card')
    const ticketA=render(<GenerativeUi block={cardA}/>)
    const ticketB=render(<GenerativeUi block={cardB}/>)
    const props={sport:'hockey',league:'nhl',date:'2026-11-07',home:'Carolina Hurricanes',
      away:'Chicago Blackhawks',eventId:'401900001',game:hockey,meta}
    const progress=render(<SportsBetProgress {...props}/>)
    expect(screen.getAllByText('Boleto #12126409')[0]).toBeTruthy()
    expect(screen.getAllByText('Boleto #12126415')[0]).toBeTruthy()
    expect(screen.getAllByText(/Cumpliendo por ahora/)).toHaveLength(2)
    expect(screen.queryByText(/Registrar mi apuesta/)).toBeNull()
    ticketA.unmount();ticketB.unmount();progress.unmount()
    render(<SportsBetProgress {...props}/>)
    expect(screen.getAllByText('Boleto #12126409')[0]).toBeTruthy()
    expect(screen.getAllByText('Boleto #12126415')[0]).toBeTruthy()
  })
  it('never assigns a receipt to an opponent, another day, or an ESPN event ID mismatch',()=>{
    const fixture={sport:'soccer',providerLeague:'usa.1',eventDate:'2026-11-07',
      eventId:'401800555',homeTeam:'CF Montréal',awayTeam:'Vancouver Whitecaps',
      trackedBet:{receipt:'12126415',market:'moneyline',side:'away'}}
    expect(importSportsReceipt([fixture])).toBe(1)
    expect(readSportsReceiptGoals({sport:'soccer',league:'usa.1',date:'2026-11-07',
      home:'CF Montréal',away:'Vancouver Whitecaps',eventId:'401800555'})).toEqual([fixture.trackedBet])
    for(const lookup of [
      {sport:'soccer',league:'usa.1',date:'2026-11-08',home:'CF Montréal',away:'Vancouver Whitecaps'},
      {sport:'soccer',league:'usa.1',date:'2026-11-07',home:'CF Montréal',away:'Portland Timbers'},
      {sport:'soccer',league:'usa.1',date:'2026-11-07',home:'CF Montréal',away:'Vancouver Whitecaps',eventId:'9999'},
    ])expect(readSportsReceiptGoals(lookup)).toEqual([])
  })
  it('rejects forged receipt links, malformed markets and invalid fixture IDs',()=>{
    expect(importSportsReceipt([{sport:'hockey',providerLeague:'nhl',eventDate:'2026-11-07',
      eventId:'other provider',homeTeam:'Carolina Hurricanes',awayTeam:'Chicago Blackhawks',
      trackedBet:{receipt:'12126409',market:'moneyline',side:'home'}}])).toBe(0)
    const invalid=parseGenerativeUiBlock({component:'sports_ticket_card',version:1,props:{
      title:'Recibo',source:'ESPN',ticketReference:'12126409',
      legs:[{event:'Match',selection:'Carolina',price:'-460',bookmaker:'Juancito Sport',
        sport:'hockey',league:'nhl',providerLeague:'nhl',
        eventId:'401900001',eventDate:'2026-11-07',
        homeTeam:'Carolina Hurricanes',awayTeam:'Chicago Blackhawks',
        trackedBet:{receipt:'WRONG',market:'moneyline',side:'home'}}],
      requestedLegs:1,combinedOdds:'No disponible',note:'Sin liquidación',
    }})
    expect(invalid).toBeNull()
  })

})
