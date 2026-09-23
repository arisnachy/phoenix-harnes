import { describe, expect, it } from 'vitest'
import { CONNECTOR_CATALOG, CONNECTOR_PRESETS } from '../src/client/connector-catalog.ts'

const REQUIRED_CONNECTORS = [
  'gmail', 'google-calendar', 'google-drive', 'google-contacts',
  'outlook-mail', 'outlook-calendar', 'onedrive', 'sharepoint', 'box', 'notion',
  'slack', 'microsoft-teams', 'zoom', 'github', 'linear', 'vercel', 'firebase',
  'supabase', 'neon', 'posthog', 'hugging-face', 'canva', 'heygen', 'magnific',
  'coursera', 'devpost', 'apollo', 'binance', 'openai-platform',
] as const

const REQUIRED_PRESETS = [
  'default', 'development', 'security', 'data-analytics', 'cloud-data', 'documents',
  'pdf', 'presentations', 'meetings', 'finance', 'research-ai', 'ai-media',
] as const

describe('connector catalog', () => {
  it('contains every first-party catalog entry promised by Settings', () => {
    const ids = new Set(CONNECTOR_CATALOG.map(connector => connector.id))
    for (const id of REQUIRED_CONNECTORS) expect(ids.has(id), id).toBe(true)
    expect(ids.size).toBe(CONNECTOR_CATALOG.length)
  })

  it('keeps retired Jev out of the connector catalog', () => {
    expect(CONNECTOR_CATALOG.some(connector => connector.id === 'jev')).toBe(false)
    expect(CONNECTOR_CATALOG.some(connector => connector.providerFamily === 'jev')).toBe(false)
  })

  it('keeps native presets separate from external authentication', () => {
    const presetIds = new Set(CONNECTOR_PRESETS.map(preset => preset.id))
    for (const id of REQUIRED_PRESETS) expect(presetIds.has(id), id).toBe(true)
    expect(CONNECTOR_PRESETS.every(preset => preset.kind === 'native-preset')).toBe(true)
  })

  it('uses only supported connector configuration modes', () => {
    const allowed = new Set(['oauth', 'api-key', 'mcp', 'native'])
    for (const connector of CONNECTOR_CATALOG) {
      expect(allowed.has(connector.mode), connector.id).toBe(true)
      expect(connector.name.length).toBeGreaterThan(0)
      expect(connector.category.length).toBeGreaterThan(0)
      expect(connector.capabilities.length).toBeGreaterThan(0)
    }
  })
})
