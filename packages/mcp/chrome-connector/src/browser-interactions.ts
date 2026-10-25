/**
 * Bounded, permission-gated browser DOM operations for Phoenix Kira agents.
 *
 * Only these fixed operations may execute in the inspected tab. No model
 * supplied JavaScript, no private browser storage, password extraction,
 * protected/hidden field writes, file input bypass, or cross-origin iframe
 * spoofing. The same controller works with headless Chromium in the chat.
 */
export type BrowserTarget = {
  selector?: string | undefined
  name?: string | undefined
  label?: string | undefined
  placeholder?: string | undefined
  text?: string | undefined
}
/** Bounded, typed DOM operation and locator accepted by the Chrome connector. */
export type BrowserInteraction = BrowserTarget & {
  operation: 'inspect' | 'fill' | 'select' | 'check' | 'click' | 'submit' | 'scroll' | 'wait' | 'verify'
  value?: string | undefined
  checked?: boolean | undefined
  expectedText?: string | undefined
}
/** Redacted success/failure receipt for a real browser interaction. */
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
 * @param input - Validated locator, operation and bounded user-intended value.
 * @returns A sanitized DOM action result without credentials or field secrets.
 * @param cache - Cache supplied to this operation.
 */
export function executeBrowserInteraction(
  input: BrowserInteraction,
  cache?: { elements?: Element[]; candidates?: Element[] },
): BrowserInteractionResult {
  const doc = document
  const win = window
  const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim().slice(0, 250)
  const lower = (value: string | null | undefined) => clean(value).toLocaleLowerCase()
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
  const basic = { title: clean(doc.title), url: win.location.href }
  if (input.operation === 'wait') {
    const expected = lower(input.expectedText || '')
    if (!expected) return { ...basic, ok: false, reason: 'EXPECTED_TEXT_REQUIRED' }
    const foundText = lower(doc.body?.innerText || doc.body?.textContent || '').includes(expected)
    return { ...basic, ok: foundText, foundText, reason: foundText ? undefined : 'TEXT_NOT_YET_VISIBLE' }
  }
  // A single 30-field batch shares one DOM snapshot instead of performing
  // up to 30 full-document traversals, style scans and shadow-root walks.
  // Detached controls are refused rather than silently updated on a stale DOM.
  const elements = cache?.elements ?? children(doc)
  const candidate = (el: Element) => el.matches('input,textarea,select,button,a[href],[role="button"],[role="checkbox"],[role="radio"],[contenteditable="true"]')
  const candidates = cache?.candidates ?? elements.filter(candidate)
  if (cache !== undefined && cache.elements === undefined) {
    cache.elements = elements
    cache.candidates = candidates
  }
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
      required:  node.required, disabled: protectedField(el),
      readonly: Boolean(node.readOnly || el.hasAttribute('readonly')),
      checked:  node.checked, visible: visible(el),
      ...(options === undefined ? {} : { options }),
    }
  }
  if (input.operation === 'inspect') {
    const frames = elements.filter(el => el.tagName.toLowerCase() === 'iframe')
      .slice(0, 25).map(el => ({ title: el.getAttribute('title') || '', src: el.getAttribute('src') || '',
        accessible: (() => { try { return Boolean((el as HTMLIFrameElement).contentDocument) } catch { return false } })() }))
    const forms = Array.from(doc.forms).slice(0, 30).map(form => ({
      id: form.id, name: form.getAttribute('name') || '',
      method: (form.method || 'get').toLowerCase(), action: form.action,
      fields: Array.from(form.elements).slice(0, 90).filter(el => el instanceof Element).map(el => describe(el)),
    }))
    return { ...basic, ok: true, controls: candidates.filter(visible).slice(0, 100).map(describe), forms, frames }
  }
  const findMatches = (all: Element[], controls: Element[]): Element[] => {
    const pool = input.selector ? all.filter(el => el.matches(input.selector || '')) : controls
    return pool.filter((el) => {
      if (input.name && lower(el.getAttribute('name')) !== lower(input.name)) return false
      if (input.label && lower(fieldLabel(el)) !== lower(input.label)) return false
      if (input.placeholder && lower(el.getAttribute('placeholder')) !== lower(input.placeholder)) return false
      if (input.text && (el.matches('input,textarea,select,[contenteditable="true"]')
        || lower(el.textContent) !== lower(input.text))) return false
      return Boolean(input.selector || input.name || input.label || input.placeholder || input.text)
    })
  }
  let matches: Element[]
  try {
    matches = findMatches(elements, candidates).filter(visible)
    // A prior action may synchronously replace/reveal controls in a dynamic form.
    // Refresh only when the shared snapshot became stale, never per field.
    if (cache && (matches.length === 0 || matches.some(el => !el.isConnected))) {
      cache.elements = children(doc)
      cache.candidates = cache.elements.filter(candidate)
      matches = findMatches(cache.elements, cache.candidates).filter(visible)
    }
  } catch { return { ...basic, ok: false, reason: 'INVALID_SELECTOR' } }
  if (matches.length !== 1) {
    return { ...basic, ok: false, matched: matches.length,
      reason: matches.length === 0 ? 'TARGET_NOT_FOUND' : 'TARGET_AMBIGUOUS' }
  }
  const el = matches[0]
  if (!el) return { ...basic, ok: false, reason: 'TARGET_NOT_FOUND' }
  const node = el as HTMLInputElement
  const kind = (node.type || '').toLowerCase()
  const common = { ...basic, matched: 1, tag: el.tagName.toLowerCase(), type: kind }
  if (!el.isConnected) return { ...common, ok: false, reason: 'TARGET_CHANGED_DURING_BATCH' }
  if (protectedField(el)) return { ...common, ok: false, disabled: Boolean(node.disabled),
    readOnly: Boolean(node.readOnly), protected: true, reason: 'FIELD_PROTECTED' }
  if (el.getAttribute('type') === 'file' || kind === 'file') {
    return { ...common, ok: false, protected: true, reason: 'FILE_UPLOAD_REQUIRES_EXPLICIT_FILE_PICKER' }
  }
  if (kind === 'hidden' || el.hasAttribute('hidden')) {
    return { ...common, ok: false, protected: true, reason: 'HIDDEN_FIELD_PROTECTED' }
  }
  try {
    if (input.operation === 'verify') {
      // Compare only caller-supplied expectations. Never return actual field
      // contents; especially no password or hidden-input value oracle.
      if (kind === 'password' || (el instanceof HTMLInputElement
        && (el.autocomplete === 'username'
          || (el.form?.querySelector('input[type="password"]')
            && /user|email|login|account/i.test((el.name || '') + ' ' + (el.id || '')))))) {
        return { ...common, ok: false, reason: 'SENSITIVE_FIELD_VERIFICATION_UNAVAILABLE' }
      }
      if (typeof input.checked === 'boolean') {
        if (kind !== 'checkbox' && kind !== 'radio') return { ...common, ok: false, reason: 'NOT_CHECKABLE' }
        return node.checked === input.checked
          ? { ...common, ok: true }
          : { ...common, ok: false, reason: 'CHECKED_MISMATCH' }
      }
      if (input.value === undefined) return { ...common, ok: false, reason: 'EXPECTED_VALUE_REQUIRED' }
      if (kind === 'checkbox' || kind === 'radio') return { ...common, ok: false, reason: 'USE_CHECKED_EXPECTATION' }
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)) {
        // Autocomplete draft text does not prove the suggestion became a tag.
        if (!input.selector) return { ...common, ok: false, reason: 'SELECTOR_REQUIRED_FOR_RENDERED_TEXT' }
        return clean(el.textContent) === clean(input.value)
          ? { ...common, ok: true } : { ...common, ok: false, reason: 'VALUE_MISMATCH' }
      }
      const actual = (el as HTMLElement).isContentEditable ? el.textContent ?? '' : node.value
      const expected = el instanceof HTMLSelectElement
        ? Array.from(el.options).find(o => o.value === input.value || clean(o.textContent) === clean(input.value))?.value
        : input.value
      return actual === expected ? { ...common, ok: true } : { ...common, ok: false, reason: 'VALUE_MISMATCH' }
    }
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

/** Execute several fields in one CDP round-trip, stopping at the first mismatch.
 * @param inputs - One to thirty validated DOM interactions.
 * @returns Self-contained CDP expression that stops at the first failed action.
 */
export function browserBatchExpression(inputs: BrowserInteraction[]): string {
  if (inputs.length === 0 || inputs.length > 30) throw new Error('Expected 1–30 bounded browser actions')
  // tsx/esm may emit __name calls inside toString(); define the metadata helper
  // locally so a source-mode expression remains executable in the browser realm.
  return '(() => { const __name = (fn) => fn; const run = (' + executeBrowserInteraction.toString() + '); '
    + 'const actions = ' + JSON.stringify(inputs) + '; const results = []; const cache = {}; '
    + 'for (const action of actions) { const result = run(action, cache); results.push(result); '
    + 'if (!result.ok) return {ok:false,completed:results.length-1,results}; } '
    + 'return {ok:true,completed:results.length,results}; })()'
}

/** Accepts typed, bounded action input only, never model-supplied JavaScript.
 * @param input - Validated single DOM operation and locator.
 * @returns Serializable expression for a single real browser action.
 */
export function browserInteractionExpression(input: BrowserInteraction): string {
  // Keep this wrapper self-contained for tsx/esm source fallback and CDP eval.
  return '(() => { const __name = (fn) => fn; return (' + executeBrowserInteraction.toString() + ')('
    + JSON.stringify(input) + '); })()'
}
