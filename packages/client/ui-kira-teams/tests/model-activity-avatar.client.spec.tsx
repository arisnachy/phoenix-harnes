import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
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
  it('resolves model aliases to stable bundled KIRA portraits', () => {
    expect(portraitSrcForKind('sol')).toBe(portraitSrcForKind('solaria'))
    expect(portraitSrcForKind('luna')).toBe(portraitSrcForKind('eclipse'))
    expect(portraitSrcForKind('terra')).toBe(portraitSrcForKind('senda'))
    expect(portraitSrcForKind('generic')).toBe(portraitSrcForKind('lyra'))
    expect(portraitSrcForKind('sol')).toMatch(/^data:image\/webp;base64,/)
  })
})

describe('ModelActivityAvatar', () => {
  it('renders a real standalone portrait img instead of a shared sprite wrapper', () => {
    const element: ReactElement<Record<string, unknown> & { children?: ReactNode }> = ModelActivityAvatar({
      agentId: 'c1',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const children = Children.toArray(element.props.children).filter(isValidElement<Record<string, unknown>>)
    const image = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait-image'] === true)
    const vectorPortrait = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait'] === true)

    expect(element.props['data-avatar']).toBe('vega')
    expect(image).toBeDefined()
    expect(image?.type).toBe('img')
    expect(image?.props.src).toBe(portraitSrcForKind('vega'))
    expect(image?.props.src).toMatch(/^data:image\/webp;base64,/)
    expect(vectorPortrait).toBeUndefined()
  })

  it.each([
    ['preparing', 'preparing', 'running'],
    ['running-tools', 'running-tools', 'running'],
    ['verifying', 'verifying', 'running'],
    ['idle', 'idle', 'ready'],
  ] as const)(
    'exposes %s as work-status metadata without animating the portrait',
    (inputPhase, expectedPhase, expectedState) => {
      const element: ReactElement<Record<string, unknown> & { children?: ReactNode }> = ModelActivityAvatar({
        agentId: 'c2',
        activity: { model: 'gpt-5.6-luna', phase: inputPhase },
        running: true,
        pending: false,
      })
      expect(element.props).toMatchObject({
        'data-avatar': 'eclipse',
        'data-phase': expectedPhase,
        'data-state': expectedState,
      })
    },
  )

  it('renders a fixed sharp Kira image even when legacy callers request a pose', () => {
    const element = ModelActivityAvatar({ kind: 'kira', activity: undefined,
      running: false, pending: false, ready: true, pose: 'up', speaking: true })
    const children = Children.toArray(element.props.children).filter(isValidElement<Record<string, unknown>>)
    const portraits = children.filter(child => child.props['data-agent-portrait-image'] === true)
    expect(element.props['data-avatar']).toBe('kira')
    expect(element.props['data-avatar-pose']).toBeUndefined()
    expect(portraits).toHaveLength(1)
    expect(portraits[0]?.props.src).toBe(portraitSrcForKind('kira'))
    expect(children).toHaveLength(3) // static border, single portrait, small status dot
    expect(children.every(child => typeof child.type === 'string')).toBe(true)
  })

  it('keeps ready, pending and completed avatars alive without losing identity', () => {
    const ready: ReactElement<Record<string, unknown> & { children?: ReactNode }> = ModelActivityAvatar({
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

describe('Kira lead identity', () => {
  it('uses Kira\'s exclusive portrait instead of Aurora\'s', () => {
    expect(portraitSrcForKind('kira')).toBe('/assets/kira-agents/kira-official.webp')
    expect(portraitSrcForKind('kira')).not.toBe(portraitSrcForKind('aurora'))
  })
})
