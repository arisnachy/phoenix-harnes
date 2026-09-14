import { describe, expect, it } from 'vitest'
import {
  ModelActivityAvatar,
  agentAvatarKind,
  modelAvatarKind,
} from '../src/client/ModelActivityAvatar.tsx'

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

describe('agentAvatarKind', () => {
  it('keeps the visual persona aligned with the visible KIRA codename roster', () => {
    expect(agentAvatarKind('c1')).toBe('orion')
    expect(agentAvatarKind('c2')).toBe('nexo')
  })
})

describe('ModelActivityAvatar', () => {
  it('renders a living portrait instead of the old geometric agent glyph', () => {
    const element = ModelActivityAvatar({
      agentId: 'c1',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children]
    const portrait = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait'] === true)
    const legacyGlyph = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-glyph'] === true)

    expect(element.props['data-avatar']).toBe('orion')
    expect(portrait).toBeDefined()
    expect(portrait.type).toBe('svg')
    expect(legacyGlyph).toBeUndefined()
  })

  it.each([
    ['idle', 'preparing'],
    ['running-tools', 'running-tools'],
    ['verifying', 'verifying'],
  ] as const)('exposes %s work as the reactive %s motion state', (inputPhase, expectedPhase) => {
    const element = ModelActivityAvatar({
      agentId: 'c2',
      activity: { model: 'gpt-5.6-luna', phase: inputPhase },
      running: true,
      pending: false,
    })
    expect(element.props).toMatchObject({
      'data-avatar': 'nexo',
      'data-phase': expectedPhase,
      'data-state': 'running',
    })
  })

  it('keeps pending and completed avatars alive without losing identity', () => {
    const done = ModelActivityAvatar({
      agentId: 'c1',
      activity: { model: 'gpt-5.6-sol', phase: 'verifying' },
      running: false,
      pending: false,
    })
    const pending = ModelActivityAvatar({
      agentId: 'c2',
      activity: { model: 'gpt-5.6-terra', phase: 'running-tools' },
      running: true,
      pending: true,
    })
    const fallback = ModelActivityAvatar({ activity: undefined, running: true, pending: false })

    expect(done.props).toMatchObject({ 'data-avatar': 'orion', 'data-phase': 'idle', 'data-state': 'done' })
    expect(pending.props).toMatchObject({ 'data-avatar': 'nexo', 'data-phase': 'running-tools', 'data-state': 'pending' })
    expect(fallback.props).toMatchObject({ 'data-avatar': 'generic', 'data-phase': 'preparing' })
  })
})
