import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { childSpawnOptions, isExpectedStdioBrokenPipe, resolveChildCommand } from './mcp-stdio-proxy.mjs'

test('classifies EPIPE as an expected downstream shutdown', () => {
  assert.equal(isExpectedStdioBrokenPipe({ code: 'EPIPE' }), true)
  assert.equal(isExpectedStdioBrokenPipe(new Error('write EPIPE')), true)
})

test('does not hide unrelated stdio errors', () => {
  assert.equal(isExpectedStdioBrokenPipe({ code: 'ECONNRESET' }), false)
  assert.equal(isExpectedStdioBrokenPipe(new Error('permission denied')), false)
  assert.equal(isExpectedStdioBrokenPipe(undefined), false)
})

test('resolves Windows command shims without changing POSIX commands', () => {
  assert.equal(resolveChildCommand('npx', 'win32'), 'npx.cmd')
  assert.equal(resolveChildCommand('node', 'win32'), 'node')
  assert.equal(resolveChildCommand('npx.cmd', 'win32'), 'npx.cmd')
  assert.equal(resolveChildCommand('npx', 'linux'), 'npx')
})

test('uses a Windows shell only for command shims', () => {
  assert.equal(childSpawnOptions('npx', 'win32').shell, true)
  assert.equal(childSpawnOptions('node', 'win32').shell, false)
  assert.equal(childSpawnOptions('npx', 'linux').shell, false)
})

test('exits when the child exits even if proxy stdin remains open', async () => {
  const proxyPath = fileURLToPath(new URL('./mcp-stdio-proxy.mjs', import.meta.url))
  const proxy = spawn(process.execPath, [proxyPath, process.execPath, '-e', ''], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proxy.kill()
      resolve('timeout')
    }, 3000)
    proxy.once('exit', () => {
      clearTimeout(timer)
      resolve('exit')
    })
  })
  assert.equal(result, 'exit')
})


test('gracefully closes an MCP child before escalating SIGTERM', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows process.kill(SIGTERM) does not reliably deliver a Node signal handler')
    return
  }
  const home = mkdtempSync(join(tmpdir(), 'phoenix-mcp-shutdown-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const marker = join(home, 'closed.txt')
  const proxyPath = fileURLToPath(new URL('./mcp-stdio-proxy.mjs', import.meta.url))
  const server = [
    "const fs = require('node:fs')",
    "process.stdin.resume()",
    "process.stdout.write('READY\\n')",
    "process.stdin.once('end', () => fs.writeFileSync(process.argv[1], 'graceful'))",
  ].join('; ')
  const proxy = spawn(process.execPath, [proxyPath, process.execPath, '-e', server, marker], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  proxy.stderr.resume()
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('MCP child did not become ready')), 4_000)
    proxy.once('error', reject)
    proxy.stdout.on('data', chunk => {
      if (!chunk.toString().includes('READY')) return
      clearTimeout(timeout)
      resolve()
    })
  })
  proxy.kill('SIGTERM')
  const exit = await new Promise(resolve => {
    const timeout = setTimeout(() => {
      proxy.kill('SIGKILL')
      resolve('timeout')
    }, 5_000)
    proxy.once('exit', () => {
      clearTimeout(timeout)
      resolve('exit')
    })
  })
  assert.equal(exit, 'exit')
  assert.equal(readFileSync(marker, 'utf8'), 'graceful')
})
