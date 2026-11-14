// @vitest-environment jsdom
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,waitFor} from '@testing-library/react'
import {SportsMarkedMatch} from '../src/client/chat/SportsMarkedMatch.tsx'
import {importSportsReceipt} from '../src/client/chat/SportsTicketAutoLink.ts'
import {importSportsForecast} from '../src/client/chat/SportsForecastAutoLink.ts'
import {GenerativeUi,parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
import type {PhoenixLiveGame,PhoenixLiveMeta} from '../src/client/chat/SportsLive.tsx'
import type {SportsTrackedPick} from '../src/client/chat/SportsBetProgress.tsx'

const meta:PhoenixLiveMeta={enabled:true,updatedAt:1,stale:false,error:false}
const game:PhoenixLiveGame={id:'401123456',home:'Indiana Pacers',away:'New York Knicks',
  homeScore:'85',awayScore:'82',phase:'in',status:'3rd · 49.1',period:3}
const props={sport:'basketball',league:'nba',date:'2026-11-13',eventId:'401123456',
  away:{label:'New York Knicks',score:'82'},home:{label:'Indiana Pacers',score:'85'},
  hasStarted:true,favorite:'Indiana Pacers',game,meta}
const receipt={sport:'basketball',providerLeague:'nba',eventDate:'2026-11-13',
  eventId:'401123456',awayTeam:'New York Knicks',homeTeam:'Indiana Pacers',
  trackedBet:{receipt:'12140939',market:'moneyline',side:'away'}}
beforeEach(()=>{localStorage.clear();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({events:[]}),{status:200})))})
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})

describe('PHOENIX inline scoreboard pick tracking',()=>{
  it('marks the receipt pick separately from the analytic favorite and displays a provisional loss',()=>{
    expect(importSportsReceipt([receipt])).toBe(1)
    const {container}=render(<SportsMarkedMatch {...props}/>)
    const chosen=container.querySelector('[data-selected-pick="true"]')
    const favored=container.querySelector('[data-analytical-favorite="true"]')
    expect(chosen?.textContent).toContain('New York Knicks')
    expect(chosen?.textContent).toContain('Tu selección · boleto')
    expect(favored?.textContent).toContain('Indiana Pacers')
    expect(favored?.textContent).toContain('Favorito PHOENIX')
    expect(container.querySelector('[data-pick-status="trailing"]')?.textContent).toContain('Va fallando')
    expect(container.textContent).toContain('necesita 4 puntos')
    expect(container.textContent).toContain('solo la casa liquida apuestas')
  })
  it('shows leading, final won and final lost without using win probability as bet settlement',()=>{
    const bet:SportsTrackedPick={receipt:'12140939',market:'moneyline',side:'away'}
    const {container,rerender}=render(<SportsMarkedMatch {...props} trackedBets={[bet]}
      game={{...game,awayScore:'90'}}/>)
    expect(container.querySelector('[data-pick-status="leading"]')?.textContent).toContain('Va acertando')
    rerender(<SportsMarkedMatch {...props} trackedBets={[bet]} game={{...game,phase:'post',awayScore:'90'}}/>)
    expect(container.querySelector('[data-pick-status="won"]')?.textContent).toContain('Acertó · provisional')
    rerender(<SportsMarkedMatch {...props} trackedBets={[bet]} game={{...game,phase:'post'}}/>)
    expect(container.querySelector('[data-pick-status="lost"]')?.textContent).toContain('Falló · provisional')
  })
  it('does not grade mismatched ESPN event IDs or live data marked stale',()=>{
    const bet:SportsTrackedPick={receipt:'12140939',market:'moneyline',side:'away'}
    const {container,rerender}=render(<SportsMarkedMatch {...props} trackedBets={[bet]}
      game={{...game,id:'401999999'}}/>)
    expect(container.querySelector('[data-pick-status="pending"]')).toBeTruthy()
    expect(container.textContent).toContain('Esperando marcador ESPN vinculado')
    rerender(<SportsMarkedMatch {...props} trackedBets={[bet]} meta={{...meta,stale:true}}/>)
    expect(container.querySelector('[data-pick-status="review"]')?.textContent).toContain('Marcador desactualizado')
  })
  it('links a Kira-only forecast but never calls it a confirmed wager',()=>{
    const forecast={event:'Knicks vs Pacers',selection:'New York Knicks',
      market:'Ganador · Pronóstico',sport:'basketball',league:'NBA',providerLeague:'nba',
      eventDate:'2026-11-13',eventId:'401123456',
      awayTeam:'New York Knicks',homeTeam:'Indiana Pacers'}
    expect(importSportsForecast([forecast])).toBe(1)
    const {container}=render(<SportsMarkedMatch {...props}/>)
    expect(container.querySelector('[data-pick-source="forecast"]')).toBeTruthy()
    expect(container.querySelector('[data-selected-pick="true"]')?.textContent).toContain('Pronóstico Kira')
    expect(container.textContent).toContain('Va fallando')
    expect(container.textContent).not.toContain('Tu selección · boleto')
  })
  it('never highlights a team for a total or an unsupported/ambiguous pick',()=>{
    const pick:SportsTrackedPick={receipt:'abc',market:'total',side:'over',line:225.5}
    const {container}=render(<SportsMarkedMatch {...props} favorite={undefined} trackedBets={[pick]}/>)
    expect(container.querySelectorAll('[data-selected-pick="true"]')).toHaveLength(0)
    expect(container.textContent).toContain('Más de 225.5')
    expect(container.querySelector('[data-pick-status="trailing"]')).toBeTruthy()
  })
  it('automatically registers a structured Kira ticket when the native ticket card renders',async()=>{
    const ticket={component:'sports_ticket_card',version:1,props:{
      title:'Pronóstico del día',source:'ESPN',note:'Pronóstico, no apuesta',
      combinedOdds:'No disponible',legs:[{event:'New York Knicks vs Indiana Pacers',
        selection:'New York Knicks',price:'No disponible',bookmaker:'ESPN',
        market:'Ganador · Pronóstico',sport:'basketball',league:'NBA',providerLeague:'nba',
        eventDate:'2026-11-13',eventId:'401123456',homeTeam:'Indiana Pacers',awayTeam:'New York Knicks'}],
    }}
    const parsed=parseGenerativeUiBlock(ticket)
    expect(parsed?.component).toBe('sports_ticket_card')
    if(!parsed)throw Error('invalid ticket test fixture')
    render(<GenerativeUi block={parsed}/>)
    await waitFor(()=>expect(localStorage.length).toBeGreaterThan(0))
    const {container}=render(<SportsMarkedMatch {...props}/>)
    expect(container.querySelector('[data-pick-source="forecast"]')).toBeTruthy()
    expect(container.querySelector('[data-selected-pick="true"]')?.textContent).toContain('Pronóstico Kira')
  })
})
