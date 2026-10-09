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

  it('reserves a browser card during optimistic message admission', () => {
    const result = addBrowserCards([
      { kind: 'optimistic', key: 'optimistic-user:43', text: 'Abre una página nueva' },
    ], [])
    expect(result.map(item => item.key)).toEqual(['optimistic-user:43', 'browser:optimistic-user:43'])
  })
})
