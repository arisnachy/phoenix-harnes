import { describe, expect, it } from 'vitest'
import { parseAntigravityQuota, supportsNativeQuota, createAntigravityQuotaReader } from '../src/antigravity-quota.ts'
const report=JSON.stringify({status:'SUCCESS',num_turns:0,usage:{total_tokens:0},command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets:[{id:'gemini-weekly',window:'weekly',remaining_fraction:0.75,reset_time:'2027-01-01T00:00:00Z'},{id:'gemini-5h',remaining_fraction:0.2}]}]}}})
describe('native Antigravity quota',()=>{
  it('requires a CLI supporting native quota reports',()=>{
    expect(supportsNativeQuota('agy 1.1.10')).toBe(false)
    expect(supportsNativeQuota('agy 1.1.11')).toBe(true)
    expect(supportsNativeQuota('agy 1.5.15')).toBe(true)
  })
  it('preserves separate buckets and never invents missing reset times',()=>{
    const result=parseAntigravityQuota(report,1234)
    expect(result?.[0]?.buckets).toEqual([{id:'gemini-weekly',durationMinutes:10080,remainingPercent:75,resetsAt:1798761600,observedAt:1234},{id:'gemini-5h',durationMinutes:300,remainingPercent:20,observedAt:1234}])
    expect(parseAntigravityQuota(report.replace('"num_turns":0','"num_turns":1'),1234)).toBeUndefined()
  })
  it('does not issue /usage on an old version and caches a real report',async()=>{
    const old:string[]=[]
    const reader=createAntigravityQuotaReader(async args=>{old.push(args.join(' '));return 'agy 1.1.10'})
    expect(await reader()).toBeUndefined()
    expect(old).toEqual(['--version'])
    const calls:string[]=[]
    const read=createAntigravityQuotaReader(async args=>{calls.push(args.join(' '));return args[0]==='--version'?'agy 1.5.15':report})
    expect(await read()).toEqual(await read())
    expect(calls).toEqual(['--version','-p /usage --output-format json'])
  })
})
