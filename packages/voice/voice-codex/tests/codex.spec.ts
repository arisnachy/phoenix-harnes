import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createCodexRealtimeProvider } from '../src/index.ts'

const FAKE_CODEX_APP_SERVER = String.raw`
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
rl.on('line', line => {
  const message = JSON.parse(line)
  if (typeof message.id !== 'number') return
  switch (message.method) {
    case 'initialize':
      send({ id: message.id, result: {} })
      break
    case 'thread/realtime/listVoices':
      send({
        id: message.id,
        result: { voices: { v1: ['cove'], v2: ['marin', 'cedar'], defaultV1: 'cove', defaultV2: 'marin' } },
      })
      break
    case 'thread/start':
      send({ id: message.id, result: { thread: { id: 'thread-1' } } })
      break
    case 'thread/realtime/start':
      send({ id: message.id, result: {} })
      send({ method: 'thread/realtime/sdp', params: { threadId: message.params.threadId, sdp: 'fake-answer' } })
      break
    case 'thread/realtime/appendSpeech':
      send({ id: message.id, result: {} })
      send({
        method: 'thread/realtime/transcript/done',
        params: { threadId: message.params.threadId, role: 'assistant', text: message.params.text },
      })
      break
    case 'thread/realtime/stop':
      send({ id: message.id, result: {} })
      break
    default:
      send({ id: message.id, error: { code: -32601, message: 'unknown method' } })
  }
})
`

function fakeCodexProcess() {
  return spawn(process.execPath, ['-e', FAKE_CODEX_APP_SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

describe('Codex realtime voice provider', () => {
  it('uses app-server experimental realtime without giving Codex task authority', async () => {
    const provider = createCodexRealtimeProvider({
      voice: 'cedar',
      requestTimeoutMs: 5_000,
      spawnProcess: fakeCodexProcess,
    })

    await expect(provider.status()).resolves.toEqual({
      voices: ['marin', 'cedar', 'cove'],
      defaultVoice: 'marin',
    })
    await expect(provider.open({ key: 'kira-live-1', sdp: 'fake-offer' })).resolves.toEqual({
      sdp: 'fake-answer',
      voice: 'cedar',
    })
    await expect(provider.speak('kira-live-1', 'Hola desde Phoenix.')).resolves.toBeUndefined()
    await expect(provider.close('kira-live-1')).resolves.toBe(true)
    await provider.closeAll()
  })
})
