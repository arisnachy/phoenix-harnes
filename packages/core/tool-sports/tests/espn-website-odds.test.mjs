import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchEspnWebsiteOdds,espnOddsWebsiteUrl,espnOddsWebsiteCatalog} from '../src/espn-website-odds.ts'
import {marketOddsDetailed} from '../src/sports.ts'

const now=Date.parse('2026-11-08T18:00:00Z')
const start='2026-11-08T21:00:00Z'
const updated='2026-11-08T17:48:00Z'
const event=(soccer=false)=>({
  id:'401772510',date:start,competitions:[{
    id:'401772510',
    competitors:[
      {homeAway:'home',team:{displayName:soccer?'Inter Miami CF':'Chicago Bears'}},
      {homeAway:'away',team:{displayName:soccer?'Orlando City SC':'Green Bay Packers'}},
    ],
    odds:[{provider:{name:'DraftKings'},lastUpdated:updated,
      homeTeamOdds:{moneyline:-125},awayTeamOdds:{moneyline:'+105'},
      ...(soccer?{drawOdds:'+260'}:{})}],
  }],
})
const html=(game)=>'<html><script id="__NEXT_DATA__" type="application/json">'+
  JSON.stringify({props:{pageProps:{events:[game]}}})+
  '</script></html>'
const page=(body,status=200)=>new Response(body,{status,
  headers:{'content-type':'text/html'}})
const json=(payload)=>new Response(JSON.stringify(payload),{status:200,
  headers:{'content-type':'application/json'}})
const score=(game)=>({events:[game]})
test('ESPN official page inventory covers NFL MLB NHL NBA WNBA and MLS/soccer',()=>{
  for(const key of ['americanfootball_nfl','baseball_mlb','icehockey_nhl',
    'basketball_nba','basketball_wnba','soccer_usa_mls','soccer_epl']){
    assert.match(espnOddsWebsiteUrl(key),/^https:\/\/www\.espn\.com\//)
  }
  assert.equal(espnOddsWebsiteUrl('soccer_usa_mls'),'https://www.espn.com/soccer/odds')
  assert.ok(espnOddsWebsiteCatalog.some(x=>x.league==='usa.1'))
  assert.equal(espnOddsWebsiteUrl('fake_sport'),null)
})
test('embedded ESPN bookmaker quotes require independent event and team identity',async()=>{
  const g=event()
  let coreCalls=0
  const response=await fetchEspnWebsiteOdds('americanfootball_nfl','h2h',
    async url=>{
      assert.equal(String(url),'https://www.espn.com/nfl/odds')
      return page(html(g))
    },
    async url=>{
      coreCalls++
      assert.match(url,/\/football\/nfl\/scoreboard\?dates=20261108/u)
      return score({...g,competitions:[{...g.competitions[0],odds:[]}]})
    },now)
  assert.equal(response.status,'observed')
  assert.equal(response.quotes.length,2)
  assert.equal(coreCalls,1)
  assert.equal(response.quotes[0].bookmaker,'DraftKings')
  assert.equal(response.quotes[0].price,1.8)
  assert.equal(response.quotes[0].endpointSource,'website')
  assert.ok(response.quotes.every(x=>x.updatedAt===updated))
})
test('MLS three-way winner requires a real published draw price',async()=>{
  const g=event(true)
  const readJSON=async()=>score(g)
  const available=await fetchEspnWebsiteOdds('soccer_usa_mls','h2h',
    async()=>page(html(g)),readJSON,now)
  assert.equal(available.status,'observed')
  assert.deepEqual(available.quotes.map(x=>x.selection),
    ['Inter Miami CF','Orlando City SC','Draw'])
  const noDraw=structuredClone(g)
  delete noDraw.competitions[0].odds[0].drawOdds
  const result=await fetchEspnWebsiteOdds('soccer_usa_mls','h2h',
    async()=>page(html(noDraw)),readJSON,now)
  assert.equal(result.quotes.length,0)
  assert.equal(result.status,'empty')
})
test('ESPN website CAPTCHA and 403 never trigger JS execution or fabricated quotes',async()=>{
  const fetches=async()=>page('<html>JavaScript is disabled. Verify that you are not a robot</html>')
  const blocked=await fetchEspnWebsiteOdds('basketball_nba','h2h',fetches,
    async()=>{throw Error('scoreboard should not be fetched')},now)
  assert.equal(blocked.status,'blocked')
  assert.deepEqual(blocked.quotes,[])
  const forbidden=await fetchEspnWebsiteOdds('basketball_wnba','h2h',
    async()=>page('Forbidden',403),async()=>({events:[]}),now)
  assert.equal(forbidden.status,'blocked')
})
test('wrong teams, stale prices and started games cannot become tickets',async()=>{
  const g=event()
  const wrong=structuredClone(g)
  wrong.competitions[0].competitors[0].team.displayName='Other Club'
  const t=async()=>page(html(g))
  const discrepancy=await fetchEspnWebsiteOdds('americanfootball_nfl','h2h',t,
    async()=>score(wrong),now)
  assert.equal(discrepancy.quotes.length,0)
  const stale=structuredClone(g)
  stale.competitions[0].odds[0].lastUpdated='2026-11-07T14:00:00Z'
  assert.deepEqual((await fetchEspnWebsiteOdds('americanfootball_nfl','h2h',
    async()=>page(html(stale)),async()=>score(g),now)).quotes,[])
  const started=structuredClone(g)
  started.date='2026-11-08T17:00:00Z'
  assert.deepEqual((await fetchEspnWebsiteOdds('americanfootball_nfl','h2h',
    async()=>page(html(started)),async()=>score(started),now)).quotes,[])
})
test('marketOddsDetailed recovers exact real odds through ESPN Website after Core is empty',async()=>{
  const g=event()
  let websiteCalls=0
  const feed=async url=>{
    const link=String(url)
    if(link==='https://www.espn.com/nfl/odds'){
      websiteCalls++
      return page(html(g))
    }
    if(link.includes('/scoreboard?dates=')){
      return json(link.endsWith('20261108')?score({
        ...g,competitions:[{...g.competitions[0],odds:[]}]}
      ):{events:[]})
    }
    if(link.includes('/competitions/'))return json({items:[]})
    if(link.includes('/summary?'))return json({})
    throw Error('Unexpected transport '+link)
  }
  const r=await marketOddsDetailed('americanfootball_nfl','h2h',
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'0'},feed,now)
  assert.equal(websiteCalls,1)
  assert.equal(r.quotes.length,2)
  assert.ok(r.quotes.every(x=>x.source==='ESPN Website (JSON embebido)'))
  assert.equal(r.sources.find(x=>x.provider==='ESPN Website')?.status,'observed')
  assert.equal(r.sources.find(x=>x.provider==='ESPN Site/Core')?.status,'empty')
  assert.equal(r.sources.find(x=>x.provider==='OddsHarvester')?.status,'unconfigured')
})
