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
  it('keeps one stable visual identity for each agent id', () => {
    const first = ModelActivityAvatar({
      agentId: 'c1',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const second = ModelActivityAvatar({
      agentId: 'c2',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    expect(first.props['data-avatar']).toBe('lynx')
    expect(second.props['data-avatar']).toBe('dolphin')
    expect(first.props['data-avatar']).not.toBe(second.props['data-avatar'])
  })

  it('renders a vector figure instead of an emoji character card', () => {
    const element = ModelActivityAvatar({
      agentId: 'dragon-agent',
      activity: { phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children]
    const glyph = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-glyph'] === true)
    expect(glyph).toBeDefined()
    expect(glyph.type).toBe('svg')
  })

  it('exposes model family, phase and state as decorative data', () => {
    const element = ModelActivityAvatar({
      activity: { provider: 'openai-codex', model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const props = element.props as Record<string, unknown>
    expect(props['data-avatar']).toBe('luna')
    expect(props['data-phase']).toBe('running-tools')
    expect(props['data-state']).toBe('running')
    expect(props['aria-hidden']).toBe('true')
  })

  it.each([
    ['idle', 'preparing'],
    ['running-tools', 'running-tools'],
    ['verifying', 'verifying'],
  ] as const)('maps the live %s activity to the %s reactive phase', (phase, expected) => {
    const element = ModelActivityAvatar({
      agentId: 'reactive-agent',
      activity: { phase },
      running: true,
      pending: false,
    })
    expect(element.props['data-phase']).toBe(expected)
    expect(element.props['data-state']).toBe('running')
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
