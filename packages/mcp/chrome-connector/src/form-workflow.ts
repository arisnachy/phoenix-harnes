/**
 * Single model-tool round-trip for phased form filling, verified selections
 * and (when explicitly authorized) one submission with a bounded DOM receipt.
 */
import { browserBatchExpression, browserInteractionExpression, type BrowserInteraction } from './browser-interactions.ts'

type BatchResult = { ok: boolean; completed: number; results: Array<{ reason?: string }> }
type FormPage = { title: string; url: string; text: string }

/** Authorised phases, mandatory checks and optional one-time submission. */
export interface BrowserFormWorkflow {
  phases: BrowserInteraction[][]
  checks: BrowserInteraction[]
  submit?: { selector: string; confirmation: true }
  expectedReceiptText?: string
}

/** Minimal bounded outcome, without leaking input values back to the model. */
export interface BrowserFormWorkflowResult {
  ok: boolean
  stage: 'actions' | 'verification' | 'verified' | 'submission' | 'receipt'
  actionsCompleted: number
  checksPassed: number
  submitted: boolean
  receiptConfirmed: boolean
  reason?: string
  phase?: number
  page?: FormPage
  durationMs: number
}

/**
 * Executes typed browser stages in the already-authorized Chromium tab.
 * @param workflow - Bounded actions, checks and optional authorised submit.
 * @param evaluate - Existing per-tab CDP Runtime.evaluate client.
 * @param pause - Event-loop settling between reactive form phases.
 * @returns One compact result without repeating a failed action or submit.
 */
export async function runBrowserFormWorkflow(
  workflow: BrowserFormWorkflow,
  evaluate: (expression: string) => Promise<unknown>,
  pause: (milliseconds: number) => Promise<void> = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
): Promise<BrowserFormWorkflowResult> {
  const start = Date.now()
  let actionsCompleted = 0
  let checksPassed = 0
  let submitted = false
  const result = (stage: BrowserFormWorkflowResult['stage'], ok: boolean, reason?: string) => ({
    ok, stage, actionsCompleted, checksPassed, submitted,
    receiptConfirmed: false, ...(reason ? { reason } : {}), durationMs: Date.now() - start,
  })

  for (const [index, phase] of workflow.phases.entries()) {
    const response = await evaluate(browserBatchExpression(phase)) as BatchResult
    actionsCompleted += response.completed
    if (!response.ok) return {
      ...result('actions', false, response.results[response.completed]?.reason ?? 'DOM_ACTION_FAILED'),
      phase: index + 1,
    }
    // Give React and similar form libraries a render turn before querying new suggestions.
    await pause(100)
  }
  const verification = await evaluate(browserBatchExpression(workflow.checks)) as BatchResult
  checksPassed = verification.completed
  if (!verification.ok) {
    return result('verification', false,
      verification.results[verification.completed]?.reason ?? 'FORM_VERIFICATION_FAILED')
  }
  if (!workflow.submit) return result('verified', true)

  // One attempt only. A failed receipt can NEVER cause a second submission.
  const attempted = await evaluate(browserInteractionExpression({
    operation: 'submit', selector: workflow.submit.selector,
  })) as { ok: boolean; submitted?: boolean; reason?: string }
  if (!attempted.ok || !attempted.submitted) {
    return result('submission', false, attempted.reason ?? 'FORM_SUBMISSION_FAILED')
  }
  submitted = true
  await pause(200)
  let page: FormPage | undefined
  try {
    for (let i = 0; i < (workflow.expectedReceiptText ? 4 : 1); i++) {
      page = await evaluate('(() => ({ title: document.title, url: location.href, text: String(document.body?.innerText || document.body?.textContent || "").slice(-3000) }))()') as FormPage
      if (!workflow.expectedReceiptText || page.text.toLocaleLowerCase().includes(workflow.expectedReceiptText.toLocaleLowerCase())) break
      await pause(250)
    }
  } catch {
    // Navigation can destroy the old execution context. Do not submit again.
    return result('receipt', false, 'RECEIPT_CONTEXT_UNAVAILABLE_AFTER_SUBMIT')
  }
  const receiptConfirmed = workflow.expectedReceiptText !== undefined
    && Boolean(page?.text.toLocaleLowerCase().includes(workflow.expectedReceiptText.toLocaleLowerCase()))
  const final = result('receipt', true)
  return {
    ...final, ...(page ? { page } : {}), receiptConfirmed,
    ...((workflow.expectedReceiptText && !receiptConfirmed) ? { reason: 'RECEIPT_TEXT_NOT_FOUND' } : {}),
  }
}
