import { describe, expect, it } from 'vitest'
import { normalizeMicrosoftPersonalMcpLaunch } from '../src/transport.ts'

describe('Microsoft Graph separate MCP launcher', () => {
  const serviceNamespaces = [
    ['outlook-mail', 'mail'], ['outlook-calendar', 'calendar'],
    ['microsoft-contacts', 'contacts'], ['onedrive', 'onedrive'],
    ['microsoft-teams', 'teams'], ['sharepoint', 'sharepoint'],
  ] as const

  it.each(serviceNamespaces)('maps %s to the active isolated runtime script', (server, service) => {
    const launch = normalizeMicrosoftPersonalMcpLaunch(server, 'node',
      ['scripts/phoenix-microsoft-personal-mcp.mjs', service])
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toHaveLength(2)
    expect(launch.args[0]?.replaceAll('\\', '/')).toMatch(/\/scripts\/phoenix-microsoft-personal-mcp\.mjs$/)
    expect(launch.args[1]).toBe(service)
  })

  it('keeps the legacy Microsoft personal launcher unchanged', () => {
    const launch = normalizeMicrosoftPersonalMcpLaunch('microsoft-personal',
      'node', ['scripts/phoenix-microsoft-personal-mcp.mjs'])
    expect(launch.command).toBe(process.execPath)
    expect(launch.args).toHaveLength(1)
  })

  it('does not grant arbitrary namespaces or mismatched service arguments the privileged runtime resolver', () => {
    const cases = [
      ['outlook-mail', 'teams'], ['microsoft-teams', '../escape'], ['made-up', 'mail'],
    ] as const
    for (const [server, service] of cases) {
      const launch = normalizeMicrosoftPersonalMcpLaunch(server, 'node',
        ['scripts/phoenix-microsoft-personal-mcp.mjs', service])
      expect(launch).toEqual({
        command: 'node',
        args: ['scripts/phoenix-microsoft-personal-mcp.mjs', service],
      })
    }
  })
})
