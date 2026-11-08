import {test} from 'node:test'
import assert from 'node:assert/strict'
import {crosscheckFreeFixture,freeOfficialFollowUps,freeSourceInventory,freeSourceCoverageForSport}
  from '../src/free-sports-source-audit.ts'

const game={sport:'basketball',league:'nba',eventId:'401909949',
  date:'2026-11-08',home:'Milwaukee Bucks',away:'Boston Celtics',
  kickoff:'2026-11-09T01:00:00Z'}
const reply=(payload,status=200)=>new Response(JSON.stringify(payload),{status})

test('free TheSportsDB agrees only with both teams, home/away and kickoff',async()=>{
  const calls=[]
  const f=async url=>{
    calls.push(String(url))
    return reply({events:[{strHomeTeam:'Milwaukee Bucks',
      strAwayTeam:'Boston Celtics',strTimestamp:'2026-11-09T01:00:00Z'}]})
  }
  const result=await crosscheckFreeFixture(game,f,Date.parse('2026-11-08T18:00:00Z'),{})
  assert.equal(result.length,1)
  assert.equal(result[0].provider,'TheSportsDB')
  assert.equal(result[0].status,'verified')
  assert.match(result[0].detail,/solo calendario/)
  assert.equal(calls.length,1)
  assert.match(calls[0],/eventsday\.php\?d=2026-11-08/)
  assert.ok(!('probability' in result[0]))
  assert.ok(!('odds' in result[0]))
})

test('reversed home-away at the same time is an explicit conflict',async()=>{
  const f=async()=>reply({events:[{strHomeTeam:'Boston Celtics',
    strAwayTeam:'Milwaukee Bucks',strTimestamp:'2026-11-09T01:00:00Z'}]})
  const result=await crosscheckFreeFixture(game,f)
  assert.equal(result[0].status,'conflict')
})

test('unmatched or stale free events never become evidence or contradiction',async()=>{
  const f=async()=>reply({events:[{strHomeTeam:'Milwaukee Bucks',
    strAwayTeam:'Boston Celtics',strTimestamp:'2026-11-11T01:00:00Z'}]})
  const result=await crosscheckFreeFixture(game,f)
  assert.equal(result[0].status,'not-found')
  assert.match(result[0].detail,/NO confirma ausencia/)
})

test('provider 429 is unavailable and never becomes an empty observed event',async()=>{
  const result=await crosscheckFreeFixture(game,async()=>reply({},429))
  assert.equal(result[0].status,'unavailable')
  assert.match(result[0].detail,/429/)
})

test('OpenLigaDB corroborates only Bundesliga and matches official home/away',async()=>{
  const german={sport:'soccer',league:'ger.1',eventId:'9001',
    date:'2026-11-08',home:'Borussia Dortmund',away:'Bayern Munich',
    kickoff:'2026-11-08T18:30:00Z'}
  const f=async url=>String(url).includes('openligadb')?
    reply([{team1:{teamName:'Borussia Dortmund'},
      team2:{teamName:'Bayern Munich'},
      matchDateTimeUTC:'2026-11-08T18:30:00Z'}]):
    reply({events:[]})
  const result=await crosscheckFreeFixture(german,f)
  assert.equal(result.length,3)
  assert.equal(result[0].status,'not-found')
  assert.equal(result[1].status,'verified')
  assert.match(result[1].url,/getmatchdata\/bl1\/2026/)
})

test('free source opt-out and strict event inputs',async()=>{
  const disabled=await crosscheckFreeFixture(game,async()=>{throw Error('no call')},
    Date.now(),{PHOENIX_SPORTS_FREE_BACKUPS_DISABLED:'1'})
  assert.deepEqual(disabled,[])
  await assert.rejects(()=>crosscheckFreeFixture({...game,date:'2026-02-30'},
    async()=>reply({events:[]})),/inválido/)
})

test('injury and starter references are unverified follow-ups, never evidence',()=>{
  assert.match(freeOfficialFollowUps('basketball','2026-11-08')[0],/official\.nba\.com/)
  assert.match(freeOfficialFollowUps('football','2026-11-08')[0],/nflverse/)
  assert.match(freeOfficialFollowUps('hockey','2026-11-08')[0],/no confirma titular/)
  assert.deepEqual(freeOfficialFollowUps('soccer','2026-11-08'),[])
})


test('OpenFootball corroborates soccer teams and local calendar date, but NOT UTC kickoff',async()=>{
  const eng={sport:'soccer',league:'eng.1',eventId:'8001',
    date:'2026-11-08',home:'Arsenal',away:'Liverpool',
    kickoff:'2026-11-08T18:30:00Z'}
  const f=async url=>String(url).includes('raw.githubusercontent.com')?
    reply({matches:[{date:'2026-11-08',time:'17:30',
      team1:'Arsenal FC',team2:'Liverpool FC'}]}):reply({events:[]})
  const x=await crosscheckFreeFixture(eng,f)
  assert.equal(x.length,2)
  assert.equal(x[0].status,'not-found')
  assert.equal(x[1].provider,'OpenFootball')
  assert.equal(x[1].status,'partial')
  assert.match(x[1].detail,/NO aporta UTC/)
})

test('optional football-data.org token is sent only in header and never displayed',async()=>{
  const eng={sport:'soccer',league:'eng.1',eventId:'8001',
    date:'2026-11-08',home:'Arsenal',away:'Liverpool',
    kickoff:'2026-11-08T18:30:00Z'}
  let checked=false
  const f=async (url,init)=>{
    if(String(url).includes('football-data.org')){
      assert.equal(init.headers['X-Auth-Token'],'private-test-key')
      assert.ok(!String(url).includes('private-test-key'))
      checked=true
      return reply({matches:[{utcDate:'2026-11-08T18:30:00Z',
        homeTeam:{name:'Arsenal FC'},awayTeam:{name:'Liverpool FC'}}]})
    }
    return reply({events:[],matches:[]})
  }
  const x=await crosscheckFreeFixture(eng,f,Date.parse('2026-11-08T14:00:00Z'),
    {PHOENIX_FOOTBALL_DATA_TOKEN:'private-test-key'})
  assert.ok(checked)
  assert.equal(x.length,3)
  assert.equal(x[2].status,'verified')
  assert.ok(!JSON.stringify(x).includes('private-test-key'))
})

test('source catalog distinguishes integrated providers from catalog-only and historical',()=>{
  assert.ok(freeSourceInventory.some(x=>x.name==='OpenFootball'&&x.state==='integrated'))
  assert.ok(freeSourceInventory.some(x=>x.name==='Jolpica F1'&&x.state==='catalog-only'))
  assert.ok(freeSourceInventory.some(x=>x.name==='StatsBomb Open Data'&&x.state==='historical-only'))
})

test('all 17 sports have truthful source coverage, including weak/no-API disciplines',()=>{
  const sports=['soccer','basketball','baseball','football','hockey','tennis','mma',
    'racing','golf','cricket','rugby','lacrosse','volleyball','water-polo',
    'field-hockey','rugby-league','australian-football']
  for(const sport of sports){
    const result=freeSourceCoverageForSport(sport,{})
    assert.equal(result.supported,true)
    assert.ok(result.wired.includes('ESPN Site/Core'),sport)
    assert.ok(result.referenceOnly.length>0,sport)
    if(sport==='golf')assert.ok(result.referenceOnly.some(n=>n.startsWith('TheSportsDB (sin adaptador')))
  }
  const nba=freeSourceCoverageForSport('basketball',{})
  assert.ok(nba.referenceOnly.includes('NBA Stats / LiveData'))
  assert.ok(nba.referenceOnly.includes('WNBA Stats'))
  assert.ok(!nba.wired.includes('NBA Stats / LiveData'))
  const tennis=freeSourceCoverageForSport('tennis',{})
  assert.ok(tennis.referenceOnly.includes('Sackmann ATP/WTA Archive'))
  const football=freeSourceCoverageForSport('football',{})
  assert.ok(football.wired.includes('nflverse'))
  const soccer=freeSourceCoverageForSport('soccer',{})
  assert.ok(soccer.unconfiguredOptional.includes('football-data.org'))
  assert.ok(freeSourceCoverageForSport('soccer',{PHOENIX_FOOTBALL_DATA_TOKEN:'test'})
    .configuredOptional.includes('football-data.org'))
  assert.ok(!freeSourceCoverageForSport('soccer',{PHOENIX_SPORTS_ESPN_DISABLED:'1'})
    .wired.includes('ESPN Site/Core'))
  assert.equal(freeSourceCoverageForSport('invented',{}).supported,false)
})

test('balldontlie NBA/WNBA free games are optional and do not leak the key',async()=>{
  for(const league of ['nba','wnba']){
    const fixture={...game,league}
    let seen=false
    const fetcher=async(url,options)=>{
      if(String(url).includes('balldontlie')){
        seen=true
        assert.equal(options.headers.Authorization,'secret-bdl-key')
        assert.ok(!String(url).includes('secret-bdl-key'))
        return reply({data:[{date:'2026-11-09T01:00:00Z',
          home_team:{full_name:'Milwaukee Bucks'},
          visitor_team:{full_name:'Boston Celtics'}}]})
      }
      return reply({events:[]})
    }
    const x=await crosscheckFreeFixture(fixture,fetcher,Date.now(),
      {PHOENIX_BALLDONTLIE_API_KEY:'secret-bdl-key'})
    assert.equal(seen,true)
    assert.equal(x.length,2)
    assert.equal(x[1].provider,'balldontlie')
    assert.equal(x[1].status,'verified')
    assert.ok(!JSON.stringify(x).includes('secret-bdl-key'))
  }
  assert.ok(freeSourceCoverageForSport('basketball',{}).unconfiguredOptional.includes('balldontlie'))
  assert.ok(freeSourceCoverageForSport('basketball',{PHOENIX_BALLDONTLIE_API_KEY:'any'})
    .configuredOptional.includes('balldontlie'))
})
test('balldontlie 429 is unavailable and never a negative fixture',async()=>{
  const f=async(url)=>String(url).includes('balldontlie')?reply({},429):reply({events:[]})
  const result=await crosscheckFreeFixture(game,f,Date.now(),{PHOENIX_BALLDONTLIE_API_KEY:'key'})
  assert.equal(result[1].status,'unavailable')
})
test('API-Football optional free plan corroborates an exact soccer event only',async()=>{
  const fixture={sport:'soccer',league:'eng.1',eventId:'123',
    date:'2026-11-08',home:'Arsenal',away:'Liverpool',
    kickoff:'2026-11-08T18:30:00Z'}
  const f=async(url,opts)=>{
    if(String(url).includes('api-sports.io')){
      assert.equal(opts.headers['x-apisports-key'],'secret-foot-key')
      assert.match(String(url),/league=39/)
      return reply({errors:[],response:[{fixture:{date:'2026-11-08T18:30:00Z'},
        teams:{home:{name:'Arsenal FC'},away:{name:'Liverpool FC'}}}]})
    }
    return reply({events:[],matches:[]})
  }
  const x=await crosscheckFreeFixture(fixture,f,Date.now(),
    {PHOENIX_API_FOOTBALL_KEY:'secret-foot-key'})
  assert.equal(x[x.length-1].provider,'API-Football')
  assert.equal(x[x.length-1].status,'verified')
  assert.ok(!JSON.stringify(x).includes('secret-foot-key'))
  assert.ok(freeSourceCoverageForSport('soccer',{}).unconfiguredOptional.includes('API-Football'))
})
