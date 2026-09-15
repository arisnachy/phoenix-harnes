// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar, portraitSrcForKind } from '../src/client/ModelActivityAvatar.tsx'

const dockCss = readFileSync(new URL('../src/client/KiraTeamsDock.module.css', import.meta.url), 'utf8')
const avatarCss = readFileSync(new URL('../src/client/ModelActivityAvatar.module.css', import.meta.url), 'utf8')

describe('KIRA floating roster layout regression', () => {
  it('stays a floating window and lays the roster out as a five-column grid on desktop', () => {
    expect(dockCss).toMatch(/\.root\s*{[^}]*position:\s*fixed/s)
    expect(dockCss).toMatch(/\.root\s*{[^}]*max-width:\s*760px/s)
    expect(dockCss).toMatch(/\.list\s*{[^}]*display:\s*grid/s)
    expect(dockCss).toMatch(/\.list\s*{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s)
    expect(avatarCss).toMatch(/\.card\s*{[^}]*width:\s*56px;[^}]*height:\s*76px/s)
  })

  it('renders each persona from a standalone portrait asset while keeping phase data for animation', () => {
    const avatar = ModelActivityAvatar({
      kind: 'cobalto',
      activity: { model: 'gpt-5.6-luna', phase: 'verifying' },
      running: true,
      pending: false,
      variant: 'card',
    })
    const children = Array.isArray(avatar.props.children) ? avatar.props.children : [avatar.props.children]
    const portrait = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait-image'] === true)

    expect(portrait?.type).toBe('img')
    expect(portrait?.props?.src).toBe('/assets/kira-agents/portraits/cobalto.svg')
    expect(portraitSrcForKind('cobalto')).toBe('/assets/kira-agents/portraits/cobalto.svg')
    expect(avatar.props['data-phase']).toBe('verifying')
    expect(avatar.props['data-state']).toBe('running')
  })
})
