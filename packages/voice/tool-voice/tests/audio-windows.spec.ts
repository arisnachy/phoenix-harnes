import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAudioDescriptor, parseAudioCapture, transcribeApprovedAudioFile } from '../src/audio-windows.ts'

describe('PHOENIX Universal Ear trust boundary', () => {
  it('accepts only the current-user native descriptor schema', () => {
    expect(parseAudioDescriptor(JSON.stringify({schema:1,pipeName:'PhoenixDesktop.Browser.01234abc'})))
      .toBe('PhoenixDesktop.Browser.01234abc')
    expect(() => parseAudioDescriptor('{"schema":1,"pipeName":"other"}')).toThrow(/INVALID/)
    expect(() => parseAudioDescriptor('{"schema":2,"pipeName":"PhoenixDesktop.Browser.xyz"}')).toThrow(/INVALID/)
  })
  it('fails closed when a file is outside authorized directories', async () => {
    const root = join(tmpdir(), 'phoenix-audio-test-' + randomUUID())
    const approved = join(root, 'approved')
    const elsewhere = join(root, 'elsewhere')
    await mkdir(approved, { recursive: true })
    await mkdir(elsewhere)
    const outside = join(elsewhere, 'voice.wav')
    await writeFile(outside, Buffer.alloc(1024))
    vi.stubEnv('PHOENIX_AUDIO_ALLOWED_DIRS', approved)
    try {
      await expect(transcribeApprovedAudioFile(outside)).rejects.toThrow(/DIRECTORY_NOT_AUTHORIZED/)
      await expect(transcribeApprovedAudioFile('https://example.test/audio.wav')).rejects.toThrow(/PATH_INVALID/)
    } finally {
      vi.unstubAllEnvs()
      await rm(root,{recursive:true,force:true})
    }
  })

  it('rejects forged audio receipts and cross-session substitutions', () => {
    const data = {
      status:'captured',source:'windows-output-loopback',file:'C:\\Temp\\audio-12345678901234567890123456789012.wav',
      bytes:1024,seconds:8,sessionId:'agent-kira',device:'Speakers',
    }
    expect(() => parseAudioCapture(JSON.stringify({...data,sessionId:'other'}),'agent-kira',8)).toThrow(/INVALID/)
    expect(() => parseAudioCapture(JSON.stringify({...data,seconds:60}),'agent-kira',8)).toThrow(/INVALID/)
    expect(() => parseAudioCapture(JSON.stringify({...data,file:'C:\\Temp\\evil.wav'}),'agent-kira',8)).toThrow(/INVALID/)
    expect(() => parseAudioCapture(JSON.stringify({...data,source:'windows-microphone'}),'agent-kira',8,'output'))
      .toThrow(/INVALID/)
    expect(() => parseAudioCapture(JSON.stringify({...data,source:'windows-output-loopback'}),'agent-kira',8,'microphone'))
      .toThrow(/INVALID/)
  })
})
