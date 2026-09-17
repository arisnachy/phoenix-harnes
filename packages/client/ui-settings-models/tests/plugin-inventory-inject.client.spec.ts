import { describe, expect, it } from 'vitest'
import { inject } from '@phoenix-ai/dsh-client-ui-settings-models/client'

describe('ui-settings-models remote injection contract', () => {
  it('declares the nested pluginInventory remote service it reads during apply', () => {
    expect(inject).toContain('remote.pluginInventory')
  })
})
