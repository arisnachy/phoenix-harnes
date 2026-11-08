// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {GenerativeUi,parseGenerativeUiBlock} from '../src/client/chat/GenerativeUi.tsx'
import {sportsLeagueIdentity} from '../src/client/chat/SportsLeagueIdentity.tsx'
import {forecastFeed,forecastPick} from '../src/client/chat/SportsForecastLive.tsx'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})
const mkGame=(id:string,home:string,away:string,homeScore:number,awayScore:number)=>({
  id,status:{type:{state:'post',description:'Final'}},competitions:[{competitors:[
    {homeAway:'home',team:{displayName:home},score:String(homeScore)},
    {homeAway:'away',team:{displayName:away},score:String(awayScore)},
  ]}],
})
const legs=[
  {event:'Houston Texans vs Los Angeles Chargers',selection:'Houston Texans',
    sport:'Fútbol americano',league:'NFL',market:'Ganador',when:'8 nov 2026, 5:05 p. m.',
    homeTeam:'Houston Texans',awayTeam:'Los Angeles Chargers',
    price:'No disponible',bookmaker:'Sin cotizar'},
  {event:'Boston Celtics vs Milwaukee Bucks',selection:'Boston Celtics',
    sport:'Baloncesto',league:'NBA',market:'Ganador',when:'8 nov 2026, 9:00 p. m.',
    homeTeam:'Boston Celtics',awayTeam:'Milwaukee Bucks',
    price:'No disponible',bookmaker:'Sin cotizar'},
]
const ticket={component:'sports_ticket_card',version:1,props:{
  title:'PHOENIX · Ticket de pronósticos',source:'Investigación ESPN',
  combinedOdds:'No disponible',requestedLegs:2,
  note:'Sin cuotas confirmadas · pronósticos, no apuestas aceptadas.',legs,
}}
describe('PHOENIX Pearl Light forecast ticket',()=>{
  it('maps leagues to a pinned ESPN CDN and preserves unsupported text fallback',()=>{
    expect(sportsLeagueIdentity('NFL')?.logo).toMatch(/^https:\/\/a\.espncdn\.com\/i\/teamlogos\/leagues\/500\/nfl\.png$/u)
    expect(sportsLeagueIdentity('LaLiga')?.code).toBe('LAL')
    expect(sportsLeagueIdentity('una liga desconocida')).toBeNull()
  })
  it('never invents goals for ambiguous markets or incomplete team identities',()=>{
    expect(forecastPick(legs[0]!)).toMatchObject({market:'moneyline',side:'home'})
    expect(forecastFeed(legs[1]!)).toEqual({sport:'basketball',league:'nba',date:'2026-11-08'})
    expect(forecastPick({...legs[0]!,selection:'Houston Texans +1.5',market:'Ganador'})).toBeNull()
    expect(forecastPick({...legs[0]!,homeTeam:''})).toBeNull()
    expect(forecastFeed({...legs[0]!,providerLeague:'nhl'})).toBeNull()
  })
  it('updates all matching forecast legs but never claims bookmaker settlement',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
      const games=url.includes('/football/nfl/')?
        [mkGame('1','Houston Texans','Los Angeles Chargers',21,14)]:
        [mkGame('2','Boston Celtics','Milwaukee Bucks',103,100)]
      return new Response(JSON.stringify({events:games}),{status:200,
        headers:{'content-type':'application/json'}})
    }))
    const block=parseGenerativeUiBlock(ticket)
    if(!block)throw Error('Forecast ticket rejected')
    render(<GenerativeUi block={block}/>)
    expect(screen.getByRole('img',{name:'Liga NFL'})).toBeTruthy()
    expect(screen.getByRole('img',{name:'Liga NBA'})).toBeTruthy()
    await waitFor(()=>expect(screen.getAllByText('Acertada al final · provisional')).toHaveLength(2))
    const panel=screen.getByLabelText('Estado deportivo de los pronósticos')
    expect(panel.textContent).toContain('Todos los resultados deportivos acertados')
    expect(panel.textContent).toContain('2 / 2')
    expect(panel.textContent).toContain('no son apuestas aceptadas')
    expect(screen.queryByText('Ticket GANADO')).toBeNull()
  })
})
