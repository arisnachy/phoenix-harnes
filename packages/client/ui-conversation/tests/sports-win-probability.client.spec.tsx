// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {SportsWinProbability,espnWinCoreUrl,parseEspnPregamePredictor,
  parseEspnWinProbability} from '../src/client/chat/SportsWinProbability.tsx'
afterEach(()=>{cleanup();vi.unstubAllGlobals()})
describe('ESPN game predictor + in-play win probability',()=>{
  it('reads the last trustworthy play, scales 0..1, and keeps ties',()=>{
    expect(parseEspnWinProbability({winprobability:[
      {homeWinPercentage:0.5,awayWinPercentage:0.5},
      {homeWinPercentage:0.7,tiePercentage:0.1,playId:'play-42'},
    ]})).toMatchObject({snapshot:{home:70,away:20,draw:10},playId:'play-42',history:[50,70]})
    expect(parseEspnWinProbability({winprobability:[{homeWinPercentage:103}]})).toBeNull()
    expect(parseEspnWinProbability({winprobability:[{$ref:'https://example.test/123'}]})).toBeNull()
  })
  it('does not hallucinate a soccer away chance from a single projection',()=>{
    const onlyHome={homeTeam:{gameProjection:'60.5'}}
    expect(parseEspnPregamePredictor(onlyHome,'soccer')).toBeNull()
    expect(parseEspnPregamePredictor({predictor:{
      homeTeam:{gameProjection:'55.1',teamChanceLoss:'25.4',teamChanceTie:'19.5'},
    }},'soccer')).toEqual({home:55.1,away:25.4,draw:19.5})
    expect(parseEspnPregamePredictor(onlyHome,'basketball')).toEqual({
      home:60.5,away:39.5,draw:null,
    })
  })
  it('uses a pinned host and the actual competition id, never an arbitrary URL',()=>{
    expect(espnWinCoreUrl('basketball','NBA','401234','407777','probabilities'))
      .toBe('https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/401234/competitions/407777/probabilities?limit=200')
    expect(espnWinCoreUrl('basketball','NBA','401234','../secret')).toBeNull()
    expect(espnWinCoreUrl('basketball','https://evil.com','401234')).toBeNull()
  })
  it('renders verified pregame plus in-play probabilities without inventing prices',async()=>{
    const calls:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
      const url=String(input);calls.push(url)
      if(url.includes('/summary?event='))return new Response(JSON.stringify({
        winprobability:[{homeWinPercentage:0.72,awayWinPercentage:0.28,playId:'abc'}],
      }),{status:200})
      if(url.includes('/predictor'))return new Response(JSON.stringify({
        homeTeam:{gameProjection:'60'},awayTeam:{gameProjection:'40'},
      }),{status:200})
      throw Error('Unexpected endpoint '+url)
    }))
    render(<SportsWinProbability sport="basketball" league="NBA" eventId="401234"
      phase="in" game={{id:'401234',home:'Washington Wizards',away:'Detroit Pistons',phase:'in',status:'4Q'}}/>)
    await waitFor(()=>expect(screen.getByText('72,0 %')).toBeTruthy())
    await waitFor(()=>expect(screen.getByText('60,0 %')).toBeTruthy())
    expect(calls.some(url=>url.includes('/summary?event=401234'))).toBe(true)
    expect(calls.some(url=>url.includes('/predictor'))).toBe(true)
    expect(screen.getByText(/Estimaciones, no cuotas/)).toBeTruthy()
  })
  it('omits empty ESPN probability modules so NHL and soccer cards stay compact',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({}),{status:200}))
    vi.stubGlobal('fetch',fetcher)
    const {container}=render(<SportsWinProbability sport="hockey" league="NHL"
      eventId="4012345" phase="post"/>)
    await waitFor(()=>expect(fetcher).toHaveBeenCalled())
    expect(container.querySelector('section')).toBeNull()
    expect(screen.queryByText(/No disponible en ESPN/)).toBeNull()
    expect(screen.queryByText(/50,0 %/)).toBeNull()
  })
  it('keeps the live probability chart collapsed by default',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).includes('/summary?'))return new Response(JSON.stringify({
        winprobability:[
          {homeWinPercentage:0.5,awayWinPercentage:0.5},
          {homeWinPercentage:0.7,awayWinPercentage:0.3},
        ],
      }),{status:200})
      return new Response(JSON.stringify({}),{status:200})
    }))
    render(<SportsWinProbability sport="basketball" league="NBA"
      eventId="401234" phase="in"/>)
    await waitFor(()=>expect(screen.getByText('70,0 %')).toBeTruthy())
    expect(screen.getByText('Ver evolución de probabilidad')).toBeTruthy()
    expect(screen.getByText('Ver evolución de probabilidad').closest('details')?.open).toBe(false)
  })
})