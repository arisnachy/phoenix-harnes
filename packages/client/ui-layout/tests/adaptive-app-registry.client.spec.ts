import { describe, expect, it } from 'vitest'
import { createAdaptiveAppBlueprint } from '../src/client/AdaptiveAppCatalog.ts'
import { installAdaptiveApp, readAdaptiveApps, removeAdaptiveApp, appendAdaptiveSection, renameAdaptiveSection, removeAdaptiveSection, restorePreviousAdaptiveApps } from '../src/client/AdaptiveAppRegistry.ts'

function fakeStore() {
  const values = new Map<string,string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('Adaptive app registry persists only validated UI manifests', () => {
  it('renames a contextual menu without changing its stable form ID; can restore prior UI configuration', () => {
    const store = fakeStore()
    const app = createAdaptiveAppBlueprint('Inventario farmacia',['Productos','Reportes'])
    installAdaptiveApp(app,store)
    const renamed = renameAdaptiveSection(app.id,'productos','Medicamentos',store)
    expect(renamed.sections[0]?.id).toBe('productos')
    expect(renamed.sections[0]?.label).toBe('Medicamentos')
    const added = appendAdaptiveSection(app.id,'Proveedores',store)
    expect(added.sections.map(s => s.id)).toEqual(['productos','reportes','proveedores'])
    const hidden = removeAdaptiveSection(app.id,'reportes',store)
    expect(hidden.sections.map(s => s.id)).toEqual(['productos','proveedores'])
    expect(restorePreviousAdaptiveApps(store).find(x => x.id === app.id)?.sections.map(x => x.id))
      .toEqual(['productos','reportes','proveedores'])
    expect(readAdaptiveApps(store).find(x => x.id === app.id)?.sections[0]?.label).toBe('Medicamentos')
  })


  it('saves a preview app, reloads it and maintains last-good snapshot', () => {
    const store = fakeStore()
    const app = createAdaptiveAppBlueprint('Inventario farmacia', ['Inicio', 'Productos', 'Reportes'])
    expect(installAdaptiveApp(app, store)).toEqual([app])
    expect(readAdaptiveApps(store)).toEqual([app])
    expect(() => installAdaptiveApp(app, store)).toThrow('ADAPTIVE_APP_EXISTS')
    expect(removeAdaptiveApp(app.id, store)).toEqual([])
    expect(readAdaptiveApps(store)).toEqual([])
  })

  it('recovers last valid snapshot if current is corrupt or only partly written', () => {
    const store = fakeStore()
    const app = createAdaptiveAppBlueprint('Agenda', ['Inicio'])
    installAdaptiveApp(app, store)
    // Force another valid backup by adding a second app.
    installAdaptiveApp(createAdaptiveAppBlueprint('Inventario', ['Productos']), store)
    const key = 'phoenix.adaptive.apps.v1'
    store.values.set(key, '{broken')
    expect(readAdaptiveApps(store)).toHaveLength(2)
  })

  it('rejects extra executable fields and guards storage write failure', () => {
    const store = fakeStore()
    const app = createAdaptiveAppBlueprint('Gestión', ['Inicio'])
    expect(() => installAdaptiveApp({ ...app, execute: 'stealData()' } as never, store)).toThrow('ADAPTIVE_INVALID_BLUEPRINT')
    // The stored snapshot is reconstructed from a safe allowlist.
    const raw = JSON.stringify([...store.values.values()])
    expect(raw).not.toContain('stealData')
    const broken = { ...store, setItem: () => { throw new Error('quota') } }
    expect(() => installAdaptiveApp(createAdaptiveAppBlueprint('Otra', ['Inicio']), broken)).toThrow('quota')
  })
})
