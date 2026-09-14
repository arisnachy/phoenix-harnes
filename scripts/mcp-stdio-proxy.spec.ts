import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const proxy = resolve('scripts/mcp-stdio-proxy.mjs')
const guard = resolve('scripts/mcp-stdio-epipe-guard.mjs')

describe('PHOENIX MCP stdio proxy', () => {
  it('keeps the checked-in proxy and child EPIPE guard available', () => {
    expect(existsSync(proxy)).toBe(true)
    expect(existsSync(guard)).toBe(true)
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

  it('preloads the EPIPE guard into Node MCP children', async () => {
    const child = spawn(
      process.execPath,
      [
        proxy,
        process.execPath,
        '-e',
        "process.stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))",
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    child.stdout.resume()
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    const [code] = await once(child, 'close') as [number | null]
    expect(code).toBe(0)
    expect(Buffer.concat(stderr).toString()).not.toContain('Unhandled')
  })

  it('preloads the EPIPE guard into descendants spawned by an MCP command', async () => {
    const child = spawn(
      process.execPath,
      [
        proxy,
        process.execPath,
        '-e',
        "import { spawn } from 'node:child_process'; const nested = spawn(process.execPath, ['-e', `process.stdout.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))`], { stdio: ['ignore', 'inherit', 'inherit'] }); nested.once('close', code => process.exit(code ?? 1))",
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    child.stdout.resume()
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    const [code] = await once(child, 'close') as [number | null]
    expect(code).toBe(0)
    expect(Buffer.concat(stderr).toString()).not.toContain('Unhandled')
  })

  it('preserves existing NODE_OPTIONS while adding the EPIPE guard', async () => {
    const child = spawn(
      process.execPath,
      [
        proxy,
        process.execPath,
        '-e',
        "if (!process.env.NODE_OPTIONS?.includes('--no-warnings') || !process.env.NODE_OPTIONS.includes('mcp-stdio-epipe-guard.mjs')) process.exit(9)",
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
      },
    )
    child.stdout.resume()
    child.stderr.resume()
    const [code] = await once(child, 'close') as [number | null]
    expect(code).toBe(0)
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
  }, 15_000)
})
