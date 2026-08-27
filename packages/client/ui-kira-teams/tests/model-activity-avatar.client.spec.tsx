import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar, modelAvatarKind } from '../src/client/ModelActivityAvatar.tsx'

describe('modelAvatarKind', () => {
  it.each([
    ['gpt-5.6-sol', 'sol'],
    ['GPT-5.6-LUNA', 'luna'],
    ['gpt-5.6-terra', 'terra'],
    ['another-model', 'generic'],
    [undefined, 'generic'],
  ] as const)('maps %s to %s', (model, expected) => {
    expect(modelAvatarKind(model)).toBe(expected)
  })
})

describe('ModelActivityAvatar', () => {
  it('exposes model family, phase and state as decorative data', () => {
    const element = ModelActivityAvatar({
      activity: { provider: 'openai-codex', model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    expect(element.props['data-avatar']).toBe('luna')
    expect(element.props['data-phase']).toBe('running-tools')
    expect(element.props['data-state']).toBe('running')
    expect(element.props['aria-hidden']).toBe('true')
  })

  it('uses idle and pending states without losing model identity', () => {
    const done = ModelActivityAvatar({
      activity: { model: 'gpt-5.6-sol', phase: 'verifying' },
      running: false,
      pending: false,
    })
    const pending = ModelActivityAvatar({
      activity: { model: 'gpt-5.6-terra', phase: 'running-tools' },
      running: true,
      pending: true,
    })
    const fallback = ModelActivityAvatar({ activity: undefined, running: true, pending: false })
    expect(done.props).toMatchObject({ 'data-avatar': 'sol', 'data-phase': 'idle', 'data-state': 'done' })
    expect(pending.props).toMatchObject({ 'data-avatar': 'terra', 'data-phase': 'running-tools', 'data-state': 'pending' })
    expect(fallback.props).toMatchObject({ 'data-avatar': 'generic', 'data-phase': 'preparing' })
  })
})
