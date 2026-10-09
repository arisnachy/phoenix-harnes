import { describe, expect, it } from 'vitest'
import { CONNECTOR_CATALOG, CONNECTOR_PRESETS } from '../src/client/connector-catalog.ts'

const REQUIRED_CONNECTORS = [
  'google-workspace',
  'outlook-mail', 'outlook-calendar', 'onedrive', 'sharepoint', 'box', 'notion',
  'slack', 'microsoft-teams', 'zoom', 'github', 'linear', 'vercel', 'firebase',
  'supabase', 'neon', 'posthog', 'hugging-face', 'canva', 'heygen', 'magnific',
  'coursera', 'devpost', 'brave-search', 'filesystem', 'memory', 'fetch', 'apollo', 'binance', 'x', 'openai-platform',
] as const

const REQUIRED_PRESETS = [
  'hackathon', 'default', 'development', 'security', 'data-analytics', 'cloud-data', 'documents',
  'pdf', 'presentations', 'meetings', 'finance', 'research-ai', 'ai-media',
] as const

describe('connector catalog', () => {
  it('contains every first-party catalog entry promised by Settings', () => {
    const ids = new Set(CONNECTOR_CATALOG.map(connector => connector.id))
    for (const id of REQUIRED_CONNECTORS) expect(ids.has(id), id).toBe(true)
    expect(ids.size).toBe(CONNECTOR_CATALOG.length)
  })

  it('classifies curated public connectors and owner-private connectors explicitly', () => {
    const byId = new Map(CONNECTOR_CATALOG.map(connector => [connector.id, connector]))
    expect(byId.get('canva')?.provenance).toBe('vendor-official')
    expect(byId.get('github')?.provenance).toBe('vendor-official')
    expect(byId.get('evolucionrd')?.provenance).toBe('private-owner')
    expect(byId.get('kira-juancito-secure')?.provenance).toBe('private-owner')
    expect(byId.get('openclaw')?.provenance).toBe('native')
    expect(byId.get('custom-mcp')?.provenance).toBe('registry-listed')
    expect(byId.get('canva')?.mode).toBe('mcp')
    expect(byId.get('canva')?.aliases).toEqual(expect.arrayContaining(['canvas', 'canva-mcp']))
    expect(byId.get('canva')?.curatedMcp).toBe(true)
    expect(byId.get('canva')?.registryName).toBe('com.canva.mcp/mcp')
  })

  it('deduplicates Google Workspace and keeps GitHub separate from GitHub Copilot auth', () => {
    const byId = new Map(CONNECTOR_CATALOG.map(connector => [connector.id, connector]))
    const google = byId.get('google-workspace')
    expect(google?.openClawConnectorId).toBe('google-workspace')
    expect(google?.aliases).toEqual(expect.arrayContaining(['gmail', 'google-calendar', 'google-drive', 'google-contacts']))
    expect(byId.has('gmail')).toBe(false)
    expect(byId.has('google-calendar')).toBe(false)
    expect(byId.has('google-drive')).toBe(false)
    expect(byId.has('google-contacts')).toBe(false)

    const github = byId.get('github')
    expect(github?.openClawConnectorId).toBe('github')
    expect(github?.mode).toBe('mcp')
    expect(github?.authorizationKey).toBe('authorization-openclaw/github')
    expect(github?.description).toContain("GitHub's official remote MCP")
    expect(github?.description).toContain('GitHub Copilot model authentication is separate')
    expect(google?.authorizationKey).toBe('authorization-google/account')
    expect(byId.get('firebase')?.providerFamily).toBe('firebase')
    expect(byId.get('bigquery')?.providerFamily).toBe('bigquery')
  })

  it('ships the requested core MCP pack as branded Host-curated integrations', () => {
    const byId = new Map(CONNECTOR_CATALOG.map(connector => [connector.id, connector]))
    const ids = [
      'canva', 'supabase', 'heygen', 'figma', 'notion', 'linear', 'cloudflare', 'slack',
      'brave-search', 'filesystem', 'memory', 'fetch',
    ] as const
    for (const id of ids) {
      expect(byId.get(id)?.mode, id).toBe('mcp')
      expect(byId.get(id)?.curatedMcp, id).toBe(true)
      expect(byId.get(id)?.logoUrl, id).toMatch(/^https:\/\/cdn\.simpleicons\.org\//)
    }
    expect(byId.get('heygen')?.providerFamily).toBe('heygen')
    expect(byId.get('brave-search')?.aliases).toContain('brave')
    expect(byId.get('filesystem')?.capabilities).toContain('filesystem')
  })

  it('exposes Devpost Hackathons as a Host-curated MCP', () => {
    const devpost = CONNECTOR_CATALOG.find(connector => connector.id === 'devpost')
    expect(devpost).toMatchObject({
      name: 'Devpost Hackathons',
      mode: 'mcp',
      provenance: 'vendor-official',
      providerFamily: 'devpost',
      curatedMcp: true,
    })
    expect(devpost?.aliases).toContain('devpost-hackathons')
    expect(devpost?.capabilities).toEqual(expect.arrayContaining([
      'hackathons', 'registration', 'rules', 'dates', 'judging', 'requirements',
      'projects', 'thumbnails', 'submissions', 'submission-verification',
    ]))
  })

  it('defines an end-to-end Hackathon mission kit without treating it as authentication', () => {
    const preset = CONNECTOR_PRESETS.find(candidate => candidate.id === 'hackathon')
    expect(preset?.kind).toBe('native-preset')
    expect(preset?.capabilities).toEqual(expect.arrayContaining([
      'hackathons', 'planning', 'code', 'qa', 'deploy', 'evidence', 'video', 'voice', 'submission',
    ]))
    expect(preset?.recommendedConnectors).toEqual(expect.arrayContaining([
      'devpost', 'github', 'vercel', 'canva', 'heygen', 'google-workspace',
    ]))
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
