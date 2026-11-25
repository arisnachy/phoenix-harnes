import { describe, expect, it, vi } from 'vitest'
import {
  authorizeWindowsMcpCall,
  windowsMcpPreflight,
} from '../src/windows-permission.ts'
import type { WindowsMcpQuestionService } from '../src/windows-permission.ts'

const agent = { id: 'conversation-1' }
const ALLOW = 'Autorizar una sola acción'
const QUESTION_ID = 'phoenix-windows-mcp-one-action'

function questions(answer: 'allow' | 'deny' | 'automatic' = 'allow') {
  return {
    ask: vi.fn(async (_request: Parameters<WindowsMcpQuestionService['ask']>[0]) => ({
      ...(answer === 'automatic' ? { automatic: true } : {}),
      answers: [{
        id: QUESTION_ID,
        selected: [answer === 'deny' ? 'Cancelar: no ejecutar' : ALLOW],
      }],
    })),
  }
}

describe('FlaUI Windows MCP permission boundary', () => {
  it.each([
    ['windows_batch', { actions: [{ action: 'click', ref: 'w1e1' }] }],
    ['windows_run_command', { command: 'powershell.exe' }],
    ['windows_launch', { app: 'cmd.exe' }],
    ['windows_launch', { app: 'calc.exe', args: '/something' }],
    ['windows_launch', { app: 'C:\\Windows\\System32\\calc.exe' }],
    ['windows_screenshot', { handle: 'w1', savePath: 'C:\\secret.png' }],
    ['windows_screenshot', { handle: 'w1', overwrite: true }],
  ])('denies dangerous or unrecognized %s', (tool, args) => {
    expect(windowsMcpPreflight(tool, args)).not.toBeNull()
  })

  it('permits a small fixed set of apps only, and no launch arguments', () => {
    expect(windowsMcpPreflight('windows_launch', { app: 'calc.exe' })).toBeNull()
    expect(windowsMcpPreflight('windows_launch', { app: 'excel.exe' })).toBeNull()
    expect(windowsMcpPreflight('windows_launch', { app: 'powershell.exe' })).not.toBeNull()
  })

  it('requires a real session and ASK service even to list windows', async () => {
    const ask = questions()
    const args = {}
    await expect(authorizeWindowsMcpCall({ rawName: 'windows_list_windows', args }))
      .resolves.toBe(false)
    await expect(authorizeWindowsMcpCall({ rawName: 'windows_list_windows', args, questions: ask }))
      .resolves.toBe(false)
    expect(ask.ask).not.toHaveBeenCalled()
  })

  it('requires explicit one-time approval; refuses denial and automatic responses', async () => {
    const opts = { rawName: 'windows_click', args: { ref: 'w1e2' }, agent }
    await expect(authorizeWindowsMcpCall({ ...opts, questions: questions('allow') }))
      .resolves.toBe(true)
    await expect(authorizeWindowsMcpCall({ ...opts, questions: questions('deny') }))
      .resolves.toBe(false)
    await expect(authorizeWindowsMcpCall({ ...opts, questions: questions('automatic') }))
      .resolves.toBe(false)
  })

  it('redacts typed text from confirmation details without changing execution args', async () => {
    const ask = questions()
    await expect(authorizeWindowsMcpCall({
      rawName: 'windows_fill',
      args: { ref: 'w1e2', text: 'top-secret-value' },
      agent, questions: ask,
    })).resolves.toBe(true)
    const request = ask.ask.mock.calls[0]?.[0]
    const detail = request?.questions[0]?.detail ?? ''
    expect(detail).toContain('texto oculto')
    expect(detail).not.toContain('top-secret-value')
  })

  it('cancellation, excessive input and unavailable ASK all deny', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(authorizeWindowsMcpCall({
      rawName: 'windows_snapshot', args: {}, agent, questions: questions(), signal: controller.signal,
    })).resolves.toBe(false)
    expect(windowsMcpPreflight('windows_type', { text: 'x'.repeat(2100) }))
      .toBe('WINDOWS_MCP_ARGUMENTS_TOO_LARGE')
    await expect(authorizeWindowsMcpCall({
      rawName: 'windows_snapshot', args: {}, agent,
    })).resolves.toBe(false)
  })

  it('cannot approve an unknown tool even when the question service says yes', async () => {
    const ask = questions()
    await expect(authorizeWindowsMcpCall({
      rawName: 'windows_batch', args: { actions: [] }, agent, questions: ask,
    })).resolves.toBe(false)
    expect(ask.ask).not.toHaveBeenCalled()
  })
})
