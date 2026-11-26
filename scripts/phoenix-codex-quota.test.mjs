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

test('forecast uses native window-average as a labelled estimate, not a token count',()=>{
  const result=projectCodexQuota(telemetry,now)
  assert.equal(result.fiveHours.forecast.basis,'window-average')
  assert.equal(result.fiveHours.forecast.observedPercentPerHour,null)
  assert.ok(result.fiveHours.forecast.planningPercentPerHour>0)
  assert.equal(result.exactRemainingTokens,null)
})
test('same-window consumption and conservative pacing forecast',()=>{
  const earlier={...telemetry,primaryLimit:{...telemetry.primaryLimit,usedPercent:10,observedAt:now-1801000},secondaryLimit:{...telemetry.secondaryLimit,usedPercent:40,observedAt:now-1801000}}
  const result=projectCodexQuota(telemetry,now,earlier)
  assert.equal(result.fiveHours.forecast.basis,'same-window-observations')
  assert.equal(result.fiveHours.forecast.observedPercentPerHour,60)
  assert.equal(result.fiveHours.forecast.reserveAtRisk,true)
  assert.equal(result.forecastRecommendation,'reduce-burn')
})
test('stale, duplicate, reversed consumption and reset changes cannot be measured rates',()=>{
  assert.equal(projectCodexQuota(telemetry,now+121000,telemetry).fiveHours.forecast.basis,'unknown')
  assert.equal(projectCodexQuota(telemetry,now,telemetry).fiveHours.forecast.observedPercentPerHour,null)
  for(const previous of [{...telemetry.primaryLimit,usedPercent:70,observedAt:now-1801000},{...telemetry.primaryLimit,resetsAt:telemetry.primaryLimit.resetsAt-18000,observedAt:now-1801000}]){
    assert.equal(projectCodexQuota(telemetry,now,{...telemetry,primaryLimit:previous}).fiveHours.forecast.observedPercentPerHour,null)
  }
})
test('reserve breach is immediate even with an insufficient observation period',()=>{
  const result=projectCodexQuota({...telemetry,primaryLimit:w(300,97,5)},now)
  // The sample predates the window start by one second, so it is not usable for forecasting.
  assert.equal(result.fiveHours.forecast.basis,'unknown')
  assert.equal(result.policy,'protect-reserve')
})

test('inspector does not mix historical samples across account changes or expose identity',async()=>{
  const time=Date.now()
  let email='one@example.test',calls=0
  const primary={windowDurationMins:300,usedPercent:40,resetsAt:(time+2*hour)/1000,observedAt:time-1000}
  const secondary={windowDurationMins:10080,usedPercent:50,resetsAt:(time+72*hour)/1000,observedAt:time-1000}
  const auth={list:()=>[{key:'subagent-codex/account',label:'Codex'}],inspect:async()=>{calls++;return {kind:'account',provider:'Codex',accountType:'chatgpt',email,primaryLimit:primary,secondaryLimit:secondary}}}
  const first=await inspectCodexQuota(auth)
  email='two@example.test'
  const second=await inspectCodexQuota(auth)
  assert.equal(first.fiveHours.forecast.observedPercentPerHour,null)
  assert.equal(second.fiveHours.forecast.observedPercentPerHour,null)
  assert.equal(JSON.stringify(second).includes('@example.test'),false)
  assert.equal(calls,2)
})
