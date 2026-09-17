import { describe, expect, it } from 'vitest'
import { resolvePhoenixHome } from '../src/local-model/node-runtime.js'

describe('resolvePhoenixHome', () => {
  it('uses PHOENIX_HOME when Phoenix storage is explicitly configured', () => {
    expect(resolvePhoenixHome({ PHOENIX_HOME: '/srv/phoenix' }, '/home/phoenix')).toBe('/srv/phoenix')
  })

  it('defaults Phoenix-owned data to the .phoenix directory', () => {
    expect(resolvePhoenixHome({}, '/home/phoenix')).toBe('/home/phoenix/.phoenix')
  })

  it('does not inherit the legacy DSH_HOME namespace', () => {
    expect(resolvePhoenixHome({ DSH_HOME: '/srv/deepseek' }, '/home/phoenix')).toBe('/home/phoenix/.phoenix')
  })
})
