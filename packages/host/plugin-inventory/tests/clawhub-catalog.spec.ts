import { describe, expect, it } from 'vitest'
import { normalizeClawHubCatalog } from '../src/clawhub-catalog.ts'

describe('ClawHub public registry catalog', () => {
  it('recognizes verified official plugin metadata, never publisher badges alone', () => {
    const data = { items: [
      { name: '@openclaw/example', displayName: 'Official example', isOfficial: true, family: 'code-plugin',
        latestVersion: '2.0.0', ownerOfficial: true },
      { name: '@community/extension', displayName: 'Unofficial example', isOfficial: false,
        ownerOfficial: true },
    ] }
    const request = { family: 'code-plugin' as const, officialOnly: true }
    const items = normalizeClawHubCatalog(data, request)
    expect(items.map(item => item.name)).toEqual(['@openclaw/example'])
    expect(items[0]).toMatchObject({ official: true, version: '2.0.0' })
  })

  it('retains one canonical ClawHub identity across providers', () => {
    const data = { items: [
      { slug: 'github', ownerHandle: 'openclaw', displayName: 'GitHub' },
      { slug: 'github', ownerHandle: 'openclaw', displayName: 'GitHub duplicate' },
    ] }
    expect(normalizeClawHubCatalog(data, { family: 'skill' }).map(item => item.name))
      .toEqual(['@openclaw/github'])
  })

  it('deduplicates identical listing identities without treating the catalog as installed tools', () => {
    const data = { items: [
      { name: '@openclaw/example', isOfficial: true },
      { name: '@openclaw/example', isOfficial: true },
    ] }
    const items = normalizeClawHubCatalog(data, { family: 'code-plugin' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ installed: false })
  })
})
