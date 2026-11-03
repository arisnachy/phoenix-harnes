import { describe, expect, it } from 'vitest'
import { externalOpenClawPluginInventory, normalizedRuntimeTools } from '../src/openclaw-plugin-routing.ts'

describe('OpenClaw plugin runtime tool inspection', () => {
  it('only recognizes registered runtime tools, not manifest declarations', () => {
    const registered = normalizedRuntimeTools({
      imported: true,
      status: 'loaded',
      tools: ['manifest-only'],
      runtime: { tools: [{ name: 'todoist_search' }, { name: 'exec' }] },
    })
    expect(registered.imported).toBe(true)
    expect(registered.tools).toEqual(['todoist_search'])
  })

  it('does not treat a cold plugin manifest as a loaded runtime', () => {
    const report = normalizedRuntimeTools({
      status: 'enabled',
      tools: ['todoist_search'],
      manifest: { tools: ['todoist_search'] },
    })
    expect(report.imported).toBe(false)
    expect(report.tools).toEqual([])
  })
})

describe('OpenClaw external plugin catalog', () => {
  it('does not list bundled OpenClaw provider plugins as external installs', () => {
    const inventory = externalOpenClawPluginInventory({ plugins: [
      { id: 'built-in-browser', origin: 'bundled', enabled: true },
      { id: 'composio', origin: 'global', enabled: false },
      { id: '../invalid', origin: 'global', enabled: true },
    ] })
    expect(inventory.map(plugin => plugin.id)).toEqual(['composio'])
  })
})
