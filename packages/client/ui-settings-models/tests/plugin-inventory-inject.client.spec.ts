import { describe, expect, it } from 'vitest'
import { inject } from '@phoenix-ai/dsh-client-ui-settings-models/client'

describe('ui-settings-models remote injection contract', () => {
  it('keeps pluginInventory optional so Models and Connectors can load before the Host remote is available', () => {
    expect(inject).not.toContain('remote.pluginInventory')
  })
})
