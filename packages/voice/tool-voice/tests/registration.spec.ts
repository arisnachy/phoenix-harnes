import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import VoiceRuntime from '@phoenix-ai/dsh-voice'
import * as ToolVoice from '../src/index.ts'

describe('Kira speech tools in a real Cordis registry', () => {
  it('registers both model-discoverable names without opening a microphone or Codex session', async () => {
    const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(VoiceRuntime, { enabled: false, codexRealtime: false })
      await ctx.plugin(ToolVoice)
      const schemas = ctx.tools.schemas()
      expect(schemas.map(schema => schema.name)).toContain('phoenix_voice_status')
      expect(schemas.map(schema => schema.name)).toContain('phoenix_voice_speak')
      expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_status')
      expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_listen')
      expect(schemas.map(schema => schema.name)).toContain('phoenix_senses_status')
      expect(schemas.map(schema => schema.name)).toContain('phoenix_audio_file_listen')
      expect(schemas.find(schema => schema.name === 'phoenix_audio_listen')?.parameters)
        .toMatchObject({type:'object'})
      expect(schemas.find(schema => schema.name === 'phoenix_voice_speak')?.parameters)
        .toMatchObject({ type: 'object' })
  })
})
