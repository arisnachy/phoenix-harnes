/**
 * Versioned structure-only form repository for generic PHOENIX apps.
 * Never persists field values, data records, credentials or patient data.
 * Clinical Healthia schemas are owned exclusively by its authenticated server.
 */
import { validateAdaptiveDraft, type AdaptiveFormDraft } from './AdaptiveAppCatalog.ts'

const PRIMARY = 'phoenix.adaptive.form-schemas.v1'
const BACKUP = 'phoenix.adaptive.form-schemas.last-good.v1'
const MAX_FORMS = 96
const MAX_BYTES = 180_000
type Store = Pick<Storage, 'getItem' | 'setItem'>

function currentStore(): Store | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage }
  catch { return undefined }
}

function parse(raw: string | null): readonly AdaptiveFormDraft[] | null {
  if (raw === null || raw.length > MAX_BYTES) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const entry = data as Record<string, unknown>
    if (Object.keys(entry).some(k => k !== 'version' && k !== 'forms')
      || entry.version !== 1 || !Array.isArray(entry.forms) || entry.forms.length > MAX_FORMS) return null
    const forms: AdaptiveFormDraft[] = []
    for (const form of entry.forms) {
      if (!validateAdaptiveDraft(form) || !/^app-[a-z0-9-]{1,45}$/u.test(form.appId)
        || forms.some(item => item.appId === form.appId && item.templateId === form.templateId)) return null
      forms.push(form)
    }
    return forms
  } catch { return null }
}

function load(store: Store | undefined): readonly AdaptiveFormDraft[] {
  if (!store) return []
  try { return parse(store.getItem(PRIMARY)) ?? parse(store.getItem(BACKUP)) ?? [] }
  catch { return [] }
}

/** Return only a validated form definition, not user-entered values. */
export function readAdaptiveForm(
  appId: string, templateId: string, store: Store | undefined = currentStore(),
): AdaptiveFormDraft | undefined {
  return load(store).find(form => form.appId === appId && form.templateId === templateId)
}

export function saveAdaptiveForm(
  form: AdaptiveFormDraft, store: Store | undefined = currentStore(),
): AdaptiveFormDraft {
  if (!store) throw new Error('ADAPTIVE_FORM_STORAGE_UNAVAILABLE')
  if (!validateAdaptiveDraft(form) || !/^app-[a-z0-9-]{1,45}$/u.test(form.appId)) {
    throw new Error('ADAPTIVE_INVALID_FORM')
  }
  const current = load(store)
  const previous = current.find(item => item.appId === form.appId && item.templateId === form.templateId)
  if (previous && form.revision !== previous.revision + 1) throw new Error('ADAPTIVE_FORM_REVISION_CONFLICT')
  if (!previous && form.revision !== 0 && form.revision !== 1) throw new Error('ADAPTIVE_FORM_REVISION_CONFLICT')
  const next = [...current.filter(item => !(item.appId === form.appId && item.templateId === form.templateId)), form]
  if (next.length > MAX_FORMS) throw new Error('ADAPTIVE_FORM_LIMIT')
  const encoded = JSON.stringify({ version: 1, forms: next })
  if (encoded.length > MAX_BYTES) throw new Error('ADAPTIVE_FORM_LIMIT')
  store.setItem(BACKUP, JSON.stringify({ version: 1, forms: current }))
  store.setItem(PRIMARY, encoded)
  // Keep the most recently validated successful snapshot as primary fallback.
  try { store.setItem(BACKUP, encoded) } catch { /* existing backup remains */ }
  return form
}

type ProposedField = {
  readonly label: string
  readonly kind: 'text'|'number'|'date'|'select'|'textarea'
  readonly destination: 'local'|'api'|'chat'|'ai'
  readonly output: 'inline'|'table'|'document'|'chat'
}
/**
 * Append a model-proposed FORM STRUCTURE after a user clicked approval.
 * Validates every object, builds stable non-executable field IDs and commits
 * exactly one revision. Values, API addresses and code are never accepted.
 */
export function applyAdaptiveFormFields(
  appId: string, sectionId: string, input: unknown, store: Store | undefined = currentStore(),
): AdaptiveFormDraft {
  if (!store || !/^app-[a-z0-9-]{1,45}$/u.test(appId)
    || !/^[a-z][a-z0-9-]{0,47}$/u.test(sectionId)
    || !Array.isArray(input) || input.length < 1 || input.length > 20) {
    throw new Error('ADAPTIVE_INVALID_FORM_PROPOSAL')
  }
  const prior: AdaptiveFormDraft = readAdaptiveForm(appId, sectionId, store) ?? {
    version: 1 as const, appId, templateId: sectionId,
    revision: 0, state: 'local-draft' as const, fields: [],
  }
  if (prior.fields.length + input.length > 40) throw new Error('ADAPTIVE_FORM_LIMIT')
  const ids = new Set(prior.fields.map(field => field.id))
  const labels = new Set(prior.fields.map(field => field.label.toLocaleLowerCase('es')))
  const proposed: AdaptiveFormDraft['fields'][number][] = []
  let serial = 1
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ADAPTIVE_INVALID_FORM_PROPOSAL')
    const field = raw as Record<string, unknown>
    if (Object.keys(field).some(key => !['label','kind','destination','output'].includes(key))
      || typeof field.label !== 'string' || field.label !== field.label.trim()
      || field.label.length < 1 || field.label.length > 60
      || /[\u0000-\u001f\u007f]/u.test(field.label)
      || !['text','number','date','select','textarea'].includes(field.kind as string)
      || !['local','api','chat','ai'].includes(field.destination as string)
      || !['inline','table','document','chat'].includes(field.output as string)
      || labels.has(field.label.toLocaleLowerCase('es'))) throw new Error('ADAPTIVE_INVALID_FORM_PROPOSAL')
    labels.add(field.label.toLocaleLowerCase('es'))
    while (ids.has(`cfg-${serial}`)) serial += 1
    const id = `cfg-${serial++}`
    ids.add(id)
    proposed.push({
      id, label: field.label, kind: field.kind as ProposedField['kind'],
      required: false, protected: false,
      binding: { destination: field.destination as ProposedField['destination'], output: field.output as ProposedField['output'] },
    })
  }
  const next: AdaptiveFormDraft = { ...prior, revision: prior.revision + 1, fields: [...prior.fields, ...proposed] }
  if (!validateAdaptiveDraft(next)) throw new Error('ADAPTIVE_INVALID_FORM_PROPOSAL')
  return saveAdaptiveForm(next, store)
}
