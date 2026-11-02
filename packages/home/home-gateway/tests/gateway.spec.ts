import { describe, expect, it } from 'vitest'
import {
  HomeAssistantGateway,
  resolveHomeAssistantConfig,
  type HomeAssistantConfig,
} from '../src/index.ts'

const config: HomeAssistantConfig = {
  baseUrl: 'http://homeassistant.local:8123',
  tokenEnv: 'HOME_ASSISTANT_TOKEN',
  allowedEntities: ['light.office', 'sensor.office_temperature'],
  allowedServices: ['light.turn_on'],
  requestTimeoutMs: 2_000,
}

describe('Home Assistant gateway configuration', () => {
  it('accepts a local home endpoint and normalizes its trailing slash', () => {
    expect(resolveHomeAssistantConfig({
      baseUrl: 'http://homeassistant.local:8123/',
      tokenEnv: 'HOME_ASSISTANT_TOKEN',
      allowedEntities: ['light.office'],
      allowedServices: ['light.turn_on'],
      requestTimeoutMs: 2_000,
    })).toEqual({ ...config, allowedEntities: ['light.office'], allowedServices: ['light.turn_on'] })
  })

  it('rejects public endpoints and empty authorization allowlists', () => {
    expect(() => resolveHomeAssistantConfig({ ...config, baseUrl: 'https://example.com' })).toThrow(/private home endpoint/u)
    expect(() => resolveHomeAssistantConfig({ ...config, allowedEntities: [] })).toThrow(/allowedEntities/u)
    expect(() => resolveHomeAssistantConfig({ ...config, allowedServices: [] })).toThrow(/allowedServices/u)
  })
})

describe('Home Assistant gateway operations', () => {
  it('lists only explicitly allowed entities and sends the token at request time', async () => {
    const seen: Request[] = []
    const gateway = new HomeAssistantGateway(config, {
      token: 'secret-token',
      fetch: async (input, init) => {
        seen.push(new Request(input, init))
        return new Response(JSON.stringify([
          { entity_id: 'light.office', state: 'on', attributes: { friendly_name: 'Office' } },
          { entity_id: 'light.bedroom', state: 'off', attributes: {} },
        ]), { status: 200 })
      },
    })

    await expect(gateway.listDevices()).resolves.toEqual([{
      entityId: 'light.office',
      state: 'on',
      attributes: { friendly_name: 'Office' },
    }])
    expect(seen[0]?.url).toBe('http://homeassistant.local:8123/api/states')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer secret-token')
  })

  it('rejects unapproved entity and service before making a control request', async () => {
    let requests = 0
    const gateway = new HomeAssistantGateway(config, {
      token: 'secret-token',
      fetch: async () => { requests += 1; return new Response('[]') },
    })

    await expect(gateway.control({ entityId: 'light.bedroom', service: 'turn_on', data: {} })).rejects.toThrow(/not allowlisted/u)
    await expect(gateway.control({ entityId: 'light.office', service: 'turn_off', data: {} })).rejects.toThrow(/not allowlisted/u)
    expect(requests).toBe(0)
  })

  it('calls an approved Home Assistant service and returns a bounded result', async () => {
    let request: Request | undefined
    const gateway = new HomeAssistantGateway(config, {
      token: 'secret-token',
      fetch: async (input, init) => {
        request = new Request(input, init)
        return new Response(JSON.stringify([{ entity_id: 'light.office', state: 'on' }]), { status: 200 })
      },
    })

    await expect(gateway.control({ entityId: 'light.office', service: 'turn_on', data: { brightness: 80 } })).resolves.toEqual({
      entityId: 'light.office',
      service: 'light.turn_on',
      status: 200,
      succeeded: true,
    })
    expect(request?.url).toBe('http://homeassistant.local:8123/api/services/light/turn_on')
    expect(await request?.json()).toEqual({ entity_id: 'light.office', brightness: 80 })
  })
})
