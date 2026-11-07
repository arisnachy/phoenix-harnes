import {test} from 'node:test'
import assert from 'node:assert/strict'
import {registerSportsReceipt} from '../src/sports-receipt-register.ts'

const date='2026-11-07'
const fixture=(id,home,away)=>({id:String(id),date:'2026-11-07T21:00:00Z',
  status:{type:{state:'pre'}},competitions:[{competitors:[
    {homeAway:'home',team:{displayName:home}},
    {homeAway:'away',team:{displayName:away}},
  ]}]})
const boards={
  'basketball/nba':{events:[fixture(101,'Phoenix Suns','Houston Rockets')]},
  'hockey/nhl':{events:[
    fixture(201,'Carolina Hurricanes','Chicago Blackhawks'),
    fixture(202,'Ottawa Senators','New Jersey Devils'),
    fixture(203,'Toronto Maple Leafs','New York Rangers'),
    fixture(204,'Dallas Stars','Colorado Avalanche'),
    fixture(205,'Edmonton Oilers','Calgary Flames'),
  ]},
  'soccer/usa.1':{events:[
    fixture(301,'CF Montréal','Vancouver Whitecaps'),
    fixture(302,'Portland Timbers','Seattle Sounders'),
  ]},
}
const calls=[]
const fetcher=async url=>{
  const endpoint=String(url).match(/\/sports\/([a-z]+)\/([^/]+)\/scoreboard\?dates=(\d{8})/)
  assert.ok(endpoint,'Only expected ESPN scoreboard URL: '+url)
  const key=endpoint[1]+'/'+endpoint[2]
  calls.push(key)
  return new Response(JSON.stringify(boards[key]??{events:[]}),{status:200})
}
const input={
  ticketReference:'12126409',date,bookmaker:'Juancito Sport',stake:100,reportedReturn:469,
  legs:[
    {sport:'basketball',league:'nba',team:'Houston Rockets',opponent:'Phoenix Suns',
      market:'total',side:'over',line:223.5,americanOdds:-130},
    {sport:'hockey',league:'nhl',team:'Carolina Hurricanes',market:'moneyline',americanOdds:-460},
    {sport:'hockey',league:'nhl',team:'Ottawa Senators',market:'spread',line:1.5,americanOdds:-245},
    {sport:'hockey',league:'nhl',team:'Toronto Maple Leafs',market:'spread',line:1.5,americanOdds:-245},
    {sport:'hockey',league:'nhl',team:'Dallas Stars',market:'moneyline',americanOdds:-300},
  ],
}
test('imports full five-leg screenshot without asking user to enter goals per game',async()=>{
  calls.length=0
  const result=await registerSportsReceipt(input,fetcher,{},Date.parse('2026-11-07T17:29:47Z'))
  assert.equal(result.linked,5)
  assert.equal(result.operatorAcceptanceVerified,false)
  assert.equal(result.uiBlock.props.ticketReference,'12126409')
  assert.deepEqual(result.uiBlock.props.legs.map(l=>l.trackedBet),[
    {receipt:'12126409',market:'total',side:'over',line:223.5},
    {receipt:'12126409',market:'moneyline',side:'home'},
    {receipt:'12126409',market:'spread',side:'home',line:1.5},
    {receipt:'12126409',market:'spread',side:'home',line:1.5},
    {receipt:'12126409',market:'moneyline',side:'home'},
  ])
  assert.equal(result.uiBlock.props.combinedOdds,'4.690')
  assert.deepEqual(calls.sort(),['basketball/nba','hockey/nhl'])
})
test('handles a second ticket with shared events, away team, MLS and no duplicated provider lookups',async()=>{
  calls.length=0
  const result=await registerSportsReceipt({
    ticketReference:'12126415',date,bookmaker:'Juancito Sport',stake:100,reportedReturn:491,
    legs:[
      {sport:'soccer',league:'usa.1',team:'Vancouver Whitecaps',market:'moneyline',americanOdds:-152},
      {sport:'soccer',league:'usa.1',team:'Portland Timbers',market:'moneyline',americanOdds:-141},
      {sport:'hockey',league:'nhl',team:'Carolina Hurricanes',market:'moneyline',americanOdds:-460},
      {sport:'hockey',league:'nhl',team:'Edmonton Oilers',market:'moneyline',americanOdds:-350},
      {sport:'hockey',league:'nhl',team:'Dallas Stars',market:'moneyline',americanOdds:-300},
    ],
  },fetcher,{})
  assert.equal(result.linked,5)
  assert.equal(result.uiBlock.props.legs[0].trackedBet.side,'away')
  assert.equal(result.uiBlock.props.legs[0].homeTeam,'CF Montréal')
  assert.deepEqual(calls.sort(),['hockey/nhl','soccer/usa.1'])
})
test('rejects unknown teams, ambiguous games, wrong date, fake odds and missing totals opponent',async()=>{
  const base={...input,legs:[input.legs[1]]}
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[1],team:'Carolina Panthers'},
  ]},fetcher,{}),/inequívoca/)
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[1],date:'2026-11-08'},
  ]},fetcher,{}),/inequívoca/)
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[0],opponent:undefined},
  ]},fetcher,{}),/rival|condición/)
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[1],americanOdds:-1},
  ]},fetcher,{}),/Cuota americana/)
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[1],market:'spread',line:-1.5,side:'over'},
  ]},fetcher,{}),/Selección sin condición/)
  await assert.rejects(registerSportsReceipt({...base,legs:[
    {...input.legs[1],eventId:'999'},
  ]},fetcher,{}),/inequívoca/)
})
test('does not silently assume house acceptance, payout, or a completed game means an accepted bet',async()=>{
  const result=await registerSportsReceipt({...input,legs:[input.legs[1]]},fetcher,{})
  assert.match(result.uiBlock.props.note,/ni el operador ni ESPN han confirmado/i)
  assert.equal(result.paymentVerified,false)
  assert.equal(result.linkedEvents[0].eventId,'201')
})
