import {test} from 'node:test'
import assert from 'node:assert/strict'
import {describeOddsSources} from '../src/odds-source-status.ts'

test('Kira discovers free source without requiring an API key or creating a priced quote',async()=>{
  const hits=[]
  const probe=async(bin,args)=>{hits.push([bin,args]);if(bin==='oddsharvester')return 'Usage: oddsharvester';throw Error('not installed')}
  const report=await describeOddsSources('mlb',{},probe,async()=>false)
  const odds=report.sources.find(x=>x.name.includes('OddsHarvester'))
  assert.equal(odds.state,'runtime-ready-unverified')
  assert.equal(odds.keyRequired,false)
  assert.equal(report.currentQuotesVerified,false)
  assert.deepEqual(hits,[['oddsharvester',['--help']]])
  assert.equal(report.sources.filter(x=>x.kind==='historical').length,2)
  assert.equal(report.sources.some(x=>x.name==='ESPN Site/Core API'),true)
})
test('system opt-out disables keyless without a misleading CLI diagnosis',async()=>{
  const report=await describeOddsSources('nba',{PHOENIX_SPORTS_KEYLESS_ODDS_DISABLED:'1'},
    async()=>{throw Error('must not call')},async()=>false)
  assert.equal(report.sources.find(x=>x.name.includes('OddsHarvester')).state,'disabled')
  assert.equal(report.sources.find(x=>x.name.includes('ArnavSaraogi')).state,'not-applicable')
})
test('uvx fallback indicates executable readiness, not guaranteed OddsPortal access',async()=>{
  const calls=[]
  const report=await describeOddsSources('nfl',{},async bin=>{
    calls.push(bin)
    if(bin==='oddsharvester')throw Object.assign(Error('not found'),{code:'ENOENT'})
    return 'uvx 0.9'
  },async()=>false)
  assert.deepEqual(calls,['oddsharvester','uvx'])
  assert.equal(report.sources.find(x=>x.name.includes('OddsHarvester')).state,'runtime-ready-unverified')
  assert.match(report.sources.find(x=>x.name.includes('OddsHarvester')).detail,/aún sin comprobar/)
})
test('separate local historical archives are never recognized as live quotes',async()=>{
  const report=await describeOddsSources('mlb',{PHOENIX_SPORTS_HISTORY_DIR:'/tmp/archives'},
    async()=>{throw Error('unavailable')},async path=>path.endsWith('/mlb-odds.json'))
  assert.equal(report.currentQuotesVerified,false)
  assert.equal(report.sources.find(x=>x.name.includes('ArnavSaraogi')).state,'local-archive-present')
  assert.equal(report.sources.find(x=>x.name.includes('flancast90')).state,'archive-not-installed')
})
