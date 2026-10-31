import { describe, expect, it } from 'vitest'
import { parseAudioDescriptor, parseAudioCapture } from '../src/audio-windows.ts'

describe('PHOENIX Universal Ear trust boundary', () => {
  it('accepts only the current-user native descriptor schema', () => {
    expect(parseAudioDescriptor(JSON.stringify({schema:1,pipeName:'PhoenixDesktop.Browser.01234abc'})))
      .toBe('PhoenixDesktop.Browser.01234abc')
    expect(() => parseAudioDescriptor('{"schema":1,"pipeName":"other"}')).toThrow(/INVALID/)
    expect(() => parseAudioDescriptor('{"schema":2,"pipeName":"PhoenixDesktop.Browser.xyz"}')).toThrow(/INVALID/)
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
