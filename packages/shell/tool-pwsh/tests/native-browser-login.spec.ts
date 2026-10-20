import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'

const source = readFileSync(new URL('../../../../apps/desktop-windows/PhoenixDesktopWindow.cs', import.meta.url), 'utf8')
const script = source.match(/private const string BrowserLoginScript = """\r?\n([\s\S]*?)\r?\n\s*""";/)?.[1]
if (!script) throw new Error('Native login script missing')

function run(html: string, extras: Record<string, string> = {}, origin = 'https://example.com') {
  const dom = new JSDOM(html, { url: 'https://example.com/login', runScripts: 'outside-only' })
  const { window } = dom
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 } as DOMRect)
  let submissions = 0
  window.HTMLFormElement.prototype.requestSubmit = function () { submissions++ }
  window.HTMLFormElement.prototype.submit = function () { submissions++ }
  const raw: unknown = window.eval(script!
    .replace('__ORIGIN__', JSON.stringify(origin))
    .replace('__ACCOUNT__', JSON.stringify('synthetic-user'))
    .replace('__SECRET__', JSON.stringify('synthetic-password'))
    .replace('__EXTRAS__', JSON.stringify(extras))
    .replace('__SUBMIT__', 'true'))
  if (typeof raw !== 'string') throw new Error('Native login script returned a non-string result')
  const result = JSON.parse(raw) as { phase: string; submitted: boolean }
  return { dom, result, submissions }
}

describe('native browser uses site-specific saved login fields', () => {
  const page = '<input name="search" required><form><input name="usuario"><input type="password"><input name="tenant" required><button type="submit">Ingresar</button></form>'
  it('fills only the selected login form and its saved required extras', () => {
    const { dom, result, submissions } = run(page, { 'extra:0': 'demo-tenant' })
    try {
      const inputs = [...dom.window.document.querySelectorAll('input')]
      expect(inputs.map(input => input.value)).toEqual(['', 'synthetic-user', 'synthetic-password', 'demo-tenant'])
      expect(submissions).toBe(1)
      expect(result.submitted).toBe(true)
      expect(JSON.stringify(result)).not.toMatch(/synthetic|demo-tenant/)
    } finally { dom.window.close() }
  })
  it('does not submit a login with a missing site-required extra field', () => {
    const { dom, result, submissions } = run(page)
    try {
      expect(submissions).toBe(0)
      expect(result).toMatchObject({ phase: 'additional-login-field-required', submitted: false })
    } finally { dom.window.close() }
  })
  it('does not confuse a search box with an account on a password-free step', () => {
    const { dom, result, submissions } = run('<input name="search"><form><input name="playerId"></form>')
    try {
      expect(submissions).toBe(0)
      expect(result.phase).toBe('ambiguous-login-form')
      expect([...dom.window.document.querySelectorAll('input')].map(input => input.value)).toEqual(['', ''])
    } finally { dom.window.close() }
  })
  it('rejects a cross-origin form action before entering credentials', () => {
    const { dom, result, submissions } = run('<form action="https://other.example/login"><input name="user"><input type="password"></form>')
    try {
      expect(submissions).toBe(0)
      expect(result.submitted).toBe(false)
      expect([...dom.window.document.querySelectorAll('input')].map(input => input.value)).toEqual(['', ''])
    } finally { dom.window.close() }
  })
  it('supports separate account and password steps without copying values into unrelated fields', () => {
    for (const [html, expectedValue, phase] of [
      ['<form><input name="email" type="email"></form>', 'synthetic-user', 'account-submitted'],
      ['<form><input type="password"></form>', 'synthetic-password', 'credentials-submitted'],
    ]) {
      const { dom, result, submissions } = run(html!)
      try {
        expect(dom.window.document.querySelector('input')?.value).toBe(expectedValue)
        expect(submissions).toBe(1)
        expect(result.phase).toBe(phase)
      } finally { dom.window.close() }
    }
  })
})
