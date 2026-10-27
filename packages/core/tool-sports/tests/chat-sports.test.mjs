import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {sportsCatalog,getFeed,discoverEspnLeagues,chatGames,marketOdds,pricedTicket} from '../src/sports.ts'
import {getMlbPitcherReport} from '../src/mlb.ts'
import {normalizeEspnMoneylines} from '../src/espn-odds.ts'

function response(json){
  return async()=>new Response(JSON.stringify(json),{status:200,headers:{'content-type':'application/json'}})
}
test('17 sports are discoverable without enabling a separate menu',()=>{
  assert.equal(Object.keys(sportsCatalog).length,17)
  assert.ok(sportsCatalog.baseball.includes('mlb'))
  assert.ok(sportsCatalog.soccer.includes('mex.1'))
})
test('ESPN works without a key and supports an explicit operator disable switch',async()=>{
  const mock=await response({events:[]})
  const out=await chatGames('soccer','mex.1','2026-10-24',{},mock)
  assert.equal(out.source,'ESPN Site API')
  assert.equal(out.count,0)
  await assert.rejects(()=>chatGames('soccer','mex.1','2026-10-24',{PHOENIX_SPORTS_ESPN_DISABLED:'1'},mock),/deshabilitado/)
  const odds=await marketOdds('baseball_mlb','h2h',{},mock)
  assert.deepEqual(odds,[])
})
test('no SSRF or HTTP redirects through sports source tool',async()=>{
  await assert.rejects(()=>getFeed('http://127.0.0.1:9999/'),/no permitido/)
  await assert.rejects(()=>getFeed('https://example.com/private'),/no permitido/)
  const data=await getFeed('https://site.api.espn.com/ok',async(_url,options)=>{
    assert.equal(options.redirect,'error')
    return new Response('{"ok":true}',{status:200})
  })
  assert.equal(data.ok,true)
})
test('ESPN result becomes verified chat card with local hour, venue, trusted logo or explicit opt-out',async()=>{
  const mock=await response({events:[{id:'222',name:'Team A vs Team B',date:'2026-10-24T20:00:00Z',status:{type:{description:'Previa'}},competitions:[{venue:{fullName:'Estadio',address:{city:'Santiago'}},competitors:[{homeAway:'home',team:{displayName:'Team B',logo:'https://a.espncdn.com/icon.png'}},{homeAway:'away',team:{displayName:'Team A'}}]}]}]})
  const out=await chatGames('soccer','mex.1','2026-10-24',{PHOENIX_SPORTS_ESPN_ALLOWED:'1'},mock)
  assert.equal(out.count,1)
  assert.equal(out.items[0].component,'sports_game_card')
  assert.equal(out.items[0].props.venue,'Estadio')
  assert.equal(out.items[0].props.home.logo,'https://a.espncdn.com/icon.png')
  assert.match(out.items[0].props.when,/4:00|4:00|16:00/u)
  const disabled=await chatGames('soccer','mex.1','2026-10-24',{PHOENIX_SPORTS_IMAGES_DISABLED:'1'},mock)
  assert.equal(disabled.items[0].props.home.logo,undefined)
})
test('MLB game cards show pitchers only if provided upstream',async()=>{
  const mock=await response({dates:[{games:[{gamePk:43,gameDate:'2026-10-24T19:00:00Z',status:{detailedState:'Pre-Game'},venue:{name:'Stadium'},teams:{home:{team:{id:1,name:'Home'},probablePitcher:{id:55,fullName:'Pitcher H'}},away:{team:{id:2,name:'Away'}}}}]}]})
  const out=await chatGames('baseball','mlb','2026-10-24',{PHOENIX_SPORTS_MLB_ALLOWED:'1'},mock)
  assert.equal(out.items[0].props.highlights[0].value,'Pitcher H')
  assert.equal(out.items[0].props.highlights.length,1)
  assert.equal(out.items[0].props.lineups[0].confirmed,false)
})
test('only real bookmaker lines match a ticket; correlation is flagged',()=>{
  const odds=[{eventId:'evt1',bookmaker:'Book1',market:'h2h',selection:'Home',point:null,price:1.8,home:'Home',away:'Away',time:'today',updatedAt:'now'},
              {eventId:'evt1',bookmaker:'Book1',market:'totals',selection:'Over',point:7.5,price:2.1,home:'Home',away:'Away',time:'today',updatedAt:'now'}]
  const selected=odds.map(({eventId,bookmaker,market,selection,point})=>({eventId,bookmaker,market,selection,point}))
  const result=pricedTicket(selected,odds,100)
  assert.equal(result.card.component,'sports_ticket_card')
  assert.equal(result.card.props.combinedOdds,'3.780')
  assert.equal(result.card.props.grossReturn,'378.00')
  assert.match(result.warning,/mismo encuentro/)
  assert.match(result.card.props.note,/SIN APUESTA REAL/)
  assert.throws(()=>pricedTicket([{...selected[0],selection:'No existe'}],odds),/no verificable/)
  assert.throws(()=>pricedTicket([selected[0],selected[0]],odds),/duplicada/)
})
test('a single ticket cannot combine independently quoted prices from two bookmakers',()=>{
  const quotes=[
    {eventId:'a',bookmaker:'Banca A',market:'h2h',selection:'Home A',price:1.9,
      home:'Home A',away:'Away A',time:'tomorrow',updatedAt:'now'},
    {eventId:'b',bookmaker:'Banca B',market:'h2h',selection:'Home B',price:1.8,
      home:'Home B',away:'Away B',time:'tomorrow',updatedAt:'now'},
  ]
  const selections=quotes.map(({eventId,bookmaker,market,selection})=>({
    eventId,bookmaker,market,selection,
  }))
  assert.throws(()=>pricedTicket(selections,quotes,100),/una sola banca/i)
})
test('bookmaker quotes include provenance and never permit invalid sport keys',async()=>{
  const future=new Date(Date.now()+86400000).toISOString()
  const mock=await response([{id:'e',home_team:'Local',away_team:'Visita',commence_time:future,
    bookmakers:[{key:'provider',title:'Casa',markets:[{key:'h2h',last_update:'2026-10-24T18:00:00Z',outcomes:[{name:'Local',price:1.8}]}]}]}])
  const quotes=await marketOdds('baseball_mlb','h2h',{THE_ODDS_API_KEY:'test-only'},mock)
  assert.equal(quotes[0].bookmaker,'Casa')
  assert.equal(quotes[0].updatedAt,'2026-10-24T18:00:00Z')
  assert.equal(quotes[0].price,1.8)
  await assert.rejects(()=>marketOdds('../bad','h2h',{THE_ODDS_API_KEY:'test'},mock),/Mercado inválido/)
})

test('MLB pitcher analysis preserves missing data and compares verified bullpen stats',async()=>{
  const mock=async(url)=>{
    if(url.includes('/roster?'))return new Response(JSON.stringify({roster:[
      {person:{id:22,fullName:'Pitcher One'},position:{type:'Pitcher'}},
      {person:{id:33,fullName:'Pitcher Two'},position:{type:'Pitcher'}},
      {person:{id:99,fullName:'Position Player'},position:{type:'Infielder'}},
    ]}),{status:200})
    if(url.includes('/people/22/'))return new Response(JSON.stringify({stats:[{splits:[{stat:{era:'2.95',whip:'1.08',inningsPitched:'87.0',strikeOuts:92,gamesStarted:14}}]}]}),{status:200})
    return new Response(JSON.stringify({stats:[]}),{status:200})
  }
  await assert.rejects(()=>getMlbPitcherReport(22,2026,{PHOENIX_SPORTS_MLB_DISABLED:'1'}),/deshabilitada/)
  const r=await getMlbPitcherReport(99,2026,{PHOENIX_SPORTS_MLB_ALLOWED:'1'},mock)
  assert.equal(r.pitchers.length,2)
  assert.equal(r.unavailableStats,1)
  assert.equal(r.pitchers[0].era,'2.95')
  assert.equal(r.pitchers[1].era,'—')
  assert.equal(r.uiBlock.component,'comparison')
  assert.equal(r.uiBlock.props.rows.length,2)
  assert.equal(r.pitchers[0].image,undefined)
})

test('ESPN Site odds provide decimal moneyline only from sourced positive and negative prices',async()=>{
  const future=new Date(Date.now()+86_400_000).toISOString()
  const event={id:'456',date:future,competitions:[{id:'456',competitors:[
    {homeAway:'home',team:{displayName:'Local'}},{homeAway:'away',team:{displayName:'Visitante'}},
  ],odds:[{provider:{name:'ESPN Bet'},homeTeamOdds:{moneyLine:-125},awayTeamOdds:{moneyLine:+105}}]}]}
  const mock=await response({events:[event]})
  const quotes=await marketOdds('baseball_mlb','h2h',{},mock)
  assert.equal(quotes.length,2)
  assert.equal(quotes[0].price,1.8)
  assert.equal(quotes[1].price,2.05)
  assert.equal(quotes[0].source,'ESPN Site/Core (sin clave)')
  const noKeys=await marketOdds('baseball_mlb','totals',{},mock)
  assert.deepEqual(noKeys,[])
  const missing=normalizeEspnMoneylines({...event,competitions:[{...event.competitions[0],odds:[]}]},[])
  assert.deepEqual(missing,[])
})
test('ESPN Core odds references are followed only for trusted https sports.core.api.espn.com',async()=>{
  const date=new Date(Date.now()+86_400_000).toISOString()
  const events={events:[{id:'789',date,competitions:[{id:'789',competitors:[
    {homeAway:'home',team:{name:'Local'}},{homeAway:'away',team:{name:'Visitante'}}]}]}]}
  const queries=[]
  const fetcher=async url=>{
    queries.push(url)
    const data=url.includes('scoreboard?')?events:
      url.includes('odds?')?{items:[{$ref:'https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/events/789/competitions/789/odds/1'}]}:
      {provider:{name:'Casa ESPN'},homeTeamOdds:{moneyLine:-110},awayTeamOdds:{moneyLine:+110}}
    return new Response(JSON.stringify(data),{status:200})
  }
  const odds=await marketOdds('baseball_mlb','h2h',{},fetcher)
  assert.equal(odds.length,2)
  assert.equal(queries.length,3)
})
test('MLB unavailable falls back to ESPN free scoreboard instead of failing the chat',async()=>{
  const urls=[]
  const fetcher=async url=>{
    urls.push(url)
    if(url.startsWith('https://statsapi.mlb.com/'))return new Response('{}',{status:503})
    return new Response('{"events":[]}',{status:200})
  }
  const out=await chatGames('baseball','mlb','2026-10-24',{},fetcher)
  assert.equal(out.source,'ESPN Site API')
  assert.equal(out.count,0)
  assert.equal(urls.length,2)
})

test('Kira discovers additional leagues from public ESPN Core, then requests real scoreboard',async()=>{
  const urls=[]
  const fetcher=async(url)=>{
    urls.push(url)
    if(url.includes('/leagues?limit=500'))return new Response(JSON.stringify({items:[
      {$ref:'https://sports.core.api.espn.com/v2/sports/soccer/leagues/esp.2'},
      {slug:'mex.1'},{slug:'invalid/path'}]}),{status:200})
    return new Response(JSON.stringify({events:[]}),{status:200})
  }
  const leagues=await discoverEspnLeagues('soccer',{},fetcher)
  assert.ok(leagues.includes('esp.2'))
  assert.equal(leagues.includes('invalid/path'),false)
  const games=await chatGames('soccer','esp.2','2026-10-24',{},fetcher)
  assert.equal(games.count,0)
  assert.equal(games.source,'ESPN Site API')
  assert.ok(urls.some(x=>x.includes('/soccer/esp.2/scoreboard')))
})
test('Cricket league references are discovered from the personalized public ESPN Web API',async()=>{
  const urls=[]
  const fetcher=async(url)=>{
    urls.push(url)
    return new Response(JSON.stringify({sports:[{leagues:[{id:123},{id:456}]}]}),{status:200})
  }
  const leagues=await discoverEspnLeagues('cricket',{},fetcher)
  assert.ok(leagues.includes('123'))
  assert.ok(urls[0].startsWith('https://site.web.api.espn.com/'))
})

test('sports native tool instructions never tell Kira to print raw JSON or code fences',()=>{
  const modelFacing=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8')
  assert.match(modelFacing,/NO copies el JSON/)
  assert.doesNotMatch(modelFacing,/instruction:'[^']*(?:reproduce los bloques|JSON intacto|en fence|entre fences)/u)
  assert.match(modelFacing,/Phoenix renderiza uiBlocks automáticamente/)
})


test('ESPN missing event IDs do not produce invalid empty-id game cards',async()=>{
  const mock=await response({events:[{name:'Match without published ID',date:'2026-10-24T20:00:00Z',competitions:[{competitors:[{homeAway:'home',team:{name:'Home'}},{homeAway:'away',team:{name:'Away'}}]}]}]})
  const out=await chatGames('soccer','mex.1','2026-10-24',{},mock)
  assert.equal(out.items.length,1)
  assert.equal(Object.hasOwn(out.items[0].props,'eventId'),false)
  assert.deepEqual(out.items[0].props.highlights,[])
})

test('sportsbook taxonomy groups sourced sports, countries and leagues without inventing player markets',()=>{
  const odds=[
    {eventId:'epl-1',bookmaker:'Casa',market:'h2h',selection:'Arsenal',price:1.8,
      home:'Arsenal',away:'Chelsea',time:'20:00',updatedAt:'2026-10-24',sportKey:'soccer_epl'},
    {eventId:'mlb-1',bookmaker:'Casa',market:'h2h',selection:'Milwaukee',price:2.1,
      home:'Milwaukee',away:'Tampa Bay',time:'21:00',updatedAt:'2026-10-24',sportKey:'baseball_mlb'},
  ]
  const selections=odds.map(({eventId,bookmaker,market,selection})=>({eventId,bookmaker,market,selection}))
  const result=pricedTicket(selections,odds)
  assert.equal(result.card.props.legs[0].sport,'Fútbol')
  assert.equal(result.card.props.legs[0].country,'Inglaterra')
  assert.equal(result.card.props.legs[0].league,'Premier League')
  assert.equal(result.card.props.legs[1].sport,'Béisbol')
  assert.equal(result.card.props.legs[1].league,'MLB')
  assert.equal(result.card.props.legs[0].player,undefined)
  assert.doesNotMatch(result.warning,/mismo encuentro/)
})

test('NBA pregame game cards include a sourced favorite and explicitly low-confidence rationale',async()=>{
  const board={events:[{id:'2028',name:'Heat at Hawks',date:new Date(Date.now()+86400000).toISOString(),
    status:{type:{state:'pre',description:'Scheduled'}},competitions:[{competitors:[
      {homeAway:'home',team:{displayName:'Atlanta Hawks'},records:[{name:'overall',summary:'2-2'}]},
      {homeAway:'away',team:{displayName:'Miami Heat'},records:[{name:'overall',summary:'0-4'}]},
    ]}]}]}
  const out=await chatGames('basketball','nba',undefined,{},await response(board))
  const research=out.items[0].props.research
  assert.match(research.favorite,/Tendencia provisional: Atlanta Hawks/)
  assert.match(research.evidence.join(' '),/Muestra pequeña/)
  assert.match(research.source,/ESPN/)
})

test('ESPN market search honors the user-requested future date, not just today',async()=>{
  const kickoff=new Date(Date.now()+3*86400000).toISOString()
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',
    month:'2-digit',day:'2-digit'}).format(new Date(kickoff))
  const urls=[]
  const mock=async url=>{
    urls.push(String(url))
    return new Response(JSON.stringify({events:[{
      id:'987654',date:kickoff,competitions:[{id:'987654',competitors:[
        {homeAway:'home',team:{displayName:'Local'}},
        {homeAway:'away',team:{displayName:'Visita'}},
      ],odds:[{provider:{name:'Test house'},homeTeamOdds:{moneyLine:-120},
        awayTeamOdds:{moneyLine:110}}]}],
    }]}),{status:200})
  }
  const odds=await marketOdds('basketball_nba','h2h',{},mock,day)
  assert.equal(odds.length,2)
  assert.ok(urls[0].includes('dates='+day.replaceAll('-','')))
  await assert.rejects(()=>marketOdds('basketball_nba','h2h',{},mock,'2026-02-31'),/Fecha/)
})

test('commercial sportsbook quotes exclude already started events',async()=>{
  const mock=await response([
    {id:'past',home_team:'Home',away_team:'Away',
      commence_time:new Date(Date.now()-60000).toISOString(),bookmakers:[{
        key:'book',title:'Book',markets:[{key:'h2h',outcomes:[{name:'Home',price:1.8}]}],
      }]},
    {id:'future',home_team:'Home2',away_team:'Away2',
      commence_time:new Date(Date.now()+60000).toISOString(),bookmakers:[{
        key:'book',title:'Book',markets:[{key:'h2h',outcomes:[{name:'Home2',price:1.8}]}],
      }]},
  ])
  const out=await marketOdds('basketball_nba','h2h',{THE_ODDS_API_KEY:'fixture'},mock)
  assert.equal(out.length,1)
  assert.equal(out[0].eventId,'future')
})
