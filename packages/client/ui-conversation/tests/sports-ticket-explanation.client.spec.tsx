// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest'
import {cleanup,render,screen} from '@testing-library/react'
import {GenerativeUi,parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'

const ticket=(legs:Array<Record<string,unknown>>)=>({
  component:'sports_ticket_card',version:1,props:{
    title:'Ticket PHOENIX',source:'ESPN',note:'Pronóstico sujeto a corroboración',
    combinedOdds:'No disponible',requestedLegs:legs.length,
    legs,
  },
})
const leg={
  event:'Cleveland Cavaliers vs Charlotte Hornets',selection:'Cleveland Cavaliers',
  price:'No disponible',bookmaker:'Sin casa verificada',market:'Ganador',
  sport:'basketball',league:'nba',
  homeTeam:'Charlotte Hornets',awayTeam:'Cleveland Cavaliers',
  eventDate:'2026-11-09',eventId:'9001',
}
const show=(input:unknown)=>{
  const parsed=parseGenerativeUiBlock(input)
  expect(parsed).not.toBeNull()
  return render(<GenerativeUi block={parsed!}/>)
}
afterEach(cleanup)
describe('explainability of every unpriced forecast',()=>{
  it('shows a missing injury and lineup disclosure when research was not delivered',()=>{
    show(ticket([{...leg,rationale:'Forma reciente, todavía sin investigar las bajas.'}]))
    expect(screen.getByText('Kira · Revisión individual de las selecciones')).toBeTruthy()
    expect(screen.getByText(/No hay expediente completo de lesiones, titulares/)).toBeTruthy()
    expect(screen.getAllByText(/Forma reciente, todavía sin investigar las bajas/).length).toBeGreaterThan(0)
  })
})
