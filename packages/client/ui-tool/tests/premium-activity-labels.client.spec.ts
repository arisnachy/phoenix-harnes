import { describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@phoenix-ai/dsh-client-runtime/client'
import { toolRowModel } from '../src/client/tool/models/tool-call-model.ts'

const running = (name: string, argsRaw: string): RunningToolCall => ({
  callId: 'activity-1', name, argsRaw, turn: 1, step: 1, time: 1_000, callView: null, subCalls: [],
})

const settled = (name: string, argsRaw: string, isError = false): ToolResultNode => ({
  kind: 'tool-result', seq: 2, time: 2_000, callId: 'activity-1',
  call: { name, argsRaw }, callTime: 1_000, content: [], isError,
  callView: null, resultView: null, subCalls: [],
})

describe('premium tool activity labels', () => {
  it('projects known runtime tools into human action labels', () => {
    expect(toolRowModel('read', running('read', '{"path":"src/app.ts"}')).title).toBe('Reading')
    expect(toolRowModel('read', settled('read', '{"path":"src/app.ts"}')).title).toBe('Read')
    expect(toolRowModel('edit', running('edit', '{"file_path":"src/app.ts"}')).title).toBe('Editing')
    expect(toolRowModel('edit', settled('edit', '{"file_path":"src/app.ts"}')).title).toBe('Edited')
    expect(toolRowModel('bash', running('bash', '{"description":"tests"}')).title).toBe('Running')
    expect(toolRowModel('bash', settled('bash', '{"description":"tests"}')).title).toBe('Ran')
  })

  it('does not imply success when an activity fails or is interrupted', () => {
    expect(toolRowModel('bash', settled('bash', '{"description":"tests"}', true)).title).toBe('Run')
    expect(toolRowModel('edit', settled('edit', '{"file_path":"src/app.ts"}', true)).title).toBe('Edit')
  })

  it('falls back to the real wire tool name instead of a generic Tool call label', () => {
    const model = toolRowModel('custom_probe', running('custom_probe', '{"target":"runtime"}'))
    expect(model.title).toBe('custom_probe')
    expect(model.summary).toBe('runtime')
  })
})
