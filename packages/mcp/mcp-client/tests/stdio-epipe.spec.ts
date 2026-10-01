import { describe, expect, it } from 'vitest'
import type { Config } from '@phoenix-ai/dsh-mcp-client'
import { createTransport } from '@phoenix-ai/dsh-mcp-client/src/transport.ts'

type RuntimeStdioTransport = ReturnType<typeof createTransport> & {
  _process?: {
    stdin?: {
      emit(event: 'error', error: NodeJS.ErrnoException): boolean
      listenerCount(event: 'error'): number
    } | null
  }
}

describe('MCP client stdio EPIPE resilience', () => {
  it('owns the spawned child stdin error event before protocol writes begin', async () => {
    const config: Config = {
      transport: 'stdio',
      serverName: 'epipe-fixture',
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: {},
      cwd: process.cwd(),
      toolCallTimeoutMs: 5_000,
      failOnStartupError: false,
    }
    const transport = createTransport(config) as RuntimeStdioTransport

    await transport.start()
    try {
      const stdin = transport._process?.stdin
      expect(stdin).toBeDefined()
      expect(stdin?.listenerCount('error')).toBeGreaterThan(0)
      expect(() => {
        stdin?.emit(
          'error',
          Object.assign(new Error('broken pipe'), { code: 'EPIPE' }),
        )
      }).not.toThrow()
    } finally {
      await transport.close()
    }
  }, 10_000)
})
