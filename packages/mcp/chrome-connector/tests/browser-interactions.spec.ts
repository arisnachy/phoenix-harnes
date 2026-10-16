// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeBrowserInteraction, browserBatchExpression, browserInteractionExpression } from '../src/browser-interactions.ts'

beforeEach(() => {
  document.body.innerHTML = `
    <form id="web-form" action="/selenium/web/submitted-form.html">
      <label>Text input <input name="my-text" type="text" required></label>
      <label>Password <input name="my-password" type="password"></label>
      <label>Textarea <textarea name="my-textarea"></textarea></label>
      <label>Disabled input <input name="my-disabled" disabled value="locked"></label>
      <label>Readonly input <input name="my-readonly" readonly value="fixed"></label>
      <label>Dropdown (select) <select name="my-select">
        <option value="1">One</option><option value="2">Two</option></select></label>
      <label>Checked checkbox <input name="my-check" type="checkbox" checked></label>
      <label>Default radio <input name="my-radio" type="radio"></label>
      <label>Date picker <input name="my-date" type="date"></label>
      <label>File input <input name="my-file" type="file"></label>
      <input name="secret" type="hidden" value="do-not-touch">
      <button type="submit">Submit</button>
    </form>
    <p id="success" hidden>Received!</p>
  `
})

describe('Kira browser structured controls', () => {
  it('inspects visible fields and flags readonly/disabled without exposing passwords', () => {
    const value = executeBrowserInteraction({ operation: 'inspect' })
    expect(value.ok).toBe(true)
    const controls = JSON.stringify(value.controls)
    expect(controls).toContain('my-text')
    expect(controls).toContain('my-readonly')
    expect(controls).not.toContain('do-not-touch')
    expect(value.forms?.length).toBe(1)
  })
  it('fills text, fictitious password, textarea, selects, checks and dates with observable events', () => {
    const notified: string[] = []
    document.querySelector('[name="my-text"]')?.addEventListener('input', () => { notified.push('input') })
    const values = [
      { operation: 'fill', name: 'my-text', value: 'Phoenix' },
      { operation: 'fill', name: 'my-password', value: 'fake-test-only' },
      { operation: 'fill', name: 'my-textarea', value: 'Example message' },
      { operation: 'select', name: 'my-select', value: 'Two' },
      { operation: 'check', name: 'my-check', checked: false },
      { operation: 'check', name: 'my-radio', checked: true },
      { operation: 'fill', name: 'my-date', value: '2026-10-09' },
    ] as const
    for (const value of values) {
      expect(executeBrowserInteraction(value).ok, value.name).toBe(true)
    }
    expect(notified).toContain('input')
    expect((document.querySelector('[name="my-text"]') as HTMLInputElement).value).toBe('Phoenix')
    expect((document.querySelector('[name="my-select"]') as HTMLSelectElement).value).toBe('2')
    expect((document.querySelector('[name="my-check"]') as HTMLInputElement).checked).toBe(false)
    expect((document.querySelector('[name="my-radio"]') as HTMLInputElement).checked).toBe(true)
    expect((document.querySelector('[name="my-date"]') as HTMLInputElement).value).toBe('2026-10-09')
  })
  it('rejects disabled, readonly, hidden, file and ambiguous targets without touching values', () => {
    for (const name of ['my-disabled','my-readonly','secret','my-file']) {
      expect(executeBrowserInteraction({ operation: 'fill', name, value: 'injected' }).ok).toBe(false)
    }
    expect((document.querySelector('[name="my-readonly"]') as HTMLInputElement).value).toBe('fixed')
    expect((document.querySelector('[name="my-disabled"]') as HTMLInputElement).value).toBe('locked')
    expect((document.querySelector('[name="secret"]') as HTMLInputElement).value).toBe('do-not-touch')
    expect(executeBrowserInteraction({ operation: 'fill', selector: 'input', value: 'oops' }).reason).toBe('TARGET_AMBIGUOUS')
  })
  it('requires a unique form selector and provides a verifiable wait result', () => {
    const button = document.querySelector('button') as HTMLButtonElement
    button.addEventListener('click', event => { event.preventDefault(); document.querySelector('#success')?.removeAttribute('hidden') })
    expect(executeBrowserInteraction({ operation: 'click', selector: 'button[type="submit"]' }).reason)
      .toBe('USE_EXPLICIT_SUBMIT_FORM_CONFIRMATION')
    expect(executeBrowserInteraction({ operation: 'submit', selector: 'button[type="submit"]' }).ok).toBe(true)
    expect(executeBrowserInteraction({ operation: 'wait', expectedText: 'Received!' }).ok).toBe(true)
    expect(executeBrowserInteraction({ operation: 'wait', expectedText: 'Absent answer' }).ok).toBe(false)
  })
  it('executes a single DOM-snapshot batch and verifies the whole form without screenshots', () => {
    const batch = [
      { operation: 'fill', name: 'my-text', value: 'Kira' },
      { operation: 'fill', name: 'my-textarea', value: 'Encuesta aprobada' },
      { operation: 'select', name: 'my-select', value: 'Two' },
      { operation: 'check', name: 'my-check', checked: false },
    ] as const
    const traversal = vi.spyOn(document, 'querySelectorAll')
    const written = eval(browserBatchExpression([...batch]))
    expect(written).toMatchObject({ ok: true, completed: 4 })
    expect(traversal.mock.calls.filter(([selector]) => selector === '*')).toHaveLength(1)
    traversal.mockRestore()
    const verification = eval(browserBatchExpression([
      { operation: 'verify', name: 'my-text', value: 'Kira' },
      { operation: 'verify', name: 'my-textarea', value: 'Encuesta aprobada' },
      { operation: 'verify', name: 'my-select', value: 'Two' },
      { operation: 'verify', name: 'my-check', checked: false },
    ]))
    expect(verification).toMatchObject({ ok: true, completed: 4 })
    ;(document.querySelector('[name="my-text"]') as HTMLInputElement).value = 'Changed by page'
    const changed = eval(browserBatchExpression([
      { operation: 'verify', name: 'my-text', value: 'Kira' },
    ]))
    expect(changed).toMatchObject({ ok: false, completed: 0, results: [{ reason: 'VALUE_MISMATCH' }] })
    expect((document.querySelector('[name="my-text"]') as HTMLInputElement).value).toBe('Changed by page')
  })
  it('refreshes the shared snapshot if a dynamic form replaces or reveals the next control', () => {
    const extra = document.createElement('input')
    extra.name = 'dynamic-answer'
    const original = document.querySelector('[name="my-text"]') as HTMLInputElement
    original.addEventListener('input', () => {
      original.replaceWith(extra)
    }, { once: true })
    const result = eval(browserBatchExpression([
      { operation: 'fill', name: 'my-text', value: 'step one' },
      { operation: 'fill', name: 'dynamic-answer', value: 'step two' },
    ]))
    expect(result).toMatchObject({ ok: true, completed: 2 })
    expect(extra.value).toBe('step two')
  })
  it('narrows CSS options by exact text and checks committed autocomplete tags rather than draft input', () => {
    document.body.insertAdjacentHTML('beforeend', `
      <section id="subjects">
        <input id="subjectsInput" value="Maths">
        <button type="button" id="suggestion">Maths</button>
        <button type="button">Physics</button>
        <div class="chosen"><span class="chip">No subject</span></div>
      </section>
    `)
    const subject = document.querySelector('#subjects') as HTMLElement
    subject.querySelector('#suggestion')?.addEventListener('click', () => {
      const chip = subject.querySelector('.chip')
      if (chip) chip.textContent = 'Maths'
    })
    expect(executeBrowserInteraction({ operation: 'verify', selector: '#subjectsInput', value: 'Maths' }).ok).toBe(true)
    expect(executeBrowserInteraction({ operation: 'verify', selector: '#subjects .chip', value: 'Maths' }))
      .toMatchObject({ ok: false, reason: 'VALUE_MISMATCH' })
    expect(executeBrowserInteraction({ operation: 'click', selector: '#subjects button', text: 'Maths' }))
      .toMatchObject({ ok: true, matched: 1 })
    expect(executeBrowserInteraction({ operation: 'verify', selector: '#subjects .chip', value: 'Maths' }).ok).toBe(true)
    expect(executeBrowserInteraction({ operation: 'click', selector: '#subjects button', text: 'Math' }))
      .toMatchObject({ ok: false, reason: 'TARGET_NOT_FOUND' })
  })
  it('never reveals protected or password values through the verifier', () => {
    expect(executeBrowserInteraction({ operation: 'verify', name: 'my-password', value: 'fake-test-only' }))
      .toMatchObject({ ok: false, reason: 'SENSITIVE_FIELD_VERIFICATION_UNAVAILABLE' })
    expect(executeBrowserInteraction({ operation: 'verify', name: 'secret', value: 'do-not-touch' }))
      .toMatchObject({ ok: false, reason: 'HIDDEN_FIELD_PROTECTED' })
    expect(executeBrowserInteraction({ operation: 'verify', name: 'my-disabled', value: 'locked' }))
      .toMatchObject({ ok: false, reason: 'FIELD_PROTECTED' })
  })
  it('only serializes bounded declared operations, never free-form model JS', () => {
    expect(browserInteractionExpression({ operation: 'fill', name: 'my-text', value: 'x' })).toContain('executeBrowserInteraction')
    expect(browserBatchExpression([{ operation: 'fill', name: 'my-text', value: 'x' }])).toContain('results')
    expect(() => browserBatchExpression([])).toThrow()
    expect(() => browserBatchExpression(Array.from({ length: 31 }, () => ({ operation: 'scroll', selector: '#web-form' })))).toThrow()
  })
})
