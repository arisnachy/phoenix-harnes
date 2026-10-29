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
    expect(screen.getByText('⚽')).toBeTruthy()
    expect(screen.getByText('⚾')).toBeTruthy()
    expect(screen.getAllByText(/Casa A/).length).toBe(2)
    expect(screen.getByText('6.350')).toBeTruthy()
    expect(screen.getByText('Solo análisis · No se ha realizado ninguna apuesta')).toBeTruthy()
  })
  it('preserves detailed sourced research while rejecting excessive model prose',()=>{
    const detailed={...ticket,props:{...ticket.props,legs:[
      {...ticket.props.legs[0],rationale:'ESPN · 5 partidos diferentes · '.padEnd(470,'x')},
    ]}}
    expect(parseGenerativeUiBlock(detailed)).not.toBeNull()
    expect(parseGenerativeUiBlock({...detailed,props:{...detailed.props,legs:[
      {...detailed.props.legs[0],rationale:'x'.repeat(481)},
    ]}})).toBeNull()
  })
  it('rejects arbitrary fields and external images from tickets',()=>{
    expect(parseGenerativeUiBlock({...ticket,props:{...ticket.props,legs:[
      {...ticket.props.legs[0],html:'<iframe />'}]}})).toBeNull()
    expect(parseGenerativeUiBlock({...ticket,props:{...ticket.props,legs:[
      {...ticket.props.legs[0],image:'https://untrusted.example/bad.png'}]}})).toBeNull()
  })
})

describe('No fake tickets when strict research finds zero eligible matches',()=>{
  const draft={component:'sports_ticket_card',version:1,props:{
    title:'PHOENIX · Investigación insuficiente',source:'ESPN',
    requestedLegs:5,legs:[],combinedOdds:'No disponible',
    note:'TICKET INCOMPLETO: faltan 5 eventos; no inventar favoritos.',
  }}
  it('renders an explicit 0/5 draft instead of blank chat or made-up odds',()=>{
    const card=parseGenerativeUiBlock(draft)
    expect(card).not.toBeNull()
    if(!card)throw Error('Incomplete draft rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByRole('progressbar',{name:'Patas verificadas'}).getAttribute('aria-valuenow')).toBe('0')
    expect(screen.getByText(/Faltan 5 selecciones por verificar/)).toBeTruthy()
    expect(screen.queryByText('CUOTA')).toBeNull()
  })
  it('does not accept empty finished tickets without explicit incomplete evidence',()=>{
    expect(parseGenerativeUiBlock({...draft,props:{...draft.props,
      note:'Este es un ticket completo',combinedOdds:'7.50'}})).toBeNull()
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
    expect(screen.getAllByLabelText('Partido verificado')).toHaveLength(5)
    expect(screen.queryByText('Por verificar')).toBeNull()
    expect(screen.queryByText('Sin casa confirmada')).toBeNull()
    expect(screen.getByText('Pendientes de confirmar')).toBeTruthy()
  })
  it('marks an incomplete ticket clearly and rejects mismatched overfilled counts',()=>{
    const props={title:'Borrador',source:'ESPN',combinedOdds:'No disponible',
      requestedLegs:5,note:'Incompleto',legs:[makeLeg(1)]}
    const card=parseGenerativeUiBlock({component:'sports_ticket_card',version:1,props})
    expect(card).not.toBeNull()
    if(!card)throw Error('Draft card rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByText('BORRADOR INCOMPLETO')).toBeTruthy()
    expect(screen.getByText(/Faltan 4 selecciones/)).toBeTruthy()
    expect(screen.getByRole('progressbar',{name:'Patas verificadas'}).getAttribute('aria-valuenow')).toBe('1')
    expect(parseGenerativeUiBlock({component:'sports_ticket_card',version:1,
      props:{...props,requestedLegs:0}})).toBeNull()
  })
})

describe('Phoenix ticket verified team logos and no price hallucinations',()=>{
  it('shows provider team logos with correct names and ONE quote-status summary',()=>{
    const ticket={component:'sports_ticket_card',version:1,props:{
      title:'Phoenix ticket',source:'ESPN Site API',combinedOdds:'No disponible',
      note:'Solo análisis',requestedLegs:1,legs:[{
        event:'Phoenix Suns vs Oklahoma City Thunder',selection:'Oklahoma City Thunder',
        price:'Por verificar',bookmaker:'Sin casa confirmada',market:'Ganador',
        homeTeam:'Oklahoma City Thunder',awayTeam:'Phoenix Suns',
        homeLogo:'https://a.espncdn.com/okc-logo.png',awayLogo:'https://a.espncdn.com/phx-logo.png',
      }],
    }}
    const card=parseGenerativeUiBlock(ticket)
    expect(card).not.toBeNull()
    if(!card)throw Error('Valid ticket rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByAltText('Oklahoma City Thunder')).toBeTruthy()
    expect(screen.getByAltText('Phoenix Suns')).toBeTruthy()
    expect(screen.getAllByText('Pendientes de confirmar')).toHaveLength(1)
    expect(screen.queryByText('Por verificar')).toBeNull()
    expect(screen.queryByText('Sin casa confirmada')).toBeNull()
    expect(screen.getByLabelText('Partido verificado')).toBeTruthy()
  })
  it('rejects untrusted team logos in a ticket',()=>{
    const card={component:'sports_ticket_card',version:1,props:{
      title:'Ticket',source:'ESPN',combinedOdds:'No disponible',note:'Solo análisis',
      legs:[{event:'A vs B',selection:'A',price:'Por verificar',
        bookmaker:'Sin casa confirmada',homeTeam:'A',homeLogo:'https://example.invalid/logo.svg'}],
    }}
    expect(parseGenerativeUiBlock(card)).toBeNull()
  })
})


describe('Universal chat: compact sports schedules do not replace single-game cards',()=>{
  const slate={
    component:'sports_schedule_card',version:1,props:{
      title:'Cartelera deportiva',date:'2026-10-28',sport:'basketball',league:'NBA',
      source:'ESPN Site API · 2026-10-28T17:00:00Z',total:2,
      events:[
        {eventId:'evt-1',when:'28 oct 2026, 7:00 p. m.',status:'Programado',
          away:{label:'Miami Heat'},home:{label:'Atlanta Hawks'},venue:'State Farm Arena',
          featured:'Líder verificado · 20 PTS',askPrompt:'Kira, investiga el evento evt-1.'},
        {eventId:'evt-2',when:'28 oct 2026, 8:00 p. m.',
          away:{label:'Houston Rockets'},home:{label:'Los Angeles Lakers'},venue:'Crypto.com Arena'},
      ],
    },
  } as const
  it('renders multiple games in one responsive response surface with no new navigation',()=>{
    const parsed=parseGenerativeUiBlock(slate)
    expect(parsed).not.toBeNull()
    if(!parsed)throw Error('Schedule validation failed')
    render(<GenerativeUi block={parsed}/>)
    expect(document.querySelectorAll('[data-generative-ui="sports_schedule_card"]')).toHaveLength(1)
    expect(screen.getByText('Miami Heat')).toBeTruthy()
    expect(screen.getByText('Los Angeles Lakers')).toBeTruthy()
    expect(screen.getByText('2 juegos')).toBeTruthy()
    expect(screen.queryByText('Sin cuota')).toBeNull()
    expect(screen.queryByText(/%/)).toBeNull()
  })
  it('offers an actionable drilldown without replacing the rich individual card',()=>{
    const parsed=parseGenerativeUiBlock(slate)
    if(!parsed)throw Error('Schedule validation failed')
    const actions:string[]=[]
    render(<GenerativeUi block={parsed} onAction={(message,mode)=>{
      actions.push(message+':'+mode)
    }}/>)
    fireEvent.click(screen.getByRole('button',{name:'Ver análisis del encuentro ›'}))
    expect(actions).toEqual(['Kira, investiga el evento evt-1.:draft'])
    expect(parseGenerativeUiBlock(rich)?.component).toBe('sports_game_card')
  })
  it('rejects untrusted images, spoofed favorite fields and excessive matches',()=>{
    const events=[...slate.props.events]
    expect(parseGenerativeUiBlock({...slate,props:{...slate.props,events:[
      {...events[0],away:{label:'Heat',logo:'https://untrusted.example/logo.png'}},events[1],
    ]}})).toBeNull()
    expect(parseGenerativeUiBlock({...slate,props:{...slate.props,events:[
      {...events[0],probability:99},events[1],
    ]}})).toBeNull()
    expect(parseGenerativeUiBlock({...slate,props:{...slate.props,events:Array.from({length:26},()=>events[0])}})).toBeNull()
  })
})
