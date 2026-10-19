import { describe, expect, it } from 'vitest'
import { addBrowserCards, groupActiveBrowserFlow, isAtActivityTail, isBrowserPrompt, isEmbeddedNavigationTool, isSecureAskDismissed, setSecureAskDismissed } from '../src/client/chat/ToolActivityFlow.tsx'

type BrowserFlowNode = { key: string; kind: string; data: unknown }
const user = (key: string, text: string): BrowserFlowNode => ({
  key, kind: 'user', data: { content: [{ type: 'text', text }] },
})
const assistant = (key: string): BrowserFlowNode => ({
  key, kind: 'assistant-step', data: {},
})
const flowNodes = (...keys: string[]) => keys.map(key => ({ kind: 'node' as const, key }))

describe('MiniBrowser chronological conversation cards', () => {
  it('follows fresh streamed activity until the reader scrolls more than 48px away', () => {
    expect(isAtActivityTail(0, 0, 500)).toBe(true)
    expect(isAtActivityTail(900, 1400, 500)).toBe(true)
    expect(isAtActivityTail(851, 1400, 500)).toBe(false)
    expect(isAtActivityTail(852, 1400, 500)).toBe(true)
    expect(isAtActivityTail(120, 400, 200)).toBe(false)
  })

  it('recognizes real navigation prompts but not ordinary conversation', () => {
    expect(isBrowserPrompt('Abre Listín Diario en el navegador')).toBe(true)
    expect(isBrowserPrompt('Por favor, navega a youtube.com')).toBe(true)
    expect(isBrowserPrompt('puedes entras a la pagina listindiario')).toBe(true)
    expect(isBrowserPrompt('¿Puedes entrar a la página de Listín Diario?')).toBe(true)
    expect(isBrowserPrompt('puedes ingresar al sitio listindiario.com')).toBe(true)
    expect(isBrowserPrompt('Abre YouTube')).toBe(true)
    expect(isBrowserPrompt('Abre la carpeta del proyecto')).toBe(false)
    expect(isBrowserPrompt('No abras el navegador')).toBe(false)
    expect(isBrowserPrompt('Hola, ¿cómo va todo?')).toBe(false)
    expect(isBrowserPrompt('Analiza este tutorial de Godot en YouTube')).toBe(true)
  })

  it('exposes actual Chromium navigation even when the user requested research rather than opening a browser', () => {
    expect(isEmbeddedNavigationTool('mcp__browser__navigate')).toBe(true)
    expect(isEmbeddedNavigationTool('mcp__chrome__youtube_video_inspect')).toBe(true)
    expect(isEmbeddedNavigationTool('mcp__browser__youtube_search')).toBe(true)
    expect(isEmbeddedNavigationTool('web_search')).toBe(false)
    expect(isEmbeddedNavigationTool('mcp__browser__read_page')).toBe(true)
    const nodes = [
      user('user-1', 'Investiga las técnicas usadas por este autor'),
      { key: 'tool-1', kind: 'tool-call', data: { root: { call: { name: 'mcp__browser__navigate' } } } },
    ]
    const output = addBrowserCards(flowNodes('user-1', 'tool-1'), nodes)
    expect(output.map(item => item.key)).toEqual(['user-1', 'browser:user-1', 'tool-1'])
  })

  it('opens the browser for nested Chrome calls emitted by a Code parent', () => {
    const nodes = [
      user('user-1', 'Investiga las técnicas usadas por este autor'),
      {
        key: 'tool-1',
        kind: 'tool-call',
        data: {
          root: {
            call: { name: 'Code' },
            subCalls: [
              { name: 'mcp__chrome__read_page', subCalls: [] },
              { name: 'mcp__chrome__screenshot', subCalls: [] },
            ],
          },
        },
      },
    ]
    const output = addBrowserCards(flowNodes('user-1', 'tool-1'), nodes)
    expect(output.map(item => item.key)).toEqual(['user-1', 'browser:user-1', 'tool-1'])
  })

  it('uses the latest explicit tab from nested Chrome calls for the preview', () => {
    const nodes = [
      user('user-1', 'Completa el formulario en Chrome'),
      {
        key: 'tool-1',
        kind: 'tool-call',
        data: {
          root: {
            call: { name: 'Code', argsRaw: '{}' },
            subCalls: [
              { call: { name: 'mcp__chrome__read_page', argsRaw: '{"tabId":"first-tab"}' }, subCalls: [] },
              { call: { name: 'mcp__chrome__complete_form', argsRaw: '{"tabId":"latest-tab"}' }, subCalls: [] },
            ],
          },
        },
      },
    ]
    const output = addBrowserCards(flowNodes('user-1', 'tool-1'), nodes)
    const browser = output.find(item => item.kind === 'browser')
    expect(browser).toMatchObject({ tabId: 'latest-tab' })
  })

  it('keeps the older browser immediately after its request and its answer below', () => {
    const nodes = [
      user('user-1', 'Abre YouTube'), assistant('assistant-1'),
      user('user-2', 'Abre Listín Diario'), assistant('assistant-2'),
      user('user-3', 'Muchas gracias'), assistant('assistant-3'),
    ]
    const output = addBrowserCards(flowNodes(...nodes.map(n => n.key)), nodes)
    expect(output.map(item => item.key)).toEqual([
      'user-1', 'browser:user-1', 'assistant-1',
      'user-2', 'browser:user-2', 'assistant-2',
      'user-3', 'assistant-3',
    ])
    expect(output.filter(item => item.kind === 'browser')).toHaveLength(2)
  })

  it('a fresh request produces a distinct keyed card even after the prior card is closed', () => {
    const nodes = [user('one', 'Abre youtube.com'), assistant('response-one'), user('two', 'Abre ejemplo.com')]
    const result = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    expect(result.filter(item => item.kind === 'browser').map(item => item.key))
      .toEqual(['browser:one', 'browser:two'])
  })

  it('reserves a browser card during optimistic message admission', () => {
    const result = addBrowserCards([
      { kind: 'optimistic', key: 'optimistic-user:43', text: 'Abre una página nueva' },
    ], [])
    expect(result.map(item => item.key)).toEqual(['optimistic-user:43', 'browser:optimistic-user:43'])
  })

  it('puts real running messages beside the newest browser without cloning them', () => {
    const nodes = [user('user-1', 'Abre Listín Diario'), assistant('assistant-1')]
    const ordered = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    const active = groupActiveBrowserFlow(ordered, 'user-1', nodes)
    expect(active.map(item => item.kind)).toEqual(['node', 'browser-workspace'])
    const workspace = active[1]
    expect(workspace?.kind === 'browser-workspace' ? workspace.items.map(item => item.key) : [])
      .toEqual(['assistant-1'])
    expect(ordered.map(item => item.key)).toEqual(['user-1', 'browser:user-1', 'assistant-1'])
  })

  it('never relights a previous browser for a later unrelated user turn', () => {
    const nodes = [user('user-1', 'Abre Listín Diario'), assistant('assistant-1'),
      user('user-2', 'Gracias'), assistant('assistant-2')]
    const ordered = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    expect(groupActiveBrowserFlow(ordered, 'user-1', nodes)).toEqual(ordered)
  })
})
describe('Secure Ask dismissal persists per conversation and website', () => {
  it('suppresses automatic prompts until the user explicitly reopens them', () => {
    const session = 'secure-dismiss-' + String(Date.now())
    const origin = 'https://example.org'
    expect(isSecureAskDismissed(session, origin)).toBe(false)
    setSecureAskDismissed(session, origin, true)
    expect(isSecureAskDismissed(session, origin)).toBe(true)
    expect(isSecureAskDismissed(session, 'https://other.example')).toBe(false)
    expect(isSecureAskDismissed(session + '-other', origin)).toBe(false)
    setSecureAskDismissed(session, origin, false)
    expect(isSecureAskDismissed(session, origin)).toBe(false)
  })
})
