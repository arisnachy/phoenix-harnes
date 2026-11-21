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
  return form
}
