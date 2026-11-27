import { describe, expect, it } from 'vitest'
import { NetworkWatch } from '../src/network-watch.ts'

describe('NetworkWatch', () => {
  it('coalesces samples, records actual rates and keeps bounded aggregate history', async () => {
    let calls = 0
    let now = 100000
    let saved: unknown
    const watch = new NetworkWatch(async () => {
      calls++
      return { status: 'completed', neighborCount: 4, receivedBytesPerSecond: 30, sentBytesPerSecond: 20,
        newlyObserved: ['opaque'], noLongerObserved: [], private: 'never stored' }
    }, { read: async () => [], write: async rows => { saved = rows } }, () => now)
    await Promise.all([watch.tick(), watch.tick()])
    expect(calls).toBe(1)
    expect(watch.report()).toMatchObject({ status: 'completed', persisted: true, retainedSamples: 1, latest: { neighbors: 4, rx: 30, added: 1 } })
    expect(JSON.stringify(saved)).not.toMatch(/private|opaque/u)
    now += 190000
    expect(watch.report().status).toBe('degraded')
  })
  it('restores only bounded recent rows, fails soft without local disk', async () => {
    const now = 90000000
    const watch = new NetworkWatch(async () => ({ status: 'completed', neighborCount: 0 }), {
      read: async () => [{ at: 0, neighbors: 3 }, { at: now - 1000, neighbors: 2 }, { at: now, neighbors: -1 }],
      write: async () => { throw new Error('disk unavailable') },
    }, () => now)
    await watch.tick()
    expect(watch.report()).toMatchObject({ persisted: false, retainedSamples: 2, latest: { neighbors: 0, rx: null } })
  })
  it('does not invent data on an unavailable network', async () => {
    const watch = new NetworkWatch(async () => ({ status: 'unavailable' }), null)
    await watch.tick()
    expect(watch.report()).toMatchObject({ status: 'degraded', retainedSamples: 0, latest: null })
  })
  it('restores the scoped pseudonym twin without claiming device connectivity',async()=>{
    const scope='a'.repeat(24),id='b'.repeat(24),other='c'.repeat(24),now=1000000
    const watch=new NetworkWatch(async()=>({status:'completed',neighborCount:1,networkScope:scope,observedDeviceIds:[id,'not-valid']}),{
      read:async()=>[{at:now-60000,scope,neighbors:2,devices:[id,other]},{at:now-30000,scope:'d'.repeat(24),neighbors:1,devices:['e'.repeat(24)]}],
      write:async()=>{},
    },()=>now)
    await watch.tick()
    expect(watch.report().twin).toEqual({scope,observedAt:now,devices:[
      {id,firstObserved:now-60000,lastObserved:now,presentInLatestCache:true},
      {id:other,firstObserved:now-60000,lastObserved:now-60000,presentInLatestCache:false},
    ]})
    expect(watch.report().history.every(x=>x.devices===null)).toBe(true)
  })
  it('reports spikes only against recent same-network host baselines', async () => {
    const scope='a'.repeat(24)
    let now=1000000
    let rx=100
    let networkScope=scope
    const watch=new NetworkWatch(async()=>({status:'completed',neighborCount:3,networkScope,receivedBytesPerSecond:rx}),null,()=>now)
    for(let i=0;i<10;i++){await watch.tick();now+=60000}
    rx=2000000
    await watch.tick()
    expect(watch.report().alerts).toMatchObject([{kind:'host-traffic-spike-rx',baseline:100,observed:2000000}])
    now+=60000;networkScope='b'.repeat(24)
    await watch.tick()
    expect(watch.report().alerts).toEqual([])
    now+=190000
    expect(watch.report().alerts).toEqual([])
  })
})
