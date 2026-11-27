import { describe,expect,it } from 'vitest'
import { curiosityAttention, LivingHomeAttention } from '../src/living-curiosity.ts'
import type { ProactivityTask } from '../src/proactivity-engine.ts'
const now=Date.UTC(2026,10,26,14)
const history=(offset:number,status:'failed'|'completed')=>({phase:'deliver' as const,scheduledFor:new Date(now-offset).toISOString(),
  idempotencyKey:'occ-'+offset,startedAt:new Date(now-offset).toISOString(),finishedAt:new Date(now-offset+1).toISOString(),status,error:'private detail'})
const task:ProactivityTask={id:'test',title:'private title',instruction:'private instruction',createdBy:'user',
  createdAt:new Date(now-100000).toISOString(),updatedAt:new Date(now).toISOString(),nextRunAt:new Date(now+100000).toISOString(),
  recurrence:{kind:'interval',everyMs:60000},catchUp:'latest',visibility:'visible',delivery:'work',senderIdentity:'auto',
  status:'failed',history:[history(90000,'failed'),history(30000,'failed')]}
describe('resident curiosity',()=>{
  it('uses distinct failed occurrences, not retries, and never publishes raw task data',()=>{
    const rows=curiosityAttention([task],now)
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('private')
    expect(curiosityAttention([task],now+1)).toEqual(rows)
    expect(curiosityAttention([{...task,history:[history(30000,'failed'),history(30000,'failed')]}],now)).toEqual([])
    expect(curiosityAttention([{...task,history:[...task.history,history(1000,'completed')]}],now)).toEqual([])
    expect(curiosityAttention([{...task,visibility:'surprise'}],now)).toEqual([])
    expect(curiosityAttention([{...task,attentionMode:'off'}],now)).toEqual([])
  })
  it('observes only sustained unavailability and clears on recovery',async()=>{
    let time=now,state='unavailable',calls=0
    const monitor=new LivingHomeAttention(async()=>{calls++;return [{entityId:'light.private',state}]},()=>time)
    await monitor.observe()
    expect(monitor.read()).toEqual([])
    await monitor.observe()
    expect(calls).toBe(1)
    time+=60000
    await monitor.observe()
    const result=monitor.read()
    expect(result).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('light.private')
    time+=60000
    await monitor.observe()
    expect(monitor.read()).toEqual(result)
    state='on';time+=60000
    await monitor.observe()
    expect(monitor.read()).toEqual([])
    monitor.dispose()
    time+=60000
    await monitor.observe()
    expect(calls).toBe(4)
  })
})
