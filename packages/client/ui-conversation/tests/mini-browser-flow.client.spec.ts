import { describe, expect, it } from 'vitest'
import { addBrowserCards, isBrowserPrompt } from '../src/client/chat/ToolActivityFlow.tsx'

type BrowserFlowNode = { key: string; kind: string; data: unknown }
const user = (key: string, text: string): BrowserFlowNode => ({
  key, kind: 'user', data: { content: [{ type: 'text', text }] },
})
const assistant = (key: string): BrowserFlowNode => ({
  key, kind: 'assistant-step', data: {},
})
const flowNodes = (...keys: string[]) => keys.map(key => ({ kind: 'node' as const, key }))
const navigation = (key: string, output: string, isError = false, name = 'mcp__chrome_connector__navigate'): BrowserFlowNode => ({
  key, kind: 'tool-call', data: { root: {
    kind: 'tool-result', call: { name }, isError, content: [{ type: 'text', text: output }],
  } },
})

describe('MiniBrowser chronological conversation cards', () => {
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
  })

  it('keeps the older browser between its assistant reply and the next request', () => {
    const nodes = [
      user('user-1', 'Abre YouTube'), assistant('assistant-1'),
      user('user-2', 'Abre Listín Diario'), assistant('assistant-2'),
      user('user-3', 'Muchas gracias'), assistant('assistant-3'),
    ]
    const output = addBrowserCards(flowNodes(...nodes.map(n => n.key)), nodes)
    expect(output.map(item => item.key)).toEqual([
      'user-1', 'assistant-1', 'browser:user-1',
      'user-2', 'assistant-2', 'browser:user-2',
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

  it('opens an in-chat card for real indirect navigation with a verified tab ID', () => {
    const nodes = [
      user('question', 'Investiga el titular más reciente'),
      navigation('cdp', 'Navegación iniciada en https://listindiario.com/ (pestaña CDP1234567890)'),
      assistant('result'),
    ]
    const cards = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    expect(cards.filter(item => item.kind === 'browser')).toEqual([{
      kind: 'browser', key: 'browser:question', userKey: 'question', tabId: 'CDP1234567890',
    }])
  })

  it('keeps the pending card without claiming a tab when the browser tool fails', () => {
    const nodes = [
      user('question', 'Abre Listín Diario'),
      navigation('error', 'Navegación iniciada en https://listindiario.com/ (pestaña UNKNOWN123)', true),
      assistant('reply'),
    ]
    const cards = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    expect(cards.filter(item => item.kind === 'browser')).toEqual([{
      kind: 'browser', key: 'browser:question', userKey: 'question',
    }])
  })

  it('rejects unrelated tools and unverified claims from Kira', () => {
    const nodes = [
      user('question', '¿Qué pasó hoy?'),
      navigation('fake', 'Navegación iniciada en https://example.org (pestaña FAKE123)', false, 'mcp__github__navigate'),
      assistant('claims-loaded'),
    ]
    const cards = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
    expect(cards.filter(item => item.kind === 'browser')).toHaveLength(0)
  })

  it('pins separate navigation receipts to separate user turns', () => {
    const nodes = [
      user('turn-one', 'Abre YouTube'),
      navigation('cdp-one', 'Navegación iniciada en https://youtube.com/ (pestaña FIRST123)'),
      assistant('one'),
      user('turn-two', 'Abre GitHub'),
      navigation('cdp-two', 'Navegación iniciada en https://github.com/ (pestaña SECOND123)'),
      assistant('two'),
    ]
    const cards = addBrowserCards(flowNodes(...nodes.map(node => node.key)), nodes)
      .filter(item => item.kind === 'browser')
    expect(cards).toEqual([
      { kind: 'browser', key: 'browser:turn-one', userKey: 'turn-one', tabId: 'FIRST123' },
      { kind: 'browser', key: 'browser:turn-two', userKey: 'turn-two', tabId: 'SECOND123' },
    ])
  })

  it('reserves a browser card during optimistic message admission', () => {
    const result = addBrowserCards([
      { kind: 'optimistic', key: 'optimistic-user:43', text: 'Abre una página nueva' },
    ], [])
    expect(result.map(item => item.key)).toEqual(['optimistic-user:43', 'browser:optimistic-user:43'])
  })
})
