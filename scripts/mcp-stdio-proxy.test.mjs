import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
