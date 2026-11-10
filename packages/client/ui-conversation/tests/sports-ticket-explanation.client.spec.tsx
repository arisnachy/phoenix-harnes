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

const dossier={
  eventId:'9001',selected:'Cleveland Cavaliers',
  title:'Cleveland Cavaliers vs Charlotte Hornets',status:'conditional',
  selectionWhy:'Comparación de forma con lesiones bilaterales comprobadas.',
  favorable:['Historial verificado'],contradictions:['Jarrett Allen cuestionable'],
  specialistEvidence:[],criticalPending:['Quintetos sin confirmar'],
  researchSteps:[
    {key:'injuries',title:'Lesiones NBA',critical:true,state:'verified',
      detail:'ESPN 4 bajas de Cleveland y 3 de Charlotte',
      sources:['ESPN basketball/nba/injuries','NBA official injury PDF']},
    {key:'starters',title:'Quintetos',critical:true,state:'partial',
      detail:'Dos titulares no confirmados',
      sources:['ESPN summary boxscore']},
  ],
  news:[],globalNews:[],externalOpinions:[],
  externalModel:{provider:'Bet Better',status:'unavailable',
    selection:null,modelProbabilityPercent:null,updatedAt:null,sourceUrl:null},
  venue:{name:'Arena',city:'Cleveland',venueSplit:'not-verified',
    games:0,wins:0,losses:0},
  directOpponentHistory:{status:'not-verified',note:'sin encuentros',
    games:0,wins:0,losses:0},
  referee:{names:[],bias:'not-assessed',note:'sin asignación'},
  weather:{status:'not-applicable',description:'Baloncesto bajo techo',source:null},
  imagery:{imageUrl:null,articleUrl:null,attribution:null},
  percentage:{value:null,kind:'unavailable',warning:'Sin calibración'},
  sources:[],explanationForChat:'Investigar las lesiones antes de apostar',
}
describe('actual ESPN observation and transparent step-by-step research',()=>{
  it('renders verified injury stats, per-step sources and an undated ESPN price',()=>{
    show(ticket([{...leg,narrative:dossier,referenceOdds:{
      bookmaker:'DraftKings',price:1.09,reason:'sin_fecha',source:'core',
      nonCotizable:true,
    },webOddsResearch:[{
      provider:'ESPN',url:'https://www.espn.com/nba/odds',status:'page-accessible',
      pageObservedAt:'2026-11-10T11:30:00Z',quoteUpdatedAt:null,
      bookmakerVerified:false,referenceMoneylines:[],
    }]}]))
    expect(screen.getByText(/ESPN Core · DraftKings/)).toBeTruthy()
    expect(screen.getByText(/Checklist de investigación/)).toBeTruthy()
    expect(screen.getByText(/Lesiones NBA/)).toBeTruthy()
    expect(screen.getByText(/4 bajas de Cleveland/)).toBeTruthy()
  })
})
