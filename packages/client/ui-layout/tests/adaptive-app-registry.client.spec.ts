import { describe, expect, it } from 'vitest'
import { createAdaptiveAppBlueprint } from '../src/client/AdaptiveAppCatalog.ts'
import { installAdaptiveApp, readAdaptiveApps, removeAdaptiveApp } from '../src/client/AdaptiveAppRegistry.ts'

function fakeStore() {
  const values = new Map<string,string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('Adaptive app registry persists only validated UI manifests', () => {
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
    expect(readAdaptiveApps(store)).toEqual([app])
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
