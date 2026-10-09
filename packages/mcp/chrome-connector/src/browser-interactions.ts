/**
 * Bounded, permission-gated browser DOM operations for Phoenix Kira agents.
 *
 * Only these fixed operations may execute in the inspected tab. No model
 * supplied JavaScript, no private browser storage, password extraction,
 * protected/hidden field writes, file input bypass, or cross-origin iframe
 * spoofing. The same controller works with headless Chromium in the chat.
 */
export type BrowserTarget = {
  selector?: string
  name?: string
  label?: string
  placeholder?: string
  text?: string
}
export type BrowserInteraction = BrowserTarget & {
  operation: 'inspect' | 'fill' | 'select' | 'check' | 'click' | 'submit' | 'scroll' | 'wait'
  value?: string
  checked?: boolean
  expectedText?: string
}
export type BrowserInteractionResult = {
  ok: boolean
  reason?: string | undefined
  title?: string
  url?: string
  controls?: unknown[]
  forms?: unknown[]
  frames?: unknown[]
  matched?: number
  tag?: string
  type?: string
  disabled?: boolean
  readOnly?: boolean
  protected?: boolean
  submitted?: boolean
  foundText?: boolean
}

/**
 * This function is serialized to a CDP Runtime.evaluate expression. It must
 * not reference any module variables; everything it uses is browser DOM.
 * Keep results bounded and never return sensitive field values.
 */
export function executeBrowserInteraction(input: BrowserInteraction): BrowserInteractionResult {
  const doc = document
  const win = window
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 250)
  const lower = (value: string) => clean(value).toLocaleLowerCase()
  const children = (root: Document | Element | ShadowRoot): Element[] => {
    const found: Element[] = []
    const visit = (scope: Document | Element | ShadowRoot, depth: number): void => {
      if (depth > 4 || found.length > 1500) return
      for (const el of Array.from(scope.querySelectorAll('*'))) {
        if (found.length > 1500) return
        found.push(el)
        if (el.shadowRoot) visit(el.shadowRoot, depth + 1)
      }
    }
    visit(root, 0)
    return found
  }
  const elements = children(doc)
  const candidate = (el: Element) => el.matches('input,textarea,select,button,a[href],[role="button"],[role="checkbox"],[role="radio"],[contenteditable="true"]')
  const candidates = elements.filter(candidate)
  const fieldLabel = (el: Element): string => {
    const value = el as HTMLInputElement
    const fromLabels = value.labels === undefined || value.labels === null ? '' : Array.from(value.labels)
      .map(label => clean(label.textContent)).join(' ')
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => clean(doc.getElementById(id)?.textContent)).join(' ').trim()
    return clean(el.getAttribute('aria-label') || fromLabels || labelledBy
      || el.closest('label')?.textContent || '')
  }
  const visible = (el: Element): boolean => {
    const node = el as HTMLElement
    const css = win.getComputedStyle(node)
    return css.display !== 'none' && css.visibility !== 'hidden' && !el.closest('[hidden], [inert], [aria-hidden="true"]')
  }
  const protectedField = (el: Element): boolean => {
    const node = el as HTMLInputElement
    return Boolean(node.disabled || node.readOnly || el.hasAttribute('readonly')
      || el.getAttribute('aria-readonly') === 'true' || el.getAttribute('aria-disabled') === 'true')
  }
  const describe = (el: Element) => {
    const node = el as HTMLInputElement
    const type = clean(node.type || el.getAttribute('role') || el.tagName.toLowerCase())
    const options = el instanceof HTMLSelectElement
      ? Array.from(el.options).slice(0, 40).map(o => ({ text: clean(o.textContent), value: o.value }))
      : undefined
    return {
      tag: el.tagName.toLowerCase(), type, name: el.getAttribute('name') || '',
      id: el.id || '', label: fieldLabel(el), placeholder: el.getAttribute('placeholder') || '',
      text: clean(el.tagName === 'BUTTON' || el.tagName === 'A' ? el.textContent : ''),
      required: node.required === true, disabled: protectedField(el),
      readonly: Boolean(node.readOnly || el.hasAttribute('readonly')),
      checked: node.checked === true, visible: visible(el),
      ...(options === undefined ? {} : { options }),
    }
  }
  const basic = { title: clean(doc.title), url: win.location.href }
  const frames = elements.filter(el => el.tagName.toLowerCase() === 'iframe')
    .slice(0, 25).map(el => ({ title: el.getAttribute('title') || '', src: el.getAttribute('src') || '',
      accessible: (() => { try { return Boolean((el as HTMLIFrameElement).contentDocument) } catch { return false } })() }))
  if (input.operation === 'inspect') {
    const forms = Array.from(doc.forms).slice(0, 30).map(form => ({
      id: form.id, name: form.getAttribute('name') || '',
      method: (form.method || 'get').toLowerCase(), action: form.action,
      fields: Array.from(form.elements).slice(0, 90).filter(el => el instanceof Element).map(el => describe(el as Element)),
    }))
    return { ...basic, ok: true, controls: candidates.filter(visible).slice(0, 100).map(describe), forms, frames }
  }
  if (input.operation === 'wait') {
    const expected = lower(input.expectedText || '')
    if (!expected) return { ...basic, ok: false, reason: 'EXPECTED_TEXT_REQUIRED' }
    const foundText = lower(doc.body?.innerText || doc.body?.textContent || '').includes(expected)
    return { ...basic, ok: foundText, foundText, reason: foundText ? undefined : 'TEXT_NOT_YET_VISIBLE' }
  }
  let matches: Element[]
  if (input.selector) {
    try { matches = elements.filter(el => el.matches(input.selector || '')) }
    catch { return { ...basic, ok: false, reason: 'INVALID_SELECTOR' } }
  } else {
    matches = candidates.filter(el => {
      if (input.name && lower(el.getAttribute('name')) !== lower(input.name)) return false
      if (input.label && lower(fieldLabel(el)) !== lower(input.label)) return false
      if (input.placeholder && lower(el.getAttribute('placeholder')) !== lower(input.placeholder)) return false
      if (input.text && lower(el.textContent || (el as HTMLInputElement).value) !== lower(input.text)) return false
      return Boolean(input.name || input.label || input.placeholder || input.text)
    })
  }
  matches = matches.filter(visible)
  if (matches.length !== 1) {
    return { ...basic, ok: false, matched: matches.length,
      reason: matches.length === 0 ? 'TARGET_NOT_FOUND' : 'TARGET_AMBIGUOUS' }
  }
  const el = matches[0]
  if (!el) return { ...basic, ok: false, reason: 'TARGET_NOT_FOUND' }
  const node = el as HTMLInputElement
  const kind = (node.type || '').toLowerCase()
  const common = { ...basic, matched: 1, tag: el.tagName.toLowerCase(), type: kind }
  if (protectedField(el)) return { ...common, ok: false, disabled: Boolean(node.disabled),
    readOnly: Boolean(node.readOnly), protected: true, reason: 'FIELD_PROTECTED' }
  if (el.getAttribute('type') === 'file' || kind === 'file') {
    return { ...common, ok: false, protected: true, reason: 'FILE_UPLOAD_REQUIRES_EXPLICIT_FILE_PICKER' }
  }
  if (kind === 'hidden' || el.hasAttribute('hidden')) {
    return { ...common, ok: false, protected: true, reason: 'HIDDEN_FIELD_PROTECTED' }
  }
  try {
    if (input.operation === 'scroll') {
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      return { ...common, ok: true }
    }
    if (input.operation === 'click') {
      if ((el instanceof HTMLButtonElement && el.type === 'submit')
        || (el instanceof HTMLInputElement && el.type === 'submit')) {
        return { ...common, ok: false, reason: 'USE_EXPLICIT_SUBMIT_FORM_CONFIRMATION' }
      }
      (el as HTMLElement).click()
      return { ...common, ok: true }
    }
    if (input.operation === 'submit') {
      const form = el instanceof HTMLFormElement ? el : el.closest('form')
      if (!form) return { ...common, ok: false, reason: 'FORM_NOT_FOUND' }
      if (form.querySelector('[type="file"]')) {
        // File upload isn't bypassed; other fields may still submit if empty.
      }
      if (el !== form && ((el as HTMLElement).matches('button,input[type="submit"]'))) {
        (el as HTMLElement).click()
      } else form.requestSubmit()
      return { ...common, ok: true, submitted: true }
    }
    if (input.operation === 'check') {
      const want = input.checked
      if (typeof want !== 'boolean') return { ...common, ok: false, reason: 'CHECKED_REQUIRED' }
      if (kind !== 'checkbox' && kind !== 'radio' && el.getAttribute('role') !== 'checkbox' && el.getAttribute('role') !== 'radio') {
        return { ...common, ok: false, reason: 'NOT_CHECKABLE' }
      }
      if (kind === 'radio' && !want) return { ...common, ok: false, reason: 'RADIO_CANNOT_UNCHECK' }
      if (node.checked !== want) node.click()
      return { ...common, ok: node.checked === want, reason: node.checked === want ? undefined : 'CHECK_NOT_APPLIED' }
    }
    if (input.operation === 'select') {
      if (!(el instanceof HTMLSelectElement)) return { ...common, ok: false, reason: 'NOT_SELECT' }
      const wanted = input.value
      if (wanted === undefined) return { ...common, ok: false, reason: 'VALUE_REQUIRED' }
      const found = Array.from(el.options).find(o => o.value === wanted || clean(o.textContent) === clean(wanted))
      if (!found || found.disabled) return { ...common, ok: false, reason: 'OPTION_NOT_FOUND_OR_DISABLED' }
      el.value = found.value
      el.dispatchEvent(new win.Event('input', { bubbles: true }))
      el.dispatchEvent(new win.Event('change', { bubbles: true }))
      return { ...common, ok: el.value === found.value }
    }
    if (input.operation === 'fill') {
      if (input.value === undefined || input.value.length > 4096) {
        return { ...common, ok: false, reason: 'VALUE_REQUIRED_OR_TOO_LONG' }
      }
      if (kind === 'checkbox' || kind === 'radio' || el instanceof HTMLSelectElement) {
        return { ...common, ok: false, reason: 'USE_CHECK_OR_SELECT' }
      }
      if (el instanceof HTMLInputElement && ['button','submit','reset','image','color','range'].includes(kind)) {
        return { ...common, ok: false, reason: 'UNSUPPORTED_INPUT_TYPE' }
      }
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)) {
        return { ...common, ok: false, reason: 'NOT_EDITABLE' }
      }
      if ((el as HTMLElement).isContentEditable) {
        (el as HTMLElement).textContent = input.value
      } else {
        const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
        if (setter) setter.call(el, input.value)
        else node.value = input.value
      }
      el.dispatchEvent(new win.Event('input', { bubbles: true }))
      el.dispatchEvent(new win.Event('change', { bubbles: true }))
      return { ...common, ok: (el as HTMLElement).isContentEditable
        ? el.textContent === input.value : node.value === input.value }
    }
    return { ...common, ok: false, reason: 'UNSUPPORTED_ACTION' }
  } catch (error) {
    return { ...common, ok: false, reason: 'DOM_ACTION_FAILED: ' + String(error).slice(0,150) }
  }
}

/** Execute several fields in one CDP round-trip, stopping at the first mismatch. */
export function browserBatchExpression(inputs: BrowserInteraction[]): string {
  if (inputs.length === 0 || inputs.length > 30) throw new Error('Expected 1–30 bounded browser actions')
  return '(() => { const run = (' + executeBrowserInteraction.toString() + '); '
    + 'const actions = ' + JSON.stringify(inputs) + '; const results = []; '
    + 'for (const action of actions) { const result = run(action); results.push(result); '
    + 'if (!result.ok) return {ok:false,completed:results.length-1,results}; } '
    + 'return {ok:true,completed:results.length,results}; })()'
}

/** Accepts typed, bounded action input only, never model-supplied JavaScript. */
export function browserInteractionExpression(input: BrowserInteraction): string {
  return '(' + executeBrowserInteraction.toString() + ')(' + JSON.stringify(input) + ')'
}
