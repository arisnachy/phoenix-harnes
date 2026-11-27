import { describe, expect, it } from 'vitest'
import { AutonomicRuntime, upcomingAutonomicTasks, registerAutonomicRuntime, readAutonomicRuntime } from '../src/autonomic-runtime.ts'
import type { ProactivityEngine, ProactivityTask } from '../src/proactivity-engine.ts'
const now = 1_000_000
const signals = (at: number, internetReachable: boolean | null = true, batteryDischargingPercent: number | null = null) => ({observedAt:at,internetReachable,batteryDischargingPercent})
const task = (id: string, options: Partial<ProactivityTask> = {}) => ({ id, createdBy:'user', visibility:'visible',status:'scheduled',nextRunAt:new Date(now+60_000).toISOString(), ...options }) as ProactivityTask
describe('AUTONOMIC resident governor', () => {
  it('defers optional reads on memory pressure and restores after two healthy samples', () => {
    let free=5
    const runtime=new AutonomicRuntime(()=>({free,total:100}))
    runtime.observe(signals(now),[],now)
    expect(runtime.read(now).mode).toBe('conserve')
    expect(runtime.takeOptionalHomeSlot(now)).toBe(false)
    free=20
    runtime.observe(signals(now+15_000),[],now+15_000)
    expect(runtime.takeOptionalHomeSlot(now+15_000)).toBe(false)
    runtime.observe(signals(now+30_000),[],now+30_000)
    expect(runtime.takeOptionalHomeSlot(now+30_000)).toBe(true)
    expect(runtime.takeOptionalHomeSlot(now+31_000)).toBe(false)
    expect(runtime.read(now+200_000).mode).toBe('unknown')
  })
  it('uses low discharging battery and does not count repeated cached failures', () => {
    const runtime=new AutonomicRuntime(()=>({free:50,total:100}))
    runtime.observe(signals(now,false,10),[],now)
    runtime.observe(signals(now,false,10),[],now+15_000)
    expect(runtime.items(now+15_000)).toEqual([])
    expect(runtime.read(now+15_000).mode).toBe('conserve')
    runtime.observe(signals(now+30_000,false,10),[],now+30_000)
    expect(runtime.items(now+30_000)[0]?.id).toBe('autonomic:network')
    runtime.observe(signals(now+45_000,null),[],now+45_000)
    expect(runtime.items(now+45_000)).toEqual([])
  })
  it('forecasts visible user tasks without leaking surprise or instructions', () => {
    const tasks=[task('a'),task('b'),task('secret',{visibility:'surprise'}),task('off',{attentionMode:'off'}),task('auto',{createdBy:'harness'})]
    expect(upcomingAutonomicTasks(tasks,now).map(row=>row.id)).toEqual(['a','b'])
    const runtime=new AutonomicRuntime(()=>({free:50,total:100}))
    runtime.observe(signals(now),tasks,now)
    expect(runtime.read(now).upcomingUserTasks).toBe(2)
    expect(JSON.stringify(runtime.items(now))).not.toContain('secret')
  })
  it('shares only the registered host state and expires it on disposal', () => {
    const engine={} as ProactivityEngine
    const runtime=new AutonomicRuntime(()=>({free:50,total:100}))
    const dispose=registerAutonomicRuntime(engine,runtime)
    runtime.observe(signals(now),[],now)
    expect(readAutonomicRuntime(engine,now).mode).toBe('normal')
    dispose()
    expect(readAutonomicRuntime(engine,now).mode).toBe('unknown')
  })
})
