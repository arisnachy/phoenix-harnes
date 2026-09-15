import { describe, expect, it } from 'vitest'
import {
  ModelActivityAvatar,
  agentAvatarKind,
  modelAvatarKind,
  portraitSrcForKind,
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
  it('keeps the exact approved 20-portrait roster aligned with the visible KIRA codename', () => {
    expect(agentAvatarKind('c1')).toBe('vega')
    expect(agentAvatarKind('c2')).toBe('eclipse')
  })
})

describe('portraitSrcForKind', () => {
  it('ships every persona from the exact approved portrait sheet', () => {
    expect(portraitSrcForKind('sol')).toBe('/assets/kira-agents/kira-portraits.webp')
    expect(portraitSrcForKind('luna')).toBe('/assets/kira-agents/kira-portraits.webp')
    expect(portraitSrcForKind('terra')).toBe('/assets/kira-agents/kira-portraits.webp')
    expect(portraitSrcForKind('generic')).toBe('/assets/kira-agents/kira-portraits.webp')
  })
})

describe('ModelActivityAvatar', () => {
  it('renders the approved portrait sheet instead of a vector face rig', () => {
    const element = ModelActivityAvatar({
      agentId: 'c1',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children]
    const image = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait-image'] === true)
    const vectorPortrait = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait'] === true)

    expect(element.props['data-avatar']).toBe('vega')
    expect(image).toBeDefined()
    expect(image.type).toBe('span')
    expect(String(image.props.style?.['--portrait-image']))
      .toBe('url("/assets/kira-agents/kira-portraits.webp")')
    expect(vectorPortrait).toBeUndefined()
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
      'data-avatar': 'eclipse',
      'data-phase': expectedPhase,
      'data-state': 'running',
    })
  })

  it('keeps ready, pending and completed avatars alive without losing identity', () => {
    const ready = ModelActivityAvatar({
      kind: 'argo', activity: undefined, running: false, pending: false, ready: true,
    })
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

    expect(ready.props).toMatchObject({ 'data-avatar': 'argo', 'data-phase': 'idle', 'data-state': 'ready' })
    expect(done.props).toMatchObject({ 'data-avatar': 'vega', 'data-phase': 'idle', 'data-state': 'done' })
    expect(pending.props).toMatchObject({ 'data-avatar': 'eclipse', 'data-phase': 'running-tools', 'data-state': 'pending' })
    expect(fallback.props).toMatchObject({ 'data-avatar': 'generic', 'data-phase': 'preparing' })
  })
})
