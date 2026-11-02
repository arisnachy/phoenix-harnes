import { describe, expect, it } from 'vitest'
import { invokeApprovedOpenClawPlugin } from '../src/openclaw-plugin-bridge.ts'

describe('Kira OpenClaw owner-approved plugin bridge', () => {
  it('rejects shell execution and invented tool identities before HTTP', async () => {
    await expect(invokeApprovedOpenClawPlugin(
      { pluginId: '@openclaw/example', toolName: 'exec' }, '{}',
      { token: 'valid-test-operator-token', port: 18789, verifyOwner: () => true },
    )).rejects.toThrow('identity is invalid')
    await expect(invokeApprovedOpenClawPlugin(
      { pluginId: '../invalid', toolName: 'read_notes' }, '{}',
      { token: 'valid-test-operator-token', port: 18789, verifyOwner: () => true },
    )).rejects.toThrow('identity is invalid')
  })
})
