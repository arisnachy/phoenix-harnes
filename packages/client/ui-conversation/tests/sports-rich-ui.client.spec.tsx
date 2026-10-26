// @vitest-environment jsdom
import {describe,expect,it,afterEach} from 'vitest'
import {render,screen,fireEvent,cleanup} from '@testing-library/react'
import {parseGenerativeUiBlock,GenerativeUi} from '../src/client/chat/GenerativeUi.tsx'
afterEach(cleanup)
const trusted='https://img.mlbstatic.com/mlb-photos/image/upload/v1/people/678021/headshot/67/current'
const rich={
  component:'sports_game_card',version:1,props:{
    sport:'baseball',eventId:'849802',title:'Milwaukee Brewers vs Tampa Bay Rays',
    subtitle:'World Series · Juego 2',status:'Pre-Game',when:'24 oct 2026, 8:00 p. m.',
    venue:'American Family Field',source:'MLB Stats API · 2026-10-24',
    home:{label:'Milwaukee Brewers',logo:'https://www.mlbstatic.com/team-logos/158.svg'},
    away:{label:'Tampa Bay Rays',logo:'https://www.mlbstatic.com/team-logos/139.svg'},
    pitchers:[{team:'Tampa Bay Rays',name:'Starter Away',id:678021,probable:true,image:trusted,stats:'ERA 2.91 · WHIP 1.02'}],
    lineups:[{team:'Rays',confirmed:false,players:[{name:'Player 1',role:'DH',stats:'AVG .300'}]},
      {team:'Brewers',confirmed:false,players:[]}],
    bullpen:[{team:'Rays',pitchers:[{name:'Reliever',role:'Pitcher',stats:'ERA 3.01'}],note:'Roster activo'},
      {team:'Brewers',pitchers:[],note:'Sin confirmar'}],
    research:{favorite:'Sin favorito consistente',method:'Comparación de temporada, no predicción calibrada',
      source:'MLB standings',evidence:['Rays 90-70','Brewers 91-69']},
    note:'Alineaciones sujetas a confirmación',
  },
}
const markets={component:'sports_odds_card',version:1,props:{
  title:'Rays vs Brewers',source:'ESPN Site/Core',
  rows:[{event:'Rays vs Brewers',market:'h2h',selection:'Brewers',bookmaker:'Book',price:'1.92'}],
  note:'Cuotas sujetas a cambios',
}}
describe('Phoenix Sports rich native cards',()=>{
  it('validates full ESPN-style matchup, player imagery, lineup, bullpen and Phoenix research',()=>{
    const parsed=parseGenerativeUiBlock(rich)
    expect(parsed).toEqual(rich)
    if(!parsed)throw Error('Rich card rejected')
    const rendered=GenerativeUi({block:parsed}) as {props:Record<string,unknown>}
    expect(rendered.props['data-generative-ui']).toBe('sports_game_card')
  })
  it('shows ESPN-style team images, pitcher stats, lineup tabs and bullpen modules inside the Phoenix chat',()=>{
    const card=parseGenerativeUiBlock(rich)
    if(!card)throw Error('Fixture rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByRole('heading',{name:'Abridores probables'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Alineaciones'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Bullpen y cuerpo de lanzadores'})).toBeTruthy()
    expect(screen.getByRole('heading',{name:'Investigación Phoenix · Tendencia'})).toBeTruthy()
    expect(screen.getByAltText('Milwaukee Brewers')).toBeTruthy()
    expect(screen.getByAltText('Tampa Bay Rays')).toBeTruthy()
    expect(screen.getByAltText('Starter Away')).toBeTruthy()
    expect(screen.getByText(/ERA 2.91/)).toBeTruthy()
    expect(screen.getByText(/Bateador/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Brewers'}))
    expect(screen.getByText(/todavía no publicó la alineación/)).toBeTruthy()
    expect(screen.getByText(/Sin datos de bullpen verificables/)).toBeTruthy()
  })
  it('rejects untrusted images, injected markup, overlong rosters and unsupported research',()=>{
    expect(parseGenerativeUiBlock({...rich,props:{...rich.props,home:{label:'Home',logo:'https://evil.example/tracker'}}})).toBeNull()
    expect(parseGenerativeUiBlock({...rich,props:{...rich.props,html:'<script/>'}})).toBeNull()
    expect(parseGenerativeUiBlock({...rich,props:{...rich.props,lineups:[{team:'Rays',confirmed:true,
      players:Array.from({length:50},()=>({name:'Unverified'}))}]}})).toBeNull()
    expect(parseGenerativeUiBlock({...rich,props:{...rich.props,research:{favorite:'Winner',method:'trust me'}}})).toBeNull()
  })
  it('accepts bookmaker prices only with provider and selection provenance',()=>{
    const parsed=parseGenerativeUiBlock(markets)
    expect(parsed).toEqual(markets)
    expect(parseGenerativeUiBlock({...markets,props:{...markets.props,rows:[{market:'h2h',price:'2.00'}]}})).toBeNull()
  })
  it('allows no-image UI with explicit missing-data state',()=>{
    expect(parseGenerativeUiBlock({...rich,props:{...rich.props,home:{label:'Local'},away:{label:'Visita'},
      pitchers:[],lineups:[{team:'Visita',confirmed:false,players:[]},{team:'Local',confirmed:false,players:[]}],
      bullpen:[{team:'Visita',pitchers:[],note:'Sin datos'}]}})).not.toBeNull()
  })
})

describe('Phoenix Sports ticket hierarchy and theme compatibility',()=>{
  const ticket={
    component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de análisis',source:'Casas verificadas',combinedOdds:'6.350',
      note:'SIMULACIÓN, SIN APUESTA REAL. No es una recomendación garantizada.',
      legs:[
        {event:'Arsenal vs Chelsea',selection:'Arsenal',price:'1.80',bookmaker:'Casa A',market:'h2h',
          sport:'Fútbol',country:'Inglaterra',league:'Premier League'},
        {event:'Liverpool vs Leeds',selection:'Liverpool',price:'1.70',bookmaker:'Casa A',market:'h2h',
          sport:'Fútbol',country:'Inglaterra',league:'Premier League'},
        {event:'Brewers vs Rays',selection:'Brewers',price:'2.08',bookmaker:'Casa B',market:'h2h',
          sport:'Béisbol',league:'MLB'},
      ],
    },
  } as const
  it('groups by sport / country / league and keeps every original price and bookmaker',()=>{
    const block=parseGenerativeUiBlock(ticket)
    expect(block).not.toBeNull()
    if(!block)throw Error('Ticket fixture rejected')
    render(<GenerativeUi block={block}/>)
    expect(screen.getByRole('region',{name:'Fútbol · Inglaterra · Premier League'})).toBeTruthy()
    expect(screen.getByRole('region',{name:'Béisbol · MLB'})).toBeTruthy()
    expect(screen.getAllByText(/Casa A/).length).toBe(2)
    expect(screen.getByText('6.350')).toBeTruthy()
    expect(screen.getByText('Solo análisis · No se ha realizado ninguna apuesta')).toBeTruthy()
  })
  it('rejects arbitrary fields and external images from tickets',()=>{
    expect(parseGenerativeUiBlock({...ticket,props:{...ticket.props,legs:[
      {...ticket.props.legs[0],html:'<iframe />'}]}})).toBeNull()
    expect(parseGenerativeUiBlock({...ticket,props:{...ticket.props,legs:[
      {...ticket.props.legs[0],image:'https://untrusted.example/bad.png'}]}})).toBeNull()
  })
})

describe('Five-leg Phoenix ticket completion and compact progress',()=>{
  const makeLeg=(i:number)=>({
    event:'Away '+i+' vs Home '+i,
    selection:'Home '+i,
    price:'Por verificar',
    bookmaker:'Sin casa confirmada',
    sport:'Baloncesto',
    league:'NBA',
    market:'Ganador · Pronóstico',
    rationale:'Forma reciente y localía; sin probabilidad calibrada.',
  })
  it('renders all five numbered legs and an accessible complete progress indicator',()=>{
    const fixture={component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de pronósticos',source:'ESPN Site API',
      combinedOdds:'No disponible',requestedLegs:5,note:'SIN APUESTA REAL',
      legs:Array.from({length:5},(_,i)=>makeLeg(i+1)),
    }}
    const card=parseGenerativeUiBlock(fixture)
    expect(card).not.toBeNull()
    if(!card)throw Error('Five-leg ticket rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByRole('progressbar',{name:'Patas verificadas'}).getAttribute('aria-valuenow')).toBe('5')
    expect(screen.getByText('05')).toBeTruthy()
    expect(screen.getAllByText('Ver fundamento')).toHaveLength(5)
    expect(screen.getByText('Home 5')).toBeTruthy()
    expect(screen.getByText('Sin verificar')).toBeTruthy()
  })
  it('marks an incomplete ticket clearly and rejects mismatched overfilled counts',()=>{
    const props={title:'Borrador',source:'ESPN',combinedOdds:'No disponible',
      requestedLegs:5,note:'Incompleto',legs:[makeLeg(1)]}
    const card=parseGenerativeUiBlock({component:'sports_ticket_card',version:1,props})
    expect(card).not.toBeNull()
    if(!card)throw Error('Draft card rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByText('INCOMPLETO')).toBeTruthy()
    expect(screen.getByText(/Faltan 4 selecciones/)).toBeTruthy()
    expect(screen.getByRole('progressbar',{name:'Patas verificadas'}).getAttribute('aria-valuenow')).toBe('1')
    expect(parseGenerativeUiBlock({component:'sports_ticket_card',version:1,
      props:{...props,requestedLegs:0}})).toBeNull()
  })
})
