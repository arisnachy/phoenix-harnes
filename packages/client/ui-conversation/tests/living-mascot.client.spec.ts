import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mascotPose } from '../src/client/chat/LivingMascot.tsx'
import type { TurnActivity, TurnProgress } from '../src/client/chat/turn-progress.ts'

describe('PHOENIX Living Mascot', () => {
  it('maps the real activity projection to stable poses', () => {
    const expected = {
      preparing: 'ready', thinking: 'thinking', searching: 'search',
      browsing: 'browse', reading: 'read', writing: 'code',
      executing: 'code', 'generating-image': 'paint',
      'running-tools': 'tools', verifying: 'verify',
    } as const
    for (const [activity, pose] of Object.entries(expected)) {
      expect(mascotPose({ phase: 'running-tools', activity: activity as TurnActivity })).toBe(pose)
    }
  })

  it('uses explicit tool identity for specialized accessories, not guesses', () => {
    const progress: TurnProgress = { phase: 'running-tools', activity: 'running-tools' }
    expect(mascotPose({ ...progress, detail: 'mcp__calculator__calculate' })).toBe('calculate')
    expect(mascotPose({ ...progress, detail: 'mcp__audio__transcribe' })).toBe('listen')
    expect(mascotPose({ ...progress, detail: 'mcp__audio__text_to_speech' })).toBe('talk')
    expect(mascotPose({ ...progress, detail: 'todo_write' })).toBe('plan')
    expect(mascotPose({ ...progress, detail: 'unknown_tool' })).toBe('tools')
    expect(mascotPose({ phase: 'thinking', activity: 'thinking', detail: 'calculator' })).toBe('thinking')
  })

  it('uses the mascot in the real shared status and image card without an animated logo', () => {
    const flow = readFileSync(new URL('../src/client/chat/ToolActivityFlow.tsx', import.meta.url), 'utf8')
    expect(flow).toContain('<LivingMascot pose={mascotPose(progress)} />')
    expect(flow).toContain('<LivingMascot pose="paint" large />')
    expect(flow).not.toContain('<PhoenixLogo')
    const css = readFileSync(new URL('../src/client/chat/ChatView.module.css', import.meta.url), 'utf8')
    expect(css).toContain(".livingStatus[data-centered='true']")
    expect(css).toContain('.livingMascot, .livingMascot * { animation: none !important; }')
  })
})
