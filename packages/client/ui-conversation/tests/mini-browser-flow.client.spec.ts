import { describe, expect, it } from 'vitest'
import { addBrowserCards, groupActiveBrowserFlow, isAtActivityTail, isBrowserPrompt, isEmbeddedNavigationTool, visibleResearchSourceUrl, isSecureAskDismissed, setSecureAskDismissed } from '../src/client/chat/ToolActivityFlow.tsx'

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
    expect(isBrowserPrompt('entra a paint y haz un trazo')).toBe(false)
    expect(isBrowserPrompt('entra en paint y crea una carita')).toBe(false)
    expect(isBrowserPrompt('Abre Microsoft Paint, dibuja una casa y muéstrame Desktop Live')).toBe(false)
    expect(isBrowserPrompt('Abre el Bloc de notas')).toBe(false)
    expect(isBrowserPrompt('Abre la calculadora de Windows')).toBe(false)
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

  it('mirrors a public research fetch as a distinct real Chromium navigation', () => {
    const source = 'https://hai.stanford.edu/ai-index/2025-ai-index-report'
    const nodes = [
      user('research', 'Investiga el estado de la inteligencia artificial'),
      { key: 'fetch', kind: 'tool-call', data: { root: {
        call: { name: 'mcp__fetch__fetch', argsRaw: JSON.stringify({ url: source }) },
      } } },
    ]
    const cards = addBrowserCards(flowNodes('research', 'fetch'), nodes)
    expect(cards.map(item => item.key)).toEqual(['research', 'browser:research', 'fetch'])
    expect(cards[1]).toMatchObject({ sourceUrl: source })
    const live = groupActiveBrowserFlow(cards, 'research', nodes)
    expect(live[1]).toMatchObject({ kind: 'browser-workspace', sourceUrl: source })
  })

  it('follows nested fetch calls but gives genuine Chrome activity priority', () => {
    const source = 'https://pubmed.ncbi.nlm.nih.gov/123456/'
    const nodes: BrowserFlowNode[] = [
      user('research', 'Investiga estudios recientes'),
      { key: 'code', kind: 'tool-call', data: { root: {
        call: { name: 'Code', argsRaw: '{}' },
        subCalls: [{ call: { name: 'web_fetch', argsRaw: JSON.stringify({ url: source }) }, subCalls: [] }],
      } } },
    ]
    expect(addBrowserCards(flowNodes('research', 'code'), nodes)[1]).toMatchObject({ sourceUrl: source })
    nodes.push({ key: 'chrome', kind: 'tool-call', data: { root: {
      call: { name: 'mcp__browser__navigate', argsRaw: JSON.stringify({ url: 'https://example.org' }) },
    } } })
    const active = addBrowserCards(flowNodes('research', 'code', 'chrome'), nodes)
    expect(active[1]?.kind).toBe('browser')
    expect('sourceUrl' in (active[1] ?? {})).toBe(false)
  })

  it('never mirrors private endpoints, untrusted schemes or credentials', () => {
    expect(visibleResearchSourceUrl('https://hai.stanford.edu/page#section')).toBe('https://hai.stanford.edu/page')
    for (const value of [
      'http://example.org/', 'https://127.0.0.1:3000/', 'https://localhost/',
      'https://192.168.1.1/', 'https://intranet.local/', 'https://service.internal/',
      'https://user:pass@example.org/', 'javascript:alert(1)',
      'https://example.org/?token=private',
    ]) {
      expect(visibleResearchSourceUrl(value)).toBeUndefined()
    }
    const nodes = [
      user('research', 'Explica este documento'),
      { key: 'fetch', kind: 'tool-call', data: { root: {
        call: { name: 'mcp__fetch__fetch', argsRaw: '{"url":"http://localhost:3000/"}' },
      } } },
    ]
    expect(addBrowserCards(flowNodes('research', 'fetch'), nodes).map(item => item.key))
      .toEqual(['research', 'fetch'])
  })

  it('does not launch a MiniBrowser for a native Paint request, even when a browser tool was called', () => {
    const nodes = [
      user('user-paint', 'entra a paint y haz un trazo'),
      { key: 'tool-1', kind: 'tool-call', data: { root: { call: { name: 'mcp__browser__navigate' } } } },
    ]
    const cards = addBrowserCards(flowNodes('user-paint', 'tool-1'), nodes)
    expect(cards.map(item => item.key)).toEqual(['user-paint', 'tool-1'])
    const optimistic = addBrowserCards([{ kind: 'optimistic', key: 'optimistic-paint', text: 'abre Paint' }], [])
    expect(optimistic.map(item => item.key)).toEqual(['optimistic-paint'])
  })

  it('refuses MiniBrowser for Paint even after an incidental Chrome inspection', () => {
    const nodes = [
      user('paint', 'entra en paint y crea una carita'),
      { key: 'inspect', kind: 'tool-call', data: { root: { call: { name: 'mcp__chrome__inspect_page' } } } },
    ]
    expect(addBrowserCards(flowNodes('paint', 'inspect'), nodes).map(item => item.key))
      .toEqual(['paint', 'inspect'])
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
