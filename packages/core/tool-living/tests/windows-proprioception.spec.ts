import { describe, it, expect, vi } from 'vitest'
import { WindowsProprioception } from '../src/windows-proprioception.ts'

describe('Windows fast proprioception', () => {
  it('shares a refresh, filters locally and expires cached inventory', async () => {
    let time = 1000
    const run = vi.fn(async () => ({catalogKnown: true, catalog: ['Excel', 'Word'], visibleKnown: true, visible: ['EXCEL']}))
    const service = new WindowsProprioception('win32', run, () => time)
    service.warm()
    const [a,b] = await Promise.all([service.inspect('excel', ['computer']),service.inspect(undefined, ['pwsh'])])
    expect(run).toHaveBeenCalledTimes(1)
    expect(a.apps.names).toEqual(['Excel'])
    expect(a.visibleApps.processNames).toEqual(['EXCEL'])
    expect(a.actions).toMatchObject({computerRegistered:true, authorized:false})
    expect(b.apps.names).toEqual(['Excel','Word'])
    time += 30001
    await service.inspect(undefined, [])
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('does not expose arbitrary probe fields or pretend a failed catalog is empty', async () => {
    const service = new WindowsProprioception('win32', async () => ({
      catalogKnown:false, catalog:['SECRET'], visibleKnown:true, visible:['notepad'],
      title:'PRIVATE DOCUMENT', path:'PRIVATE PATH',
    }))
    const result = await service.inspect(undefined,[])
    expect(result.apps).toMatchObject({known:false,names:[]})
    expect(result.visibleApps).toMatchObject({known:true,processNames:['notepad']})
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/u)
  })
  it('does not probe another OS or report expired data as fresh', async () => {
    const run = vi.fn(async () => ({catalogKnown:true,catalog:['Word']}))
    expect((await new WindowsProprioception('linux',run).inspect(undefined,[])).status).toBe('unavailable')
    expect(run).not.toHaveBeenCalled()
    let time = 0
    const probe = vi.fn(async () => ({catalogKnown:true,catalog:['Word']}))
    const service = new WindowsProprioception('win32',probe,() => time)
    await service.inspect(undefined,[])
    time = 30001
    probe.mockRejectedValueOnce(Error('unavailable'))
    expect(await service.inspect(undefined,[])).toMatchObject({status:'unavailable',observedAt:null,apps:{known:false}})
  })
})
