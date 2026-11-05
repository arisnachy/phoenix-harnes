/**
 * Convert trustworthy declarative HTML calculator metadata into PHOENIX's
 * already-tested smart_form runtime. No arbitrary JavaScript or expression
 * evaluation crosses the sandbox boundary.
 */
import { parseSmartForm, type SmartFormSpec } from './SmartFormEngine.ts'
import { starterForms } from './SmartFormLibrary.ts'

/** A form can compute natively, must show an explicit warning, or stay HTML. */
export type HtmlFormRecovery =
  | { readonly kind: 'native'; readonly spec: SmartFormSpec }
  | { readonly kind: 'inert' }
  | { readonly kind: 'html' }

const FORMULA_TYPES = new Set([
  'application/vnd.phoenix.smart-form+json',
  'application/vnd.phoenix.smart-form.v1+json',
])
// oxlint-disable-next-line @stylistic/max-len -- Only calculation-specific UI is screened; ordinary HTML is preserved.
const CALCULATION_LABEL = /\b(?:calcular|c[aá]lculo|calculadora|calculate|calculator|compute|resultado|result|puntaje|puntuaci[oó]n|score|imc|bmi|[ií]ndice\s+de\s+masa\s+corporal)\b/iu
const BODY_LIMIT = 250_000

function labelFor(doc: Document, input: HTMLInputElement): string {
  const own = input.closest('label')?.textContent ?? ''
  const linked = Array.from(doc.querySelectorAll('label'))
    .find(label => label.getAttribute('for') === input.id && input.id !== '')?.textContent ?? ''
  const parent = input.parentElement
  // A form-level wrapper contains other field labels and must never cause
  // two unrelated controls to be mistaken for the same semantic input.
  const wrapper = parent?.querySelectorAll('input').length === 1
    ? parent.textContent?.slice(0, 160) ?? '' : ''
  const nextUnit = input.nextElementSibling?.tagName.toLowerCase() === 'span'
    ? input.nextElementSibling.textContent?.slice(0, 40) ?? '' : ''
  return [input.id, input.name, input.getAttribute('aria-label'), own, linked, wrapper, nextUnit]
    .join(' ').toLocaleLowerCase('es')
}

function authoredBehavior(doc: Document, html: string): boolean {
  const inlineScript = Array.from(doc.querySelectorAll('script')).some(script => {
    const type = (script.getAttribute('type') ?? '').trim().toLowerCase()
    return (type === '' || type === 'module' || type === 'text/javascript'
      || type === 'application/javascript') && !script.hasAttribute('src')
      && (script.textContent ?? '').trim().length > 0
  })
  // Script files do not run in the isolated HTML preview (CSP connect-src
  // and script-src prohibit external resources). JSON payloads are not code.
  return inlineScript || /<\w+\b[^>]*\bon[a-z][a-z\d_-]*\s*=/iu.test(html)
}

function bmiFallback(doc: Document, title: string): SmartFormSpec | undefined {
  if (!/\b(?:imc|bmi|[ií]ndice\s+de\s+masa\s+corporal)\b/iu.test(title + ' ' + (doc.body.textContent ?? '').slice(0, 2500))) {
    return undefined
  }
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="number"]'))
  // Do not silently reinterpret multi-field clinical instruments as BMI.
  if (inputs.length !== 2) return undefined
  const weight = inputs.find(input => /\b(?:peso|weight)\b/iu.test(labelFor(doc, input)))
  const height = inputs.find(input => /\b(?:estatura|altura|talla|height)\b/iu.test(labelFor(doc, input)))
  if (!weight || !height || weight === height) return undefined
  const starter = starterForms.find(form => form.props.id === 'calculadora_imc')
  if (starter === undefined) return undefined
  const weightValue = Number(weight.value)
  const heightValue = Number(height.value)
  const heightContext = labelFor(doc, height)
  const inMetres = /\b(?:metros?|metres?|meters?)\b|\(m\)/iu.test(heightContext)
    && !/\bcm\b|cent[ií]metr/iu.test(heightContext)
  const heightCm = inMetres ? heightValue * 100 : heightValue
  const fields = starter.props.fields.map(field => {
    const value = field.id === 'peso' ? weightValue : heightCm
    const configured = field.id === 'peso' ? weight : height
    if (!configured.hasAttribute('value') || !Number.isFinite(value)
      || (field.min !== undefined && value < field.min)
      || (field.max !== undefined && value > field.max)) return field
    return { ...field, default: value }
  })
  return parseSmartForm({ ...starter, props: { ...starter.props, fields } }) ?? undefined
}

/**
 * Recover a real calculator from a model-authored HTML artifact when a
 * validated native definition is present, or from the safe built-in BMI
 * formula for an unmistakable static two-input BMI layout. Unknown formulas
 * are NEVER guessed. Unsupported nonfunctional calculators are flagged.
 * @param html - The HTML artifact source.
 * @param title - Human-readable artifact title.
 * @returns Native form, nonfunctional-form warning, or unchanged HTML route.
 */
export function recoverHtmlForm(html: string, title: string): HtmlFormRecovery {
  if (typeof DOMParser === 'undefined' || html.length > BODY_LIMIT
    || !/<(?:form|input|select|textarea|fieldset)\b/iu.test(html)) return { kind: 'html' }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const definitions = Array.from(doc.querySelectorAll('script')).filter(script =>
    FORMULA_TYPES.has((script.getAttribute('type') ?? '').toLowerCase())
    || (script.getAttribute('type') === 'application/json' && script.hasAttribute('data-phoenix-smart-form')))
  if (definitions.length === 1) {
    try {
      const native = parseSmartForm(JSON.parse(definitions[0]?.textContent ?? '') as unknown)
      if (native !== null) return { kind: 'native', spec: native }
    } catch { /* malformed model output is not executable code */ }
  }
  if (authoredBehavior(doc, html)) return { kind: 'html' }
  const builtin = bmiFallback(doc, title)
  if (builtin !== undefined) return { kind: 'native', spec: builtin }
  const labels = title + ' ' + (doc.body.textContent ?? '').slice(0, 3500)
  return CALCULATION_LABEL.test(labels) ? { kind: 'inert' } : { kind: 'html' }
}
