import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

describe('PHOENIX VS Code extension manifest', () => {
  it('exposes install, launch, browser, and Explorer surfaces', () => {
    expect(manifest.activationEvents).toEqual(expect.arrayContaining([
      'onCommand:phoenix.start', 'onCommand:phoenix.open', 'onCommand:phoenix.install', 'onView:phoenix.control',
    ]))
    expect(manifest.contributes.commands.map(row => row.command)).toEqual(['phoenix.start', 'phoenix.open', 'phoenix.install'])
    expect(manifest.contributes.views.explorer.map(row => row.id)).toContain('phoenix.control')
  })
})
