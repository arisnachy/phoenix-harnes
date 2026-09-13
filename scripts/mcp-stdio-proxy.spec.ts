import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const proxy = resolve('scripts/mcp-stdio-proxy.mjs')

describe('PHOENIX MCP stdio proxy', () => {
  it('keeps the checked-in proxy available at the configured path', () => {
    expect(existsSync(proxy)).toBe(true)
  })

  it('forwards stdin to the child and child stdout back to the MCP host', async () => {
    const child = spawn(process.execPath, [proxy, process.execPath, '-e', 'process.stdin.pipe(process.stdout)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.resume()
    child.stdin.write('phoenix-probe\n')
    child.stdin.end()
    const [code] = await once(child, 'close') as [number | null]
    expect(code).toBe(0)
    expect(Buffer.concat(output).toString()).toBe('phoenix-probe\n')
  })

  it('launches npx through its Windows shim', async () => {
    const child = spawn(process.execPath, [proxy, 'npx', '--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.resume()
    const [code] = await once(child, 'close') as [number | null]
    expect(code).toBe(0)
    expect(Buffer.concat(output).toString().trim()).toMatch(/^\d+\.\d+\.\d+/u)
  })
})
