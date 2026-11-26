import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import VoiceRuntime from '@phoenix-ai/dsh-voice'
import * as ToolVoice from '../src/index.ts'

describe('Kira speech tools in a real Cordis registry', () => {
  it('keeps normal and proactive speech local unless Codex is explicitly selected', () => {
    expect(ToolVoice.agentSpeechUsesCodex(undefined)).toBe(false)
    expect(ToolVoice.agentSpeechUsesCodex('auto')).toBe(false)
    expect(ToolVoice.agentSpeechUsesCodex('local')).toBe(false)
    expect(ToolVoice.agentSpeechUsesCodex('codex')).toBe(true)
  })
  it('keeps the real conversation identity for native viewer ownership', () => {
    expect(ToolVoice.senseSessionId('thread-4:step_8')).toBe('thread-4:step_8')
    expect(() => ToolVoice.senseSessionId(undefined)).toThrow(/SESSION_NOT_AVAILABLE/)
    expect(() => ToolVoice.senseSessionId('../other')).toThrow(/SESSION_NOT_AVAILABLE/)
  })
  it('registers both model-discoverable names without opening a microphone or Codex session', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(VoiceRuntime, { enabled: false, codexRealtime: false })
    await ctx.plugin(ToolVoice)
    const schemas = ctx.tools.schemas()
    expect(schemas.map(schema => schema.name)).toContain('phoenix_voice_status')
    expect(schemas.map(schema => schema.name)).toContain('phoenix_voice_speak')
    expect(schemas.map(schema => schema.name)).toContain('phoenix_codex_live_control')
    expect(ctx.voice.agentRealtimeControl('session-one', 'open')).toMatchObject({ state: 'failed', reason: 'disabled' })
    expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_status')
    expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_listen')
    expect(schemas.map(schema => schema.name)).toContain('phoenix_senses_status')
    expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_file_listen')
    expect(schemas.find(schema => schema.name === 'phoenix_audio_listen')?.parameters)
      .toMatchObject({ type: 'object' })
    expect(schemas.find(schema => schema.name === 'phoenix_voice_speak')?.parameters)
      .toMatchObject({ type: 'object' })
  })
  it('claims a speaker-only control once and rejects cross-session acknowledgements', async () => {
    const ctx = new Context()
    await ctx.plugin(VoiceRuntime, { enabled: true, codexRealtime: true })
    expect(ctx.voice.agentRealtimeControl('session-one', 'open')).toMatchObject({ state: 'failed', reason: 'no-foreground-client' })
    expect(ctx.voice.conversationAgentRealtimePoll('session-one')).toBeNull()
    const result = ctx.voice.agentRealtimeControl('session-one', 'speak', 'Hola')
    expect(result.state).toBe('queued')
    expect(ctx.voice.conversationAgentRealtimePoll('session-two')).toBeNull()
    const command = ctx.voice.conversationAgentRealtimePoll('session-one')
    expect(command).toMatchObject({ id: result.id, action: 'speak', text: 'Hola', gender: 'feminine' })
    expect(ctx.voice.conversationAgentRealtimePoll('session-one')).toBeNull()
    expect(ctx.voice.conversationAgentRealtimeComplete({ key: 'session-two', id: command!.id, accepted: true })).toBe(false)
    expect(ctx.voice.conversationAgentRealtimeComplete({ key: 'session-one', id: command!.id, accepted: true })).toBe(true)
    expect(ctx.voice.agentRealtimeControlStatus('session-one')).toMatchObject({ state: 'completed' })
  })
})
