import {test} from 'node:test'
import assert from 'node:assert/strict'
import {parseMoneyPuckCsv,parseMoneyPuckAdvanced,fetchNhlMoneyPuckEvidence} from '../src/nhl-moneypuck-evidence.ts'

const teams=[
  'team,situation,games_played,xGoalsFor,xGoalsAgainst,xGoalsPercentage,corsiPercentage,fenwickPercentage',
  'TOR,5on5,16,34.6,28.4,0.549,0.52,0.51',
  'MTL,5on5,16,29.2,35.4,0.452,0.48,0.47',
  'TOR,all,16,50,45,0.526,0.51,0.50',
].join('\n')
const goalies=[
  'playerId,situation,games_played,xGoals,goals,highDangerGoals,highDangerShots',
  '8471111,all,12,28.8,23,8,70',
  '8472222,all,11,30.5,36,16,74',
  '8471111,5on5,12,22,19,5,49',
].join('\n')
const ids={homeAbbrev:'TOR',awayAbbrev:'MTL',homeGoalieIds:['8471111'],
  awayGoalieIds:['8472222']}
const args={...ids,season:'20262027',decisionAt:Date.parse('2026-11-16T14:00:00Z'),
  kickoff:'2026-11-17T01:00:00Z',enabled:true}
const stamp='2026-11-15 16:18:42.293167-05:00'
const fake=(date=stamp,code=200)=>{
  const calls=[]
  const fetcher=async url=>{
    calls.push(url)
    if(code!==200)return new Response('error',{status:code})
    return new Response(url.endsWith('update_date.txt')?date:
      url.endsWith('teams.csv')?teams:goalies,{status:200})
  }
  return{fetcher,calls}
}
test('CSV parser handles quoted field/comma and rejects malformed input',()=>{
  const csv='team,situation,season,name\nTOR,5on5,2026,"A, B"\n'
  assert.equal(parseMoneyPuckCsv(csv)[0].name,'A, B')
  assert.throws(()=>parseMoneyPuckCsv('bad,csv'),/tamaño|columnas/)
  assert.throws(()=>parseMoneyPuckCsv(csv+'"never ends'),/comillas/)
})
test('MoneyPuck 5v5 team rows differ from all-situation data; GSAx uses NHL player ID',()=>{
  const result=parseMoneyPuckAdvanced(teams,goalies,ids)
  assert.equal(result.teams.home.xGoalsFor,34.6)
  assert.equal(result.teams.home.xGoalsAgainst,28.4)
  assert.equal(result.teams.home.xGoalsPct,0.549)
  assert.equal(result.teams.away.xGoalsPct,0.452)
  assert.equal(result.goalies.home[0].gsaX,5.8)
  assert.equal(result.goalies.away[0].gsaX,-5.5)
  assert.equal(result.goalies.home[0].highDangerShots,70)
  assert.deepEqual(parseMoneyPuckAdvanced(teams,goalies,
    {...ids,awayGoalieIds:['9999999']}).goalies.away,[])
})
test('opt-in absent: no external calls and no false verification',async()=>{
  const api=fake()
  const result=await fetchNhlMoneyPuckEvidence({...args,enabled:false},api.fetcher)
  assert.equal(result.status,'disabled')
  assert.equal(result.teams.home,null)
  assert.deepEqual(api.calls,[])
})
test('two small files are downloaded in parallel and reused with 15m cache',async()=>{
  const api=fake()
  const result=await fetchNhlMoneyPuckEvidence(args,api.fetcher)
  assert.equal(result.status,'verified')
  assert.equal(result.goalies.away[0].gsaX,-5.5)
  assert.equal(result.updatedAt,'2026-11-15T21:18:42.293Z')
  assert.equal(api.calls.length,3)
  const second=await fetchNhlMoneyPuckEvidence(args,api.fetcher)
  assert.equal(second.status,'verified')
  assert.equal(api.calls.length,3)
})
test('historical replay refuses data updated after decision',async()=>{
  const api=fake('2026-11-16 17:00:00.000000-05:00')
  const result=await fetchNhlMoneyPuckEvidence({...args,season:'20252026'},api.fetcher)
  assert.equal(result.status,'missing')
  assert.match(result.reason,/posterior/)
  assert.equal(api.calls.length,1)
})
test('old or corrupted export cannot silently turn into usable xG',async()=>{
  const api=fake('2026-11-11 03:00:00.000000-05:00')
  const result=await fetchNhlMoneyPuckEvidence({...args,season:'20242025'},api.fetcher)
  assert.equal(result.status,'stale')
  assert.equal(result.teams.home,null)
  const failed=await fetchNhlMoneyPuckEvidence({...args,season:'20232024'},
    fake(stamp,503).fetcher)
  assert.equal(failed.status,'error')
  assert.match(failed.reason,/HTTP 503/)
})
test('ambiguous team rows are not trusted',()=>{
  const v=parseMoneyPuckAdvanced(teams+'\nTOR,5on5,16,50,10,0.8,0.7,0.7',goalies,ids)
  assert.equal(v.teams.home,null)
})
