import test from 'node:test'
import assert from 'node:assert/strict'
import {projectCodexQuota,inspectCodexQuota} from '../packages/core/tool-living/src/codex-quota.ts'
const now=1_800_000_000_000,hour=3_600_000
const w=(minutes,used,hours)=>({windowDurationMins:minutes,usedPercent:used,resetsAt:(now+hours*hour)/1000,observedAt:now-1000})
const telemetry={kind:'account',provider:'Codex',accountType:'chatgpt',primaryLimit:w(300,40,2),secondaryLimit:w(10080,50,72)}
test('actual remaining percentage, reset countdown and no fabricated balance',()=>{
  const result=projectCodexQuota(telemetry,now)
  assert.equal(result.fiveHours.remainingPercent,60)
  assert.equal(result.fiveHours.remainingSeconds,7200)
  assert.equal(result.sevenDays.remainingPercent,50)
  assert.equal(result.sevenDays.remainingSeconds,259200)
  assert.equal(result.exactRemainingTokens,null)
  assert.equal(result.policy,'balanced')
  assert.equal(result.quotaIsTokenCount,false)
})
test('match window durations even when provider order is reversed',()=>{
  const result=projectCodexQuota({...telemetry,primaryLimit:telemetry.secondaryLimit,secondaryLimit:telemetry.primaryLimit},now)
  assert.equal(result.fiveHours.remainingPercent,60)
  assert.equal(result.sevenDays.remainingPercent,50)
})
test('expired, stale and missing samples fail closed without claiming reset capacity',()=>{
  const old=projectCodexQuota(telemetry,now+121000)
  assert.equal(old.policy,'unknown')
  assert.equal(old.fiveHours.status,'stale')
  const expired=projectCodexQuota({...telemetry,primaryLimit:{...telemetry.primaryLimit,resetsAt:now/1000}},now)
  assert.equal(expired.fiveHours.status,'awaiting-refresh')
  assert.equal(expired.fiveHours.remainingPercent,60)
  assert.equal(projectCodexQuota({...telemetry,primaryLimit:{...telemetry.primaryLimit,windowDurationMins:60}},now).fiveHours.status,'unknown')
  assert.equal(projectCodexQuota({...telemetry,accountType:'apiKey'},now).policy,'unknown')
})
test('fast burn and hard reserve recommendations are separate from exact account balance',()=>{
  assert.equal(projectCodexQuota({...telemetry,secondaryLimit:w(10080,60,160)},now).policy,'conserve')
  assert.equal(projectCodexQuota({...telemetry,secondaryLimit:w(10080,95,72)},now).policy,'protect-reserve')
})
test('inspection uses only native Codex flow and removes unrelated account fields',async()=>{
  let used
  const auth={list:()=>[{key:'openai-codex/oauth',label:'Other'},{key:'subagent-codex/account',label:'Codex'}],inspect:async(key)=>{used=key;return {...telemetry,email:'private@example.test',plan:'private-plan'}}}
  const result=await inspectCodexQuota(auth)
  assert.equal(used,'subagent-codex/account')
  assert.equal(JSON.stringify(result).includes('private'),false)
  assert.equal((await inspectCodexQuota(undefined)).policy,'unknown')
})
