import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyVoiceFailure, inspectCodexLive, managedCodexBin } from './phoenix-codex-live-doctor.mjs'

const fixture = () => {
  const home = mkdtempSync(join(tmpdir(), 'phoenix-codex-voice-'))
  const dir = join(home, 'codex-cli')
  mkdirSync(dir)
  writeFileSync(join(dir, 'fake-codex.mjs'), '// fake managed entry')
  writeFileSync(join(dir, 'active.json'), JSON.stringify({
    schema: 1, version: '0.162.1', bin: 'fake-codex.mjs',
  }))
  return home
}

function fakeAppServer(mode = 'ready') {
  return () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    child.kill = () => { child.killed = true; return true }
    child.stdin = {
      write(frame, callback) {
        const request = JSON.parse(frame)
        if (request.id) {
          let result = {}
          let error
          if (request.method === 'account/read') {
            result = { account: mode === 'logged-out' ? null : { type: 'chatgpt' } }
          }
          if (request.method === 'thread/realtime/listVoices') {
            if (mode === 'unsupported') error = { message: 'method requires experimentalApi capability' }
            else result = { voices: ['marin'] }
          }
          queueMicrotask(() => child.stdout.write(JSON.stringify({
            id: request.id, ...(error ? { error } : { result }),
          }) + '\n'))
        }
        callback?.()
      },
    }
    return child
  }
}

test('classifies real upstream failures, without treating protocol rejection as a login error', () => {
  assert.equal(classifyVoiceFailure('invalid_quicksilver_alpha_header'), 'quicksilver-v2-rejected')
  assert.equal(classifyVoiceFailure('403 Forbidden Voice session access denied'), 'voice-access-denied')
  assert.equal(classifyVoiceFailure('401 not authenticated'), 'codex-login-required')
})

test('rejects managed CLI paths escaping the allowlisted runtime root', () => {
  const home = fixture()
  try {
    writeFileSync(join(home, 'codex-cli', 'active.json'), JSON.stringify({
      schema: 1, version: '0.162.1', bin: '../../private.mjs',
    }))
    assert.equal(managedCodexBin(home), undefined)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('checks official experimental RPC without opening mic or using API key', async () => {
  const home = fixture()
  try {
    const result = await inspectCodexLive({ home, timeoutMs: 1000, spawnProcess: fakeAppServer() })
    assert.equal(result.cliVersion, '0.162.1')
    assert.equal(result.status, 'experimental-protocol-ready')
    assert.equal(result.authenticated, true)
    assert.equal(result.experimentalRealtime, true)
    assert.equal(result.webrtcVerified, false)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('distinguishes unsupported native voice from expired Codex login', async () => {
  for (const [mode, status] of [
    ['unsupported', 'realtime-experimental-unavailable'],
    ['logged-out', 'codex-login-required'],
  ]) {
    const home = fixture()
    try {
      const result = await inspectCodexLive({ home, timeoutMs: 1000, spawnProcess: fakeAppServer(mode) })
      assert.equal(result.status, status)
    } finally { rmSync(home, { recursive: true, force: true }) }
  }
})
