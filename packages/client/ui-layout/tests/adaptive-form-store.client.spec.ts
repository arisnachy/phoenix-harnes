// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AdaptiveFormPanel } from '../src/client/AdaptiveFormPanel.tsx'
import { addAdaptiveField, type AdaptiveFormDraft } from '../src/client/AdaptiveAppCatalog.ts'
import { readAdaptiveForm, saveAdaptiveForm } from '../src/client/AdaptiveFormMetadataStore.ts'

function fakeStore() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
  }
}
const initial: AdaptiveFormDraft = {
  version: 1, appId: 'app-inventario', templateId: 'productos', revision: 0,
  state: 'local-draft', fields: [],
}
afterEach(() => {
  cleanup()
  localStorage.removeItem('phoenix.adaptive.form-schemas.v1')
  localStorage.removeItem('phoenix.adaptive.form-schemas.last-good.v1')
})

describe('App Studio generic form schema persistence', () => {
  it('persists only typed metadata, preserves revisions and can restore last-good data', () => {
    const store = fakeStore()
    saveAdaptiveForm(initial, store)
    const next = addAdaptiveField(initial, { label: 'Existencias', kind: 'number', destination: 'local', output: 'table' })
    saveAdaptiveForm(next, store)
    expect(readAdaptiveForm(initial.appId, initial.templateId, store)).toEqual(next)
    expect(() => saveAdaptiveForm(next, store)).toThrow('ADAPTIVE_FORM_REVISION_CONFLICT')
    store.items.set('phoenix.adaptive.form-schemas.v1', '{broken')
    expect(readAdaptiveForm(initial.appId, initial.templateId, store)).toEqual(next)
    expect(JSON.stringify([...store.items.values()])).not.toContain('patientSecret')
  })

  it('refuses clinical metadata in unprotected browser storage', () => {
    const store = fakeStore()
    expect(() => saveAdaptiveForm({ ...initial, appId: 'healthia' }, store)).toThrow('ADAPTIVE_INVALID_FORM')
    expect(readAdaptiveForm('healthia', 'productos', store)).toBeUndefined()
  })

  it('retains form design across remount, but never persists user-entered values', () => {
    render(<AdaptiveFormPanel appId="app-inventario" sectionId="productos"/>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del nuevo campo' }), { target: { value: 'Existencias' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo de entrada' }), { target: { value: 'number' } })
    fireEvent.click(screen.getByRole('button', { name: 'Añadir campo' }))
    expect(readAdaptiveForm('app-inventario', 'productos')?.fields[0]?.kind).toBe('number')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Existencias' }), { target: { value: '8765' } })
    expect(JSON.stringify(localStorage)).not.toContain('8765')
    expect(localStorage.getItem('phoenix.adaptive.form-schemas.v1')).not.toContain('8765')
  })
})
