import { describe, expect, it } from 'vitest'
import {
  ADAPTIVE_APP_PRESETS, HEALTHIA_DOCTOR_FORM, addAdaptiveField, removeAdaptiveField,
  describeAdaptiveApp, isBindingConnected, recoverAdaptiveDraft, validateAdaptiveDraft,
} from '../src/client/AdaptiveAppCatalog.ts'

describe('Adaptive Harness declarative safety', () => {
  it('preloads generic presets without inventing backend availability', () => {
    expect(ADAPTIVE_APP_PRESETS.map(item => item.id)).toEqual(['general', 'healthia', 'inventory'])
    expect(describeAdaptiveApp('healthia')?.readiness).toBe('shell-ready')
    expect(describeAdaptiveApp('inventory')?.readiness).toBe('preview-only')
    expect(describeAdaptiveApp('healthia')?.capabilities.find(c => c.id === 'healthia.phoenix-exchange')?.state).toBe('disabled')
  })

  it('allows a typed form metadata proposal, never dispatches external actions', () => {
    const draft = addAdaptiveField(HEALTHIA_DOCTOR_FORM, {
      label: 'Control configurable', kind: 'number', destination: 'api', output: 'table',
    })
    expect(draft.revision).toBe(1)
    expect(draft.fields.at(-1)?.binding.destination).toBe('api')
    expect(isBindingConnected(draft.fields.at(-1)!.binding, describeAdaptiveApp('healthia')!.capabilities)).toBe(false)
    expect(HEALTHIA_DOCTOR_FORM.revision).toBe(0)
  })

  it('refuses unknown props, arbitrary URLs, script execution and invalid shapes', () => {
    const withScript = { ...HEALTHIA_DOCTOR_FORM, execute: 'networkCall()' }
    expect(validateAdaptiveDraft(withScript)).toBe(false)
    const withUrl = { ...HEALTHIA_DOCTOR_FORM, fields: [
      { ...HEALTHIA_DOCTOR_FORM.fields[0], href: 'https://unknown.example' },
      ...HEALTHIA_DOCTOR_FORM.fields.slice(1),
    ] }
    expect(validateAdaptiveDraft(withUrl)).toBe(false)
    expect(() => addAdaptiveField(HEALTHIA_DOCTOR_FORM, {
      label: 'x', kind: 'text', destination: 'api', output: 'inline', url: 'https://unknown.example',
    } as never)).toThrow('ADAPTIVE_INVALID_FIELD')
  })

  it('protects identity fields, detects stale revisions and restores safe snapshots', () => {
    expect(validateAdaptiveDraft(HEALTHIA_DOCTOR_FORM)).toBe(true)
    expect(() => removeAdaptiveField(HEALTHIA_DOCTOR_FORM, 'patient-reference')).toThrow('ADAPTIVE_PROTECTED_OR_MISSING_FIELD')
    expect(() => addAdaptiveField(HEALTHIA_DOCTOR_FORM,
      { label: 'Otro', kind: 'text', destination: 'local', output: 'inline' }, 5)).toThrow('ADAPTIVE_REVISION_CONFLICT')
    const next = addAdaptiveField(HEALTHIA_DOCTOR_FORM,
      { label: 'Seguimiento', kind: 'date', destination: 'local', output: 'inline' })
    expect(recoverAdaptiveDraft(HEALTHIA_DOCTOR_FORM, next)).toBe(next)
    const forged = { ...next, fields: next.fields.filter(field => field.id !== 'patient-reference') }
    expect(recoverAdaptiveDraft(HEALTHIA_DOCTOR_FORM, forged)).toBe(HEALTHIA_DOCTOR_FORM)
    expect(recoverAdaptiveDraft(HEALTHIA_DOCTOR_FORM, { ...next, revision: 20 })).toBe(HEALTHIA_DOCTOR_FORM)
  })
})
