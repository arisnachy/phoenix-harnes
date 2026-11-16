// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {SportsMarkedMatch,SportsUserHistorySummary} from '../src/client/chat/SportsMarkedMatch.tsx'
import {importSportsForecast} from '../src/client/chat/SportsForecastAutoLink.ts'
import {sportsUserChoiceKey,readSportsUserChoice,sportsUserHistory} from '../src/client/chat/SportsUserPick.ts'
import type {PhoenixLiveGame,PhoenixLiveMeta} from '../src/client/chat/SportsLive.tsx'

const away={label:'Brooklyn Nets'}
const home={label:'Philadelphia 76ers'}
const fixture={sport:'basketball',league:'nba',date:'2026-11-16',eventId:'401812345',
  away:away.label,home:home.label}
const meta:PhoenixLiveMeta={updatedAt:Date.now(),stale:false,error:false,enabled:true}
const live=(phase:PhoenixLiveGame['phase'],awayScore='100',homeScore='110'):PhoenixLiveGame=>({
  id:fixture.eventId,away:away.label,home:home.label,phase,status:phase==='post'?'Final':'En vivo',
  awayScore,homeScore,
})
const card=(game?:PhoenixLiveGame)=> <SportsMarkedMatch away={away} home={home}
  hasStarted={game?.phase==='in'||game?.phase==='post'} sport={fixture.sport}
  league={fixture.league} date={fixture.date} eventId={fixture.eventId}
  favorite="Philadelphia 76ers" game={game} meta={meta}/>
afterEach(()=>{cleanup();localStorage.clear()})

describe('PHOENIX independent favorite tracking',()=>{
  it('keeps the manual favorite over reload and allows changing or removing the selection',()=>{
    const key=sportsUserChoiceKey(fixture)
    expect(key).toBeTruthy()
    const ui=render(card())
    fireEvent.click(screen.getByRole('button',{name:'Elegir mi favorito: Brooklyn Nets'}))
    expect(readSportsUserChoice(key)?.side).toBe('away')
    expect(screen.getByText('✓ Tu elección')).toBeTruthy()
    ui.unmount()
    const remounted=render(card())
    expect(screen.getByRole('button',{name:'Quitar mi favorito: Brooklyn Nets'})).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Elegir mi favorito: Philadelphia 76ers'}))
    expect(readSportsUserChoice(key)?.side).toBe('home')
    fireEvent.click(screen.getByRole('button',{name:'Quitar mi favorito: Philadelphia 76ers'}))
    expect(readSportsUserChoice(key)).toBeNull()
    remounted.unmount()
  })
  it('shows user and PHOENIX on opposite teams without replacing either one',()=>{
    expect(importSportsForecast([{
      sport:'basketball',league:'NBA',providerLeague:'nba',eventId:fixture.eventId,
      eventDate:fixture.date,homeTeam:home.label,awayTeam:away.label,
      event:'Brooklyn Nets vs Philadelphia 76ers',selection:home.label,market:'moneyline',
    }])).toBe(1)
    render(card())
    fireEvent.click(screen.getByRole('button',{name:'Elegir mi favorito: Brooklyn Nets'}))
    expect(screen.getByText('✦ PHOENIX eligió')).toBeTruthy()
    expect(screen.getByText('✓ Tu elección')).toBeTruthy()
    expect(document.querySelectorAll('[data-selected-user="true"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-selected-phoenix="true"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-pick-origin="forecast"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-pick-origin="user"]')).toHaveLength(1)
  })
  it('grades live and final sporting outcomes by exact fixture, then counts only pregame history',()=>{
    const ui=render(<><SportsUserHistorySummary/>{card()}</>)
    fireEvent.click(screen.getByRole('button',{name:'Elegir mi favorito: Brooklyn Nets'}))
    ui.rerender(<><SportsUserHistorySummary/>{card(live('in','102','100'))}</>)
    expect(document.querySelector('[data-pick-origin="user"]')?.getAttribute('data-pick-status')).toBe('leading')
    expect(screen.getByText('Va acertando')).toBeTruthy()
    ui.rerender(<><SportsUserHistorySummary/>{card(live('post','102','100'))}</>)
    expect(document.querySelector('[data-pick-origin="user"]')?.getAttribute('data-pick-status')).toBe('won')
    expect(sportsUserHistory()).toMatchObject({won:1,lost:0,pending:0,accuracy:100})
    expect(screen.getByText(/Mis favoritos:/)).toBeTruthy()
    expect(screen.getByText(/Acertó · resultado deportivo/)).toBeTruthy()
    expect(screen.queryByRole('button',{name:/Elegir mi favorito/})).toBeNull()
  })
  it('never grades a mismatched ESPN event or counts choices first made in-play',()=>{
    const ui=render(card(live('in','90','85')))
    fireEvent.click(screen.getByRole('button',{name:'Elegir mi favorito: Brooklyn Nets'}))
    expect(readSportsUserChoice(sportsUserChoiceKey(fixture))?.eligibleForHistory).toBe(false)
    ui.rerender(card({...live('post','105','95'),id:'999999999'}))
    expect(document.querySelector('[data-pick-origin="user"]')?.getAttribute('data-pick-status')).toBe('pending')
    expect(sportsUserHistory()).toMatchObject({won:0,lost:0,pending:0,accuracy:null})
    ui.rerender(card(live('post','105','95')))
    expect(document.querySelector('[data-pick-origin="user"]')?.getAttribute('data-pick-status')).toBe('won')
    expect(sportsUserHistory()).toMatchObject({won:0,lost:0,pending:0,accuracy:null})
  })
  it('does not offer manual marking without verified fixture fields',()=>{
    render(<SportsMarkedMatch away={away} home={home} hasStarted={false}
      sport="basketball" league="nba" date="2026-11-16" eventId="invalid"/>)
    expect(screen.queryByRole('button',{name:/Elegir mi favorito:/})).toBeNull()
    expect(sportsUserChoiceKey({...fixture,eventId:'not-numeric'})).toBeNull()
  })
})
