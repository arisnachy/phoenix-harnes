// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {espnLiveUrl,parseEspnLiveScoreboard,matchEspnGame,SportsLiveProvider,SportsLiveFacts} from '../src/client/chat/SportsLive.tsx'
import {parseGenerativeUiBlock,GenerativeUi} from '../src/client/chat/GenerativeUi.tsx'

afterEach(()=>{cleanup();vi.unstubAllGlobals()})

const teams=[
  {homeAway:'away',team:{displayName:'Milwaukee Brewers'},score:'1',linescores:[{value:0},{value:1},{value:0}]},
  {homeAway:'home',team:{displayName:'Tampa Bay Rays'},score:'0',linescores:[{value:0},{value:0},{value:0}]},
]
const mlb={events:[{id:'401800101',status:{period:3,displayClock:'0:00',type:{state:'in',shortDetail:'Mid 3rd'}},
  competitions:[{competitors:teams,situation:{outs:2,balls:1,strikes:2,
    onFirst:true,onSecond:false,onThird:true,lastPlay:{text:'Fly out to left field'}}}]}]}
const nba={events:[{id:'401800102',status:{period:4,displayClock:'11:21',type:{state:'in',shortDetail:'4th · 11:21'}},
  competitions:[{competitors:[
    {homeAway:'away',team:{displayName:'Miami Heat'},score:'99',linescores:[{value:34},{value:35},{value:28},{value:2}]},
    {homeAway:'home',team:{displayName:'Atlanta Hawks'},score:'88',linescores:[{value:25},{value:31},{value:29},{value:3}]},
  ],situation:{lastPlay:{text:'Personal foul'}}}]}]}
describe('keyless ESPN live adapter',()=>{
  it('only uses validated league and date for provider-hosted GET requests',()=>{
    expect(espnLiveUrl('baseball','MLB','2026-10-28')).toBe('https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=20261028')
    expect(espnLiveUrl('soccer','MLS','2026-10-28')).toContain('/soccer/usa.1/')
    expect(espnLiveUrl('baseball','https://evil.test','2026-10-28')).toBeNull()
    expect(espnLiveUrl('baseball','mlb','2026-02-30')).toBeNull()
  })
  it('reports genuine MLB inning, outs and occupancy without manufacturing an unknown count',()=>{
    const games=parseEspnLiveScoreboard(mlb),game=games[0]
    expect(game).toMatchObject({id:'401800101',phase:'in',homeScore:'0',awayScore:'1',
      status:'Mid 3rd',outs:2,balls:1,strikes:2,bases:[true,false,true],lastPlay:'Fly out to left field'})
    expect(game?.periods).toHaveLength(3)
    expect(matchEspnGame(games,{eventId:'MLB-DIFFERENT-ID',home:{label:'Tampa Bay Rays'},away:{label:'Milwaukee Brewers'}})).toEqual(game)
    expect(parseEspnLiveScoreboard({events:[{competitions:[{}]}]})).toEqual([])
  })
  it('reports NBA quarter, clock, score and quarter breakdown',()=>{
    expect(parseEspnLiveScoreboard(nba)[0]).toMatchObject({phase:'in',homeScore:'88',awayScore:'99',
      clock:'11:21',period:4,lastPlay:'Personal foul',
      periods:[{label:'1',away:'34',home:'25'},{label:'2',away:'35',home:'31'},
        {label:'3',away:'28',home:'29'},{label:'4',away:'2',home:'3'}]})
  })
  it('keeps unsupported live stats absent rather than inventing zeros',()=>{
    const game=parseEspnLiveScoreboard({events:[{id:'10',status:{type:{state:'in',description:'1H'}},
      competitions:[{competitors:[{homeAway:'away',team:{displayName:'Orlando City'},score:'0'},
        {homeAway:'home',team:{displayName:'LA Galaxy'},score:'1'}]}]}]})[0]
    expect(game?.status).toBe('1H')
    expect(game?.outs).toBeUndefined()
    expect(game?.bases).toBeUndefined()
    expect(game?.lastPlay).toBeUndefined()
  })
  it('hydrates a native PHOENIX card with a fetched live score, without model tools',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(nba),{status:200,headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',fetcher)
    const block=parseGenerativeUiBlock({component:'sports_game_card',version:1,props:{
      title:'Miami Heat at Atlanta Hawks',sport:'basketball',league:'NBA',providerLeague:'nba',
      eventId:'401800102',eventDate:'2026-10-28',when:'28 oct',source:'ESPN Site API',
      home:{label:'Atlanta Hawks'},away:{label:'Miami Heat'},
    }})
    if(!block)throw Error('Invalid game card')
    render(<GenerativeUi block={block}/>)
    await waitFor(()=>expect(screen.getByText(/Personal foul/)).toBeTruthy())
    expect(screen.getByText('99')).toBeTruthy()
    expect(screen.getByText('88')).toBeTruthy()
    expect(screen.getByText(/EN VIVO · 4th · 11:21/)).toBeTruthy()
    expect(fetcher).toHaveBeenCalled()
  })
  it('shares the same ESPN call across fixtures within a slate',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(nba),{status:200}))
    vi.stubGlobal('fetch',fetcher)
    render(<SportsLiveProvider sport="basketball" league="nba" date="2026-10-30">
      {(get,meta)=><div><SportsLiveFacts game={get({home:{label:'Atlanta Hawks'},away:{label:'Miami Heat'}})} meta={meta} sport="basketball"/>
        <SportsLiveFacts game={get({home:{label:'Atlanta Hawks'},away:{label:'Miami Heat'}})} meta={meta} sport="basketball"/></div>}
    </SportsLiveProvider>)
    await waitFor(()=>expect(screen.getAllByText(/EN VIVO/)).toHaveLength(2))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
