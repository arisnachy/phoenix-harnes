// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor,within} from '@testing-library/react'
import {GenerativeUi,parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
import {summarizeTicketGrades} from '../src/client/chat/SportsTicketLiveTracker.tsx'
import {evaluateSportsPick} from '../src/client/chat/SportsBetProgress.tsx'

afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals()})
const teams=(home:string,away:string,homeScore:number,awayScore:number,halves=false)=>({
  competitors:[
    {homeAway:'home',team:{displayName:home},score:String(homeScore),
      ...(halves?{linescores:[{value:0},{value:homeScore}]}:{})},
    {homeAway:'away',team:{displayName:away},score:String(awayScore),
      ...(halves?{linescores:[{value:awayScore},{value:0}]}:{})},
  ],
})
const game=(id:string,home:string,away:string,hs:number,as:number,halves=false)=>({
  id,status:{type:{state:'post',description:'Final'}},competitions:[teams(home,away,hs,as,halves)],
})
const nba={events:[game('301','Phoenix Suns','Houston Rockets',109,115)]}
const nhl={events:[
  game('401','Carolina Hurricanes','Chicago Blackhawks',3,2),
  game('402','Ottawa Senators','New Jersey Devils',2,3),
  game('403','Toronto Maple Leafs','Boston Bruins',1,4),
  game('404','Dallas Stars','Colorado Avalanche',2,0),
  game('405','Edmonton Oilers','Vancouver Canucks',4,2),
]}
const mls={events:[
  game('501','CF Montréal','Vancouver Whitecaps',0,2,true),
  game('502','Portland Timbers','Seattle Sounders',1,0,true),
  game('503','Inter Miami','Orlando City',2,1,true),
]}
function leg(receipt:string,sport:string,league:string,eventId:string,home:string,away:string,
  market:'moneyline'|'spread'|'total',side:'home'|'away'|'over'|'under',line?:number){
  return {event:away+' vs '+home,selection:market==='total'?'Arriba '+line:side==='home'?home:away,
    price:'-200',bookmaker:'Juancito Sport',when:'7 nov 2026',
    sport,league,providerLeague:league,eventDate:'2026-11-07',eventId,homeTeam:home,awayTeam:away,
    trackedBet:{receipt,market,side,...(line===undefined?{}:{line})},
  }
}
const ticket1={
  ticketReference:'12126409',title:'Boleto #12126409',source:'ESPN + comprobante del usuario',
  note:'Solo la banca confirma pago.',stake:'100.00',grossReturn:'469.00',
  combinedOdds:'4.690',requestedLegs:5,
  legs:[
    leg('12126409','basketball','nba','301','Phoenix Suns','Houston Rockets','total','over',223.5),
    leg('12126409','hockey','nhl','401','Carolina Hurricanes','Chicago Blackhawks','moneyline','home'),
    leg('12126409','hockey','nhl','402','Ottawa Senators','New Jersey Devils','spread','home',1.5),
    leg('12126409','hockey','nhl','403','Toronto Maple Leafs','Boston Bruins','spread','home',1.5),
    leg('12126409','hockey','nhl','404','Dallas Stars','Colorado Avalanche','moneyline','home'),
  ],
}
const ticket2={
  ticketReference:'12126415',title:'Boleto #12126415',source:'ESPN + comprobante del usuario',
  note:'Solo la banca confirma pago.',stake:'100.00',grossReturn:'491.00',
  combinedOdds:'4.910',requestedLegs:5,
  legs:[
    leg('12126415','soccer','usa.1','501','CF Montréal','Vancouver Whitecaps','moneyline','away'),
    leg('12126415','soccer','usa.1','502','Portland Timbers','Seattle Sounders','moneyline','home'),
    leg('12126415','hockey','nhl','401','Carolina Hurricanes','Chicago Blackhawks','moneyline','home'),
    leg('12126415','hockey','nhl','405','Edmonton Oilers','Vancouver Canucks','moneyline','home'),
    leg('12126415','hockey','nhl','404','Dallas Stars','Colorado Avalanche','moneyline','home'),
  ],
}
const bundle={component:'sports_ticket_bundle_card',version:1,props:{
  title:'PHOENIX · Boletos reales',source:'ESPN',tickets:[ticket1,ticket2],
}}
describe('native grouped live ticket tracker',()=>{
  it('summarizes all legs, never counts current leads as bookmaker-confirmed wins',()=>{
    expect(summarizeTicketGrades(['leading','pending','trailing','won','review'])).toMatchObject({
      total:5,covering:2,completed:2,won:1,lost:0,pending:1,state:'review',
    })
    expect(summarizeTicketGrades(['won','won','won','won','won'])).toMatchObject({
      state:'won',won:5,completed:5,
    })
    expect(summarizeTicketGrades(['lost','leading','pending','pending','pending'])).toMatchObject({
      state:'lost',lost:1,
    })
    expect(summarizeTicketGrades(['leading','leading','leading','leading','leading']).state).toBe('live')
  })
  it('renders each receipt with ALL five selected games and two separate aggregate grades',async()=>{
    const f=vi.fn(async(url:string)=>{
      const key=url.includes('/basketball/nba/')?'nba':url.includes('/hockey/nhl/')?'nhl':
        url.includes('/soccer/usa.1/')?'mls':'unknown'
      return new Response(JSON.stringify(key==='nba'?nba:key==='nhl'?nhl:key==='mls'?mls:{events:[]}),
        {status:200,headers:{'content-type':'application/json'}})
    })
    vi.stubGlobal('fetch',f)
    const block=parseGenerativeUiBlock(bundle)
    if(!block)throw Error('Sports ticket bundle schema rejected')
    render(<GenerativeUi block={block}/>)
    const panelA=screen.getByLabelText('Seguimiento del boleto 12126409')
    const panelB=screen.getByLabelText('Seguimiento del boleto 12126415')
    expect(within(panelA).getAllByText(/OBJETIVO DE LA PATA/)).toHaveLength(5)
    expect(within(panelB).getAllByText(/OBJETIVO DE LA PATA/)).toHaveLength(5)
    expect(within(panelA).getByText('Más de 223.5')).toBeTruthy()
    expect(within(panelA).getByText('Ottawa Senators +1.5')).toBeTruthy()
    expect(within(panelB).getByText('Vancouver Whitecaps gana')).toBeTruthy()
    expect(within(panelB).getByText('Edmonton Oilers gana')).toBeTruthy()
    expect(within(panelA).queryByText('Inter Miami')).toBeNull()
    expect(screen.queryByText(/Registrar mi apuesta/)).toBeNull()
    await waitFor(()=>expect(panelA.getAttribute('data-ticket-reference')).toBe('12126409'))
    await waitFor(()=>expect(within(panelA).getByText(/Una o más patas perdidas/)).toBeTruthy())
    await waitFor(()=>expect(within(panelB).getByText(/Todas las patas cumplen/)).toBeTruthy())
    const picked=within(panelB).getByText('Vancouver Whitecaps').closest('[data-selected]')
    expect(picked?.getAttribute('data-selected')).toBe('true')
    // Per-league memoization prevents one ESPN request per ticket leg.
    expect(f.mock.calls.length).toBeLessThanOrEqual(4)
  })
  it('rejects duplicated receipt IDs and invalid market lines rather than rendering unrelated games',()=>{
    expect(parseGenerativeUiBlock({...bundle,props:{...bundle.props,tickets:[ticket1,ticket1]}})).toBeNull()
    const malformed={...ticket2,legs:[{...ticket2.legs[0],
      trackedBet:{receipt:'12126415',market:'spread',side:'away'}}]}
    expect(parseGenerativeUiBlock({...bundle,props:{...bundle.props,tickets:[ticket1,malformed]}})).toBeNull()
  })
  it('holds soccer final in review if regulation score breakdown is unavailable',()=>{
    const pick={receipt:'x',market:'moneyline' as const,side:'away' as const}
    const raw={id:'501',home:'CF Montréal',away:'Vancouver Whitecaps',homeScore:'0',awayScore:'2',
      status:'Final',phase:'post' as const}
    expect(evaluateSportsPick(pick,raw,'soccer').state).toBe('review')
    expect(evaluateSportsPick(pick,{...raw,periods:[
      {label:'1',home:'0',away:'2'},{label:'2',home:'0',away:'0'},
    ]},'soccer').state).toBe('won')
  })
})
