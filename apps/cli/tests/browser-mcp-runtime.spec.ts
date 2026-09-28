import { describe, expect, it } from 'vitest'
import type { EntryOptions } from '@phoenix-ai/cordis-plugin-loader'
import { bundledBrowserConnectorPatches } from '../src/profile-boot.ts'

function rows(entries: EntryOptions[]): ReadonlyMap<string, EntryOptions> {
  return new Map(entries.map(entry => [entry.id, entry]))
}

describe('bundled browser connector assembly', () => {
  it('pins legacy source/tsx launches to the published connector bin', () => {
    const patches = bundledBrowserConnectorPatches(rows([
      {
        id: 'phoenix-browser',
        name: '@phoenix-ai/dsh-mcp-client',
        config: {
          serverName: 'phoenix_browser',
          transport: 'stdio',
          command: 'node',
          args: ['--import', 'tsx/esm', 'packages/mcp/chrome-connector/src/server.ts'],
          cwd: '/tmp/workspace',
          env: {},
        },
      },
      {
        id: 'chrome-browser-primary',
        name: '@phoenix-ai/dsh-mcp-client',
        config: {
          serverName: 'chrome',
          transport: 'stdio',
          command: 'node',
          args: ['--import', 'tsx/esm', 'packages/mcp/chrome-connector/src/bin.ts'],
          cwd: '/tmp/another-workspace',
          env: {},
        },
      },
    ]), '/opt/phoenix/chrome-connector/lib/bin.js', '/usr/bin/node')

    expect(patches).toEqual([
      expect.objectContaining({
        id: 'phoenix-browser',
        config: expect.objectContaining({
          command: '/usr/bin/node',
          args: ['/opt/phoenix/chrome-connector/lib/bin.js'],
          cwd: '',
        }),
      }),
      expect.objectContaining({
        id: 'chrome-browser-primary',
        config: expect.objectContaining({
          command: '/usr/bin/node',
          args: ['/opt/phoenix/chrome-connector/lib/bin.js'],
          cwd: '',
        }),
      }),
    ])
  })

  it('leaves an explicitly customized browser connector command untouched', () => {
    const patches = bundledBrowserConnectorPatches(rows([{
      id: 'phoenix-browser',
      name: '@phoenix-ai/dsh-mcp-client',
      config: {
        serverName: 'phoenix_browser',
        transport: 'stdio',
        command: '/custom/browser-mcp',
        args: ['--custom'],
        cwd: '/custom',
        env: {},
      },
    }]), '/opt/phoenix/chrome-connector/lib/bin.js', '/usr/bin/node')

    expect(patches).toEqual([])
  })
})
