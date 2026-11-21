import { describe, expect, it } from 'vitest'
import { createAdaptiveAppBlueprint } from '../src/client/AdaptiveAppCatalog.ts'
import { installAdaptiveApp, readAdaptiveApps, removeAdaptiveApp } from '../src/client/AdaptiveAppRegistry.ts'

function memory() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('Adaptive App Studio registry', () => {
  it('persists only validated structural blueprints and reloads them', () => {
    const store = memory()
    const app = createAdaptiveAppBlueprint('Biblioteca', ['Inicio', 'Libros', 'Informes'])
    expect(installAdaptiveApp(app, store)).toEqual([app])
    expect(readAdaptiveApps(store)).toEqual([app])
    expect(JSON.stringify([...store.values.values()])).not.toContain('credential')
    expect(() => installAdaptiveApp(app, store)).toThrow('ADAPTIVE_APP_EXISTS')
  })

  it('rejects extra untrusted properties without persisting them', () => {
    const store = memory()
    const app = createAdaptiveAppBlueprint('Pruebas', ['Inicio'])
    expect(() => installAdaptiveApp({ ...app, secret: 'should-never-store' } as typeof app, store))
      .toThrow('ADAPTIVE_INVALID_BLUEPRINT')
    expect(readAdaptiveApps(store)).toEqual([])
  })

  it('restores last-good data after a corrupt current snapshot', () => {
    const store = memory()
    const app = createAdaptiveAppBlueprint('Agenda', ['Inicio'])
    installAdaptiveApp(app, store)
    store.setItem('phoenix.adaptive.apps.v1', '{broken')
    expect(readAdaptiveApps(store)).toEqual([])
  })

  it('removes only the selected declaration', () => {
    const store = memory()
    const first = createAdaptiveAppBlueprint('Almacen', ['Inicio'])
    const second = createAdaptiveAppBlueprint('Ventas', ['Resumen'])
    installAdaptiveApp(first, store)
    installAdaptiveApp(second, store)
    expect(removeAdaptiveApp(first.id, store)).toEqual([second])
    expect(readAdaptiveApps(store)).toEqual([second])
  })
})
