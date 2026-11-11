import {test} from 'node:test'
import assert from 'node:assert/strict'
import {fetchEspnScoreboardWithFallback} from '../src/espn-nfl-weekly.ts'
test('recovers exact NFL event using ESPN weekly fallback',async()=>{
  const calls=[]
  const result=await fetchEspnScoreboardWithFallback('football','nfl','20261110',
    async uri=>{calls.push(uri);return{events:uri.includes('&week=')?
      [{id:'401999001',date:'2026-11-11T01:00:00Z'}]:[]}},'401999001')
  assert.equal(result.events.length,1)
  assert.ok(calls.some(uri=>uri.includes('seasontype=2&week=')))
})
test('rejects wrong NFL day and wrong ID',async()=>{
  const result=await fetchEspnScoreboardWithFallback('football','nfl','20261110',
    async uri=>({events:uri.includes('&week=')?
      [{id:'999',date:'2026-11-15T18:00:00Z'}]:[]}), '401999001')
  assert.deepEqual(result.events,[])
})
test('does not query NBA weeks',async()=>{
  const calls=[]
  await fetchEspnScoreboardWithFallback('basketball','nba','20261110',
    async uri=>{calls.push(uri);return{events:[]}})
  assert.equal(calls.length,1)
})
