// @vitest-environment jsdom
import { describe,expect,it,afterEach } from 'vitest'
import { render,screen,fireEvent,cleanup } from '@testing-library/react'
import { parseGenerativeUiBlock,GenerativeUi } from '../src/client/chat/GenerativeUi.tsx'
afterEach(cleanup)
const trusted='https://img.mlbstatic.com/mlb-photos/image/upload/v1/people/678021/headshot/67/current'
const rich={
  component:'sports_game_card',version:1,props:{
    sport:'baseball',eventId:'849802',title:'Milwaukee Brewers vs Tampa Bay Rays',
    subtitle:'World Series · Juego 2',status:'Pre-Game',when:'24 oct 2026, 8:00 p. m.',
    venue:'American Family Field',source:'MLB Stats API · 2026-10-24',
    home:{ label:'Milwaukee Brewers',logo:'https://www.mlbstatic.com/team-logos/158.svg' },
    away:{ label:'Tampa Bay Rays',logo:'https://www.mlbstatic.com/team-logos/139.svg' },
    pitchers:[{ team:'Tampa Bay Rays',name:'Starter Away',id:678021,probable:true,image:trusted,stats:'ERA 2.91 · WHIP 1.02' }],
    lineups:[{ team:'Rays',confirmed:false,players:[{ name:'Player 1',role:'DH',stats:'AVG .300' }] },
      { team:'Brewers',confirmed:false,players:[] }],
    bullpen:[{ team:'Rays',pitchers:[{ name:'Reliever',role:'Pitcher',stats:'ERA 3.01' }],note:'Roster activo' },
      { team:'Brewers',pitchers:[],note:'Sin confirmar' }],
    research:{ favorite:'Sin favorito consistente',method:'Comparación de temporada, no predicción calibrada',
      source:'MLB standings',evidence:['Rays 90-70','Brewers 91-69'] },
    note:'Alineaciones sujetas a confirmación',
  },
}
const markets={ component:'sports_odds_card',version:1,props:{
  title:'Rays vs Brewers',source:'ESPN Site/Core',
  rows:[{ event:'Rays vs Brewers',market:'h2h',selection:'Brewers',bookmaker:'Book',price:'1.92' }],
  note:'Cuotas sujetas a cambios',
} }
describe('Phoenix Sports rich native cards',()=>{
  it('validates full ESPN-style matchup, player imagery, lineup, bullpen and Phoenix research',()=>{
    const parsed=parseGenerativeUiBlock(rich)
    expect(parsed).toEqual(rich)
    if(!parsed)throw Error('Rich card rejected')
    const rendered=GenerativeUi({ block:parsed }) as { props:Record<string,unknown> }
    expect(rendered.props.sport).toBe('baseball')
  })
  it('shows ESPN-style team images, pitcher stats, lineup tabs and bullpen modules inside the Phoenix chat',()=>{
    const card=parseGenerativeUiBlock(rich)
    if(!card)throw Error('Fixture rejected')
    render(<GenerativeUi block={card}/>)
    fireEvent.click(screen.getByText('Ver estadísticas y análisis'))
    expect(screen.getByRole('heading',{ name:'Abridores probables' })).toBeTruthy()
    expect(screen.getByRole('heading',{ name:'Alineaciones' })).toBeTruthy()
    expect(screen.getByRole('heading',{ name:'Bullpen y cuerpo de lanzadores' })).toBeTruthy()
    expect(screen.getByRole('heading',{ name:'Investigación Phoenix · Tendencia' })).toBeTruthy()
    expect(screen.getByAltText('Milwaukee Brewers')).toBeTruthy()
    expect(screen.getByAltText('Tampa Bay Rays')).toBeTruthy()
    expect(screen.getByAltText('Starter Away')).toBeTruthy()
    expect(screen.getByText(/ERA 2.91/)).toBeTruthy()
    expect(screen.getByText(/Bateador/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{ name:'Brewers' }))
    expect(screen.getByText(/todavía no publicó la alineación/)).toBeTruthy()
    expect(screen.getByText(/Sin datos de bullpen verificables/)).toBeTruthy()
  })
  it('rejects untrusted images, injected markup, overlong rosters and unsupported research',()=>{
    expect(parseGenerativeUiBlock({ ...rich,props:{ ...rich.props,home:{ label:'Home',logo:'https://evil.example/tracker' } } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...rich,props:{ ...rich.props,html:'<script/>' } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...rich,props:{ ...rich.props,lineups:[{ team:'Rays',confirmed:true,
      players:Array.from({ length:50 },()=>({ name:'Unverified' })) }] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...rich,props:{ ...rich.props,research:{ favorite:'Winner',method:'trust me' } } })).toBeNull()
  })
  it('accepts bookmaker prices only with provider and selection provenance',()=>{
    const parsed=parseGenerativeUiBlock(markets)
    expect(parsed).toEqual(markets)
    expect(parseGenerativeUiBlock({ ...markets,props:{ ...markets.props,rows:[{ market:'h2h',price:'2.00' }] } })).toBeNull()
  })
  it('allows no-image UI with explicit missing-data state',()=>{
    expect(parseGenerativeUiBlock({ ...rich,props:{ ...rich.props,home:{ label:'Local' },away:{ label:'Visita' },
      pitchers:[],lineups:[{ team:'Visita',confirmed:false,players:[] },{ team:'Local',confirmed:false,players:[] }],
      bullpen:[{ team:'Visita',pitchers:[],note:'Sin datos' }] } })).not.toBeNull()
  })
})

describe('Phoenix Sports ticket hierarchy and theme compatibility',()=>{
  const ticket={
    component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de análisis',source:'Casas verificadas',combinedOdds:'6.350',
      note:'SIMULACIÓN, SIN APUESTA REAL. No es una recomendación garantizada.',
      legs:[
        { event:'Arsenal vs Chelsea',selection:'Arsenal',price:'1.80',bookmaker:'Casa A',market:'h2h',
          sport:'Fútbol',country:'Inglaterra',league:'Premier League' },
        { event:'Liverpool vs Leeds',selection:'Liverpool',price:'1.70',bookmaker:'Casa A',market:'h2h',
          sport:'Fútbol',country:'Inglaterra',league:'Premier League' },
        { event:'Brewers vs Rays',selection:'Brewers',price:'2.08',bookmaker:'Casa B',market:'h2h',
          sport:'Béisbol',league:'MLB' },
      ],
    },
  } as const
  it('groups by sport / country / league and keeps every original price and bookmaker',()=>{
    const block=parseGenerativeUiBlock(ticket)
    expect(block).not.toBeNull()
    if(!block)throw Error('Ticket fixture rejected')
    render(<GenerativeUi block={block}/>)
    expect(screen.getByRole('region',{ name:'Fútbol · Inglaterra · Premier League' })).toBeTruthy()
    expect(screen.getByRole('region',{ name:'Béisbol · MLB' })).toBeTruthy()
    expect(screen.getByText('⚽')).toBeTruthy()
    expect(screen.getByText('⚾')).toBeTruthy()
    expect(screen.getAllByText(/Casa A/).length).toBe(2)
    expect(screen.getByText('6.350')).toBeTruthy()
    expect(screen.getByText('Ticket investigado · Aceptación de la casa sin verificar')).toBeTruthy()
  })
  it('recalculates real-quote potential gross and net return as the RD$ stake changes',()=>{
    const card=parseGenerativeUiBlock({ ...ticket,props:{ ...ticket.props,stake:'100' } })
    if(!card)throw Error('Invalid quoted ticket')
    const { container }=render(<GenerativeUi block={card}/>)
    expect(screen.getByLabelText('Importe de apuesta (RD$)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Importe de apuesta (RD$)'),{ target:{ value:'200' } })
    expect(container.textContent).toMatch(/1[,.]270[,.]00/)
    expect(container.textContent).toMatch(/1[,.]070[,.]00/)
    expect(screen.getByText(/COTIZACIÓN REAL · SIN ACEPTACIÓN CONFIRMADA/)).toBeTruthy()
  })
  it('provides a deliberate follow-up action, never fabricates a paid wager',()=>{
    let prompt=''
    const card=parseGenerativeUiBlock(ticket)
    if(!card)throw Error('Invalid quoted ticket')
    render(<GenerativeUi block={card} onAction={(value)=>{prompt=value}}/>)
    fireEvent.click(screen.getByRole('button',{ name:'Verificar si ganó o perdió' }))
    expect(prompt).toContain('sports_chat_ticket_track')
    expect(prompt).toContain('Casa A')
    expect(screen.getByText(/Aceptación de la casa sin verificar/)).toBeTruthy()
  })
  it('preserves detailed sourced research while rejecting excessive model prose',()=>{
    const detailed={ ...ticket,props:{ ...ticket.props,legs:[
      { ...ticket.props.legs[0],rationale:'ESPN · 5 partidos diferentes · '.padEnd(470,'x') },
    ] } }
    expect(parseGenerativeUiBlock(detailed)).not.toBeNull()
    expect(parseGenerativeUiBlock({ ...detailed,props:{ ...detailed.props,legs:[
      { ...detailed.props.legs[0],rationale:'x'.repeat(481) },
    ] } })).toBeNull()
  })
  it('rejects arbitrary fields and external images from tickets',()=>{
    expect(parseGenerativeUiBlock({ ...ticket,props:{ ...ticket.props,legs:[
      { ...ticket.props.legs[0],html:'<iframe />' }] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...ticket,props:{ ...ticket.props,legs:[
      { ...ticket.props.legs[0],image:'https://untrusted.example/bad.png' }] } })).toBeNull()
  })
})

describe('No fake tickets when strict research finds zero eligible matches',()=>{
  const draft={ component:'sports_ticket_card',version:1,props:{
    title:'PHOENIX · Investigación insuficiente',source:'ESPN',
    requestedLegs:5,legs:[],combinedOdds:'No disponible',
    note:'TICKET INCOMPLETO: faltan 5 eventos; no inventar favoritos.',
  } }
  it('renders an explicit 0/5 draft instead of blank chat or made-up odds',()=>{
    const card=parseGenerativeUiBlock(draft)
    expect(card).not.toBeNull()
    if(!card)throw Error('Incomplete draft rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByRole('progressbar',{ name:'Patas verificadas' }).getAttribute('aria-valuenow')).toBe('0')
    expect(screen.getByText(/Faltan 5 selecciones por verificar/)).toBeTruthy()
    expect(screen.getByText(/0 \/ 5 selecciones con cuotas de una misma casa confirmadas/)).toBeTruthy()
    expect(screen.queryByText('CUOTA')).toBeNull()
  })
  it('does not accept empty finished tickets without explicit incomplete evidence',()=>{
    expect(parseGenerativeUiBlock({ ...draft,props:{ ...draft.props,
      note:'Este es un ticket completo',combinedOdds:'7.50' } })).toBeNull()
  })
})
describe('Five-leg Phoenix ticket completion and compact progress',()=>{
  const makeLeg=(i:number)=>({
    event:`Away ${i} vs Home ${i}`,
    selection:`Home ${i}`,
    price:'Por verificar',
    bookmaker:'Sin casa confirmada',
    sport:'Baloncesto',
    league:'NBA',
    market:'Ganador · Pronóstico',
    rationale:'Forma reciente y localía; sin probabilidad calibrada.',
  })
  it('renders all five numbered legs and an accessible complete progress indicator',()=>{
    const fixture={ component:'sports_ticket_card',version:1,props:{
      title:'PHOENIX · Ticket de pronósticos',source:'ESPN Site API',
      combinedOdds:'No disponible',requestedLegs:5,note:'SIN APUESTA REAL',
      legs:Array.from({ length:5 },(_,i)=>makeLeg(i+1)),
    } }
    const card=parseGenerativeUiBlock(fixture)
    expect(card).not.toBeNull()
    if(!card)throw Error('Five-leg ticket rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByRole('progressbar',{ name:'Patas verificadas' }).getAttribute('aria-valuenow')).toBe('5')
    expect(screen.getByText('05')).toBeTruthy()
    expect(screen.getAllByText('Ver fundamento')).toHaveLength(5)
    expect(screen.getByText('Home 5')).toBeTruthy()
    expect(screen.getAllByLabelText('Partido verificado')).toHaveLength(5)
    expect(screen.queryByText('Por verificar')).toBeNull()
    expect(screen.queryByText('Sin casa confirmada')).toBeNull()
    expect(screen.getByText('Pendientes de confirmar')).toBeTruthy()
  })
  it('marks an incomplete ticket clearly and rejects mismatched overfilled counts',()=>{
    const props={ title:'Borrador',source:'ESPN',combinedOdds:'No disponible',
      requestedLegs:5,note:'Incompleto',legs:[makeLeg(1)] }
    const card=parseGenerativeUiBlock({ component:'sports_ticket_card',version:1,props })
    expect(card).not.toBeNull()
    if(!card)throw Error('Draft card rejected')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByText('BORRADOR INCOMPLETO')).toBeTruthy()
    expect(screen.getByText(/Faltan 4 selecciones/)).toBeTruthy()
    expect(screen.getByRole('progressbar',{ name:'Patas verificadas' }).getAttribute('aria-valuenow')).toBe('1')
    expect(parseGenerativeUiBlock({ component:'sports_ticket_card',version:1,
      props:{ ...props,requestedLegs:0 } })).toBeNull()
  })
})

describe('Phoenix ticket verified team logos and no price hallucinations',()=>{
  it('shows provider team logos with correct names and ONE quote-status summary',()=>{
    const ticket={ component:'sports_ticket_card',version:1,props:{
      title:'Phoenix ticket',source:'ESPN Site API',combinedOdds:'No disponible',
      note:'Solo análisis',requestedLegs:1,legs:[{
        event:'Phoenix Suns vs Oklahoma City Thunder',selection:'Oklahoma City Thunder',
        price:'Por verificar',bookmaker:'Sin casa confirmada',market:'Ganador',
        homeTeam:'Oklahoma City Thunder',awayTeam:'Phoenix Suns',
        homeLogo:'https://a.espncdn.com/okc-logo.png',awayLogo:'https://a.espncdn.com/phx-logo.png',
      }],
    } }
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
    const card={ component:'sports_ticket_card',version:1,props:{
      title:'Ticket',source:'ESPN',combinedOdds:'No disponible',note:'Solo análisis',
      legs:[{ event:'A vs B',selection:'A',price:'Por verificar',
        bookmaker:'Sin casa confirmada',homeTeam:'A',homeLogo:'https://example.invalid/logo.svg' }],
    } }
    expect(parseGenerativeUiBlock(card)).toBeNull()
  })
})


describe('Universal chat: compact sports schedules do not replace single-game cards',()=>{
  const slate={
    component:'sports_schedule_card',version:1,props:{
      title:'Cartelera deportiva',date:'2026-10-28',sport:'basketball',league:'NBA',
      source:'ESPN Site API · 2026-10-28T17:00:00Z',total:2,
      events:[
        { eventId:'evt-1',when:'28 oct 2026, 7:00 p. m.',status:'Programado',
          away:{ label:'Miami Heat' },home:{ label:'Atlanta Hawks' },venue:'State Farm Arena',
          featured:'Líder verificado · 20 PTS',askPrompt:'Kira, investiga el evento evt-1.' },
        { eventId:'evt-2',when:'28 oct 2026, 8:00 p. m.',
          away:{ label:'Houston Rockets' },home:{ label:'Los Angeles Lakers' },venue:'Crypto.com Arena' },
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
  it('identifies the sport and league, hides 0-0 for pregame, and marks unverified favorites',()=>{
    const original=slate.props.events[0]
    const card=parseGenerativeUiBlock({ ...slate,props:{ ...slate.props,events:[
      { ...original,phase:'pre',away:{ ...original.away,score:'0' },home:{ ...original.home,score:'0' } },
      { ...slate.props.events[1],phase:'pre' },
    ] } })
    if(!card)throw Error('Invalid pregame fixture')
    render(<GenerativeUi block={card}/>)
    expect(screen.getByText('PHOENIX / BALONCESTO · NBA')).toBeTruthy()
    expect(screen.getByText('NBA · Cartelera deportiva')).toBeTruthy()
    expect(screen.getAllByText('VS · Sin iniciar')).toHaveLength(2)
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getAllByText(/Favorito sin verificar/)).toHaveLength(2)
  })
  it('does not invent opponents or provide actionable game analysis for unnamed WTA events',()=>{
    const card=parseGenerativeUiBlock({ ...slate,props:{ ...slate.props,sport:'tennis',league:'wta',
      events:[{ ...slate.props.events[0],phase:'post',status:'Final',
        away:{ label:'Sin confirmar',score:'0' },home:{ label:'Sin confirmar',score:'0' } },
      { ...slate.props.events[1],phase:'pre',askPrompt:'Kira, investiga este encuentro con fuentes verificadas.' }] } })
    if(!card)throw Error('Invalid WTA fixture')
    const actions:string[]=[]
    render(<GenerativeUi block={card} onAction={text=>actions.push(text)}/>)
    expect(screen.getByText('PHOENIX / TENIS · WTA')).toBeTruthy()
    expect(screen.getByText(/Participantes pendientes de confirmar/)).toBeTruthy()
    expect(screen.queryByText('Sin confirmar')).toBeNull()
    expect(screen.queryByText('Finalizado')).toBeNull()
    expect(screen.getAllByRole('button',{ name:'Ver análisis del encuentro ›' })).toHaveLength(1)
    expect(actions).toHaveLength(0)
  })
  it('offers an actionable drilldown without replacing the rich individual card',()=>{
    const parsed=parseGenerativeUiBlock(slate)
    if(!parsed)throw Error('Schedule validation failed')
    const actions:string[]=[]
    render(<GenerativeUi block={parsed} onAction={(message,mode)=>{
      actions.push(message+':'+mode)
    }}/>)
    fireEvent.click(screen.getByRole('button',{ name:'Ver análisis del encuentro ›' }))
    expect(actions).toEqual(['Kira, investiga el evento evt-1.:draft'])
    expect(parseGenerativeUiBlock(rich)?.component).toBe('sports_game_card')
  })
  it('rejects untrusted images, spoofed favorite fields and excessive matches',()=>{
    const events=[...slate.props.events]
    expect(parseGenerativeUiBlock({ ...slate,props:{ ...slate.props,events:[
      { ...events[0],away:{ label:'Heat',logo:'https://untrusted.example/logo.png' } },events[1],
    ] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...slate,props:{ ...slate.props,events:[
      { ...events[0],probability:99 },events[1],
    ] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...slate,props:{ ...slate.props,events:Array.from({ length:26 },()=>events[0]) } })).toBeNull()
  })
})


describe('ESPN universal adaptive panels',()=>{
  const template={ component:'sports_espn_dashboard',version:1,props:{
    view:'player',title:'Jugador real',subtitle:'Estadísticas de temporada',
    source:'ESPN Common v3',checkedAt:'2026-10-29T13:00:00.000Z',
    image:'https://a.espncdn.com/i/headshots/nba/players/full/1.png',
    sections:[
      { heading:'Perfil',kind:'metrics',items:[{ label:'Posición',value:'Guard' }] },
      { heading:'Últimos partidos',kind:'list',items:[{ label:'Match 1',value:'PTS: 28' }] },
      { heading:'Noticias',kind:'articles',items:[{ label:'Headline',value:'Oct 29',href:'https://www.espn.com/nhl/story/_/id/99/article' }] },
    ],
    note:'3 de 3 fuentes con datos',
  } } as const
  it('renders dynamically composed metrics, match logs, news and ESPN portrait',()=>{
    const card=parseGenerativeUiBlock(template)
    expect(card).not.toBeNull()
    if(!card)throw Error('ESPN template rejected')
    render(<GenerativeUi block={card}/>)
    fireEvent.click(screen.getByText('Ver estadísticas y contenido'))
    expect(screen.getByRole('region',{ name:'Perfil' })).toBeTruthy()
    expect(screen.getByRole('region',{ name:'Últimos partidos' })).toBeTruthy()
    expect(screen.getAllByText('PTS: 28').length).toBeGreaterThan(0)
    expect(screen.getByText('Headline')).toBeTruthy()
    expect(screen.getByRole('link',{ name:'Leer noticia' }).getAttribute('href')).toContain('espn.com')
    expect(screen.getByAltText('Jugador real')).toBeTruthy()
  })

  it('keeps the intelligent event preview short and removes provider branding from visible text',()=>{
    const event={ ...template,props:{ ...template.props,view:'event',title:'ESPN · USA.1',
      subtitle:'Encuentro',note:'Datos de ESPN sujetos a disponibilidad' } }
    const card=parseGenerativeUiBlock(event)
    if(!card)throw Error('Event fixture rejected')
    const { container }=render(<GenerativeUi block={card}/>)
    expect(screen.getByText('MLS')).toBeTruthy()
    expect(screen.getByText('Ver estadísticas y contenido')).toBeTruthy()
    expect(container.querySelector('[data-generative-ui="sports_espn_dashboard"]')).toBeTruthy()
    expect(screen.queryByText(/\bESPN\b/iu)).toBeNull()
    fireEvent.click(screen.getByText('Ver estadísticas y contenido'))
    expect(screen.queryByText(/\bESPN\b/iu)).toBeNull()
  })
  it('previews participants, observed team performance, market prices and source-neutral projection without expanding',()=>{
    const dashboard={component:'sports_espn_dashboard',version:1,props:{
      view:'event',title:'Clippers vs Warriors',subtitle:'NBA · Encuentro',
      source:'ESPN Core',checkedAt:'2026-11-01T23:43:00Z',
      note:'Cifras observadas · estimaciones no calibradas',
      sections:[
        {heading:'Estadísticas de temporada',kind:'metrics',items:[{label:'Warriors · Rebotes',value:'45.2'}]},
        {heading:'Rendimiento de los equipos',kind:'metrics',items:[{label:'GS · Récord',value:'5-2'}]},
        {heading:'Cuotas y mercados',kind:'metrics',items:[{label:'Local · h2h',value:'1.95',detail:'Vigencia sin confirmar'}]},
        {heading:'Proyección de referencia',kind:'metrics',items:[{label:'Local',value:'55.0%',detail:'No es cuota'}]},
        {heading:'Encuentro y participantes',kind:'list',items:[
          {label:'Warriors',value:'home',image:'https://a.espncdn.com/warriors.png'},
          {label:'Clippers',value:'away',image:'https://a.espncdn.com/clippers.png'},
        ]},
      ],
    }}
    const block=parseGenerativeUiBlock(dashboard)
    if(!block)throw Error('Sports dossier rejected')
    const {container}=render(<GenerativeUi block={block}/>)
    expect(container.textContent).toContain('Warriors')
    expect(container.textContent).toContain('Clippers')
    expect(container.textContent).toContain('45.2')
    expect(container.textContent).toContain('1.95')
    expect(container.textContent).toContain('55.0%')
    expect(container.textContent).toContain('Local')
    expect(container.textContent).not.toContain('ESPN Core')
    expect(container.querySelector('[data-generative-ui="sports_espn_dashboard"]')).toBeTruthy()
  })
  it('displays both team win probabilities in the collapsed smart card',()=>{
    const block=parseGenerativeUiBlock({component:'sports_espn_dashboard',version:1,props:{
      view:'event',title:'Thunder vs Cavaliers',subtitle:'NBA',
      source:'PHOENIX',checkedAt:'2026-11-02T01:00:00Z',
      note:'Estimación exploratoria; no calibrada',
      sections:[
        {heading:'Estimación orientativa',kind:'metrics',items:[
          {label:'Cavaliers',value:'56.1%',detail:'No calibrada'},
          {label:'Thunder',value:'43.9%',detail:'No calibrada'}]},
        {heading:'Forma reciente',kind:'metrics',items:[{label:'CLE',value:'4V 2D'}]},
        {heading:'Cuotas y mercados',kind:'metrics',items:[{label:'local',value:'1.95'}]},
      ],
    }})
    if(!block)throw Error('Expected valid sports dashboard')
    const {container}=render(<GenerativeUi block={block}/>)
    expect(screen.getByText('Prob. ganar · Cavaliers')).toBeTruthy()
    expect(screen.getByText('Prob. ganar · Thunder')).toBeTruthy()
    expect(container.textContent).toContain('56.1%')
    expect(container.textContent).toContain('43.9%')
  })
  it('shows both verified team logos and complete market odds with attributed implied probabilities',()=>{
    const block=parseGenerativeUiBlock({component:'sports_espn_dashboard',version:1,props:{
      view:'event',title:'Vegas Golden Knights vs Boston Bruins',subtitle:'NHL',
      source:'ESPN · sportsbook',checkedAt:'2026-11-02T16:00:00Z',
      note:'Probabilidades implícitas de mercado: no son predicción propia',
      sections:[
        {heading:'Forma reciente y descanso',kind:'metrics',items:[
          {label:'Boston Bruins',value:'7V 3D',image:'https://a.espncdn.com/i/teamlogos/nhl/500/bos.png'},
          {label:'Vegas Golden Knights',value:'5V 5D',image:'https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png'}]},
        {heading:'Probabilidades implícitas del mercado',kind:'metrics',items:[
          {label:'Boston Bruins',value:'47.7%',detail:'Mercado; no modelo'},
          {label:'Vegas Golden Knights',value:'52.3%',detail:'Mercado; no modelo'}]},
        {heading:'Cuotas completas · sin promesa de acierto',kind:'list',items:[
          {label:'h2h · BetOnline',value:'Boston Bruins 2.03 | Vegas Golden Knights 1.85',
           detail:'Ambas cuotas de la misma casa'}]},
      ],
    }})
    if(!block)throw Error('Missing valid preview')
    const {container}=render(<GenerativeUi block={block}/>)
    const cards=container.querySelector('[data-generative-ui="sports_espn_dashboard"]')
    const imgs=cards?.querySelectorAll('img')??[]
    expect(imgs).toHaveLength(2)
    expect(container.textContent).toContain('Implícita mercado · Boston Bruins')
    expect(container.textContent).toContain('Implícita mercado · Vegas Golden Knights')
    expect(container.textContent).toContain('47.7%')
    expect(container.textContent).toContain('52.3%')
    expect(container.textContent).toContain('2.03')
    expect(container.textContent).toContain('1.85')
  })
  it('rejects hostile photos, scripts, excessive sections and undeclared data',()=>{
    const base=template.props
    expect(parseGenerativeUiBlock({ ...template,props:{ ...base,
      image:'https://untrusted.example/portrait.png' } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...template,props:{ ...base,
      sections:[{ heading:'X',kind:'articles',items:[{ label:'Fake',href:'https://tracker.example.com/x' }] }] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...template,props:{ ...base,
      sections:[{ heading:'X',kind:'list',items:[{ label:'A',html:'<img onerror=evil />' }] }] } })).toBeNull()
    expect(parseGenerativeUiBlock({ ...template,props:{ ...base,
      sections:Array.from({ length:9 },()=>base.sections[0]) } })).toBeNull()
  })
})

describe('Phoenix sports newsroom uses the shared intelligent UI contract',()=>{
  it('renders image-first article tiles, Spanish labels and a provider-neutral league title',()=>{
    const news={ component:'sports_espn_dashboard',version:1,props:{
      view:'news',title:'ESPN · ENG.1',subtitle:'Noticias',
      source:'ESPN Common v3',checkedAt:'2026-11-01T13:40:00Z',
      note:'Titulares de origen verificado',
      sections:[{heading:'Últimos titulares',kind:'articles',items:[
        {label:'Liverpool host Arsenal',value:'2026-11-01T13:41:41Z',
          detail:'Liverpool welcome Arsenal to Anfield.',
          image:'https://a.espncdn.com/news-photo.png',
          href:'https://www.espn.com/soccer/story/_/id/42/article'},
      ]}],
    } }
    const block=parseGenerativeUiBlock(news)
    if(!block)throw Error('Valid news panel rejected')
    const {container}=render(<GenerativeUi block={block}/>)
    expect(screen.getByText('Premier League · Inglaterra')).toBeTruthy()
    expect(screen.getByText('Leer noticia')).toBeTruthy()
    expect(container.querySelector('img')?.getAttribute('src')).toContain('a.espncdn.com')
    expect(container.querySelector('[data-generative-ui="sports_espn_dashboard"]')).toBeTruthy()
    expect(container.textContent).not.toContain('ESPN INTELLIGENCE')
  })
})

describe('ESPN contextual navigation',()=>{
  it('routes an ESPN verified player drill-down back into the same conversation',()=>{
    const value={ component:'sports_espn_dashboard',version:1,props:{
      view:'team',title:'Team confirmed',subtitle:'NBA',source:'ESPN',checkedAt:'2026-10-29T13:00:00Z',
      note:'verified',sections:[{ heading:'Plantilla',kind:'list',items:[{
        label:'Jugador',image:'https://a.espncdn.com/i/p.png',
        action:{ label:'Estadísticas del jugador',
          prompt:'Kira, consulta sports_chat_espn_explore con view=player, sport=basketball, league=nba, athleteId=991.' },
      }] }],
    } }
    const card=parseGenerativeUiBlock(value)
    if(!card)throw Error('Invalid contextual fixture')
    let prompt=''
    render(<GenerativeUi block={card} onAction={(text)=>{prompt=text}}/>)
    fireEvent.click(screen.getByText('Ver estadísticas y contenido'))
    fireEvent.click(screen.getByRole('button',{ name:'Estadísticas del jugador' }))
    expect(prompt).toContain('athleteId=991')
  })
})
