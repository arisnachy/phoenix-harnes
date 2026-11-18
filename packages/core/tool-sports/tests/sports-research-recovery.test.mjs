import {test} from 'node:test'
import assert from 'node:assert/strict'
import {researchSport} from '../src/multi-sport-research.ts'
import {researchTicket} from '../src/research-ticket.ts'
import {evidenceTicket} from '../src/evidence-ticket.ts'
import {keylessOdds,oddsHarvesterArgs} from '../src/keyless-odds.ts'

const day='2026-11-08'
const now=Date.parse('2026-11-08T17:00:00Z')
const kickoff='2026-11-09T01:00:00Z' // 21:00 local Santo Domingo, 8 Nov
const sides=(homeScore,awayScore)=>[
  {homeAway:'home',team:{id:'11',displayName:'Braga'},...(homeScore===null?{}:{score:String(homeScore)})},
  {homeAway:'away',team:{id:'22',displayName:'Rio Ave'},...(awayScore===null?{}:{score:String(awayScore)})},
]
const match=(id,date,state,hs,as)=>({
  id:String(id),date,status:{type:{state}},competitions:[{competitors:sides(hs,as)}],
})
const historicalDays=new Set(['20261107','20261106','20261105','20261104','20261103','20261102','20261101'])
const requestLog=[]
const feed=async url=>{
  const src=String(url),datePart=src.match(/dates=(\d{8})/u)?.[1]
  requestLog.push(src)
  if(src.includes('/soccer/por.1/scoreboard?dates=')){
    if(datePart==='20261108')return new Response('Unavailable',{status:503})
    if(datePart==='20261109')return Response.json({events:[match(410,'2026-11-09T01:00:00Z','pre',null,null)]})
    if(datePart==='20261106')return new Response('Provider error',{status:400})
    if(historicalDays.has(datePart)){
      return Response.json({events:[match(Number(datePart),datePart.slice(0,4)+'-'
        +datePart.slice(4,6)+'-'+datePart.slice(6,8)+'T19:00:00Z','post',3,0)]})
    }
  }
  return Response.json({events:[]})
}
test('partial ESPN 400/503 errors do not erase six distinct verified games',async()=>{
  const out=await researchSport('soccer','por.1',day,feed,now,{},14)
  assert.equal(out.matches.length,1)
  assert.equal(out.matches[0].eventId,'410')
  assert.equal(out.matches[0].home.completedGames,6)
  assert.equal(out.matches[0].away.completedGames,6)
  assert.equal(out.matches[0].evidence,'descriptive')
  assert.ok(out.failedDays>0)
  assert.match(out.matches[0].limitations.join(' '),/Cobertura (?:ESPN )?parcial/)
  assert.ok(requestLog.some(x=>x.includes('dates=20261109')))
})
test('the same local-day match can be verified from the next UTC partition',async()=>{
  const result=await researchTicket([{
    sport:'soccer',league:'por.1',eventId:'410',pick:'home',
    rationale:'Historial de seis encuentros distintos, todavía sujeto a bajas y cuotas.',
  }],day,feed,now,{})
  assert.equal(result.verifiedEvents,1)
  assert.equal(result.card.props.legs[0].eventId,'410')
  assert.equal(result.card.props.legs[0].eventDate,day)
  assert.equal(result.card.props.legs[0].providerLeague,'por.1')
  assert.equal(result.card.props.legs[0].selection,'Braga')
  assert.equal(result.card.props.combinedOdds,'No disponible')
})
test('automatic ticket looks beyond six original leagues and never invents a price',async()=>{
  const report=await evidenceTicket(1,day,'soccer',feed,now,{})
  assert.equal(report.verifiedEvents,1)
  assert.equal(report.complete,true)
  assert.equal(report.selections[0].league,'por.1')
  assert.equal(report.card.props.legs[0].eventId,'410')
  assert.equal(report.card.props.legs[0].price,'Por verificar')
  assert.equal(report.priced,false)
  assert.equal(report.modelProbabilities,false)
})
test('NBA OddsHarvester invalid moneyline retries explicit two-way including-OT market only',async()=>{
  const calls=[]
  const observed=[{
    scraped_date:'2026-11-08 17:00:00 UTC',match_date:'2026-11-09 01:00:00 UTC',
    match_link:'https://www.oddsportal.com/basketball/h2h/boston/milwaukee/#nba',
    home_team:'Boston Celtics',away_team:'Milwaukee Bucks',league_name:'NBA',
    home_away_market:[{bookmaker_name:'Book A',period:'FullIncludingOT','1':'1.70','2':'2.12'}],
  }]
  const runner=async(_sport,market)=>{
    calls.push(market)
    if(market==='moneyline')throw Error('Invalid market: moneyline for basketball')
    return observed
  }
  const rows=await keylessOdds('basketball','moneyline',day,
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'},now,runner)
  assert.deepEqual(calls,['moneyline','home_away'])
  assert.equal(rows.length,2)
  assert.ok(rows.every(x=>x.market==='h2h'&&x.bookmaker==='Book A'))
  const args=oddsHarvesterArgs('basketball','home_away',day,'odds.json')
  assert.equal(args[args.indexOf('--period')+1],'full_including_ot')
})
test('authentication and site blocking do not trigger a misleading market alias',async()=>{
  let attempted=0
  await assert.rejects(()=>keylessOdds('basketball','moneyline',day,
    {PHOENIX_SPORTS_KEYLESS_ODDS_ENABLED:'1'},now,async()=>{
      attempted++
      throw Error('Provider HTTP 401: authorization required')
    }),/401/)
  assert.equal(attempted,1)
})
