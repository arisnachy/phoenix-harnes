import { describe, expect, it, vi } from 'vitest'
import type { PromptSection } from '@phoenix-ai/dsh-system-prompt'
import {
  CONNECTOR_OPERATING_PROTOCOL,
  installConnectorProtocol,
} from '../src/connector-protocol.ts'

describe('PHOENIX connector operating protocol', () => {
  it('registers one stable just-in-time connector policy section', () => {
    const dispose = vi.fn()
    const systemPrompt = {
      section: vi.fn((_section: PromptSection) => dispose),
    }

    const returned = installConnectorProtocol(systemPrompt)
    const section = systemPrompt.section.mock.calls[0]?.[0]

    expect(section).toEqual({
      name: 'hardness:connector-operating-protocol',
      order: 157,
      text: CONNECTOR_OPERATING_PROTOCOL,
    })
    expect(returned).toBe(dispose)
    returned()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('pins connector selection, auth recovery, discovery, UX, privacy, and automation behavior', () => {
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Do not use a connector merely because one exists')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('If the matching connector tool is already available and healthy, call it directly')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Call connector_list once')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('connect-or-reconnect')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('401/403')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Reconnect')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Never ask the user to paste OAuth tokens')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('connector_discover')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Official MCP Registry')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('connector_install')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('resume the blocked step automatically')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('do not enumerate hundreds of connector schemas')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('Do not browse unrelated private data')
    expect(CONNECTOR_OPERATING_PROTOCOL).toContain('A connector provides access to an external system; a durable PHOENIX task/scheduler decides when')
  })
})
