// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBrowserFormWorkflow } from '../src/form-workflow.ts'

beforeEach(() => {
  document.body.innerHTML = `
    <form id="survey">
      <input id="name" name="name">
      <input id="subject" name="subject">
      <button type="button" class="suggestion">Maths</button>
      <div class="chosen"></div>
      <button type="submit">Send</button>
    </form>
    <div id="receipt"></div>
  `
})
const evaluate = async (expression: string): Promise<unknown> => eval(expression)
const instantPause = async (_milliseconds: number): Promise<void> => {}

describe('one-call form workflow', () => {
  it('fills, selects, verifies a committed chip and submits exactly once', async () => {
    const submit = vi.fn((event: Event) => {
      event.preventDefault()
      document.querySelector('#receipt')!.textContent = 'Submission confirmed. Maths'
    })
    document.querySelector('form')!.addEventListener('submit', submit)
    document.querySelector('.suggestion')!.addEventListener('click', () => {
      document.querySelector('.chosen')!.innerHTML = '<span class="chip">Maths</span>'
    })
    const operation = vi.fn(evaluate)
    const result = await runBrowserFormWorkflow({
      phases: [
        [{ operation: 'fill', name: 'name', value: 'Kira' },
         { operation: 'fill', name: 'subject', value: 'Maths' }],
        [{ operation: 'click', selector: '#survey button.suggestion', text: 'Maths' }],
      ],
      checks: [
        { operation: 'verify', selector: '#name', value: 'Kira' },
        { operation: 'verify', selector: '.chosen .chip', value: 'Maths' },
      ],
      submit: { selector: '#survey', confirmation: true },
      expectedReceiptText: 'Submission confirmed',
    }, operation, instantPause)
    expect(result).toMatchObject({
      ok: true, stage: 'receipt', actionsCompleted: 3,
      checksPassed: 2, submitted: true, receiptConfirmed: true,
    })
    expect(submit).toHaveBeenCalledTimes(1)
    // Two phases, one verification, one submit and one receipt: no model callbacks.
    expect(operation).toHaveBeenCalledTimes(5)
  })
  it('does not submit when an autocomplete is only a typed draft', async () => {
    const submit = vi.fn((event: Event) => { event.preventDefault() })
    document.querySelector('form')!.addEventListener('submit', submit)
    const operation = vi.fn(evaluate)
    const result = await runBrowserFormWorkflow({
      phases: [[{ operation: 'fill', selector: '#subject', value: 'Maths' }]],
      checks: [{ operation: 'verify', selector: '.chosen .chip', value: 'Maths' }],
      submit: { selector: '#survey', confirmation: true },
    }, operation, instantPause)
    expect(result).toMatchObject({
      ok: false, stage: 'verification', actionsCompleted: 1, checksPassed: 0,
      submitted: false, reason: 'TARGET_NOT_FOUND',
    })
    expect(submit).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledTimes(2)
  })
  it('never retries a submission when confirmation text does not match', async () => {
    const submit = vi.fn((event: Event) => {
      event.preventDefault()
      document.querySelector('#receipt')!.textContent = 'We received your request'
    })
    document.querySelector('form')!.addEventListener('submit', submit)
    const result = await runBrowserFormWorkflow({
      phases: [[{ operation: 'fill', selector: '#name', value: 'Demo' }]],
      checks: [{ operation: 'verify', selector: '#name', value: 'Demo' }],
      submit: { selector: '#survey', confirmation: true },
      expectedReceiptText: 'Submitted successfully',
    }, evaluate, instantPause)
    expect(result).toMatchObject({
      ok: false, stage: 'receipt', submitted: true, receiptConfirmed: false,
      reason: 'RECEIPT_TEXT_NOT_FOUND',
    })
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
