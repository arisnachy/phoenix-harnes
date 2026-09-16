// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar, portraitSrcForKind } from '../src/client/ModelActivityAvatar.tsx'

const dockCss = readFileSync(new URL('../src/client/KiraTeamsDock.module.css', import.meta.url), 'utf8')
const avatarCss = readFileSync(new URL('../src/client/ModelActivityAvatar.module.css', import.meta.url), 'utf8')
const frameCss = readFileSync(new URL('../../ui-layout/src/client/AppFrame.module.css', import.meta.url), 'utf8')

describe('KIRA compact live-agent layout regression', () => {
  it('uses a small structural side rail while preserving readable portraits', () => {
    expect(dockCss).toMatch(/\.root\s*{[^}]*position:\s*relative/s)
    expect(dockCss).not.toMatch(/\.root\s*{[^}]*position:\s*fixed/s)
    expect(frameCss).toMatch(/flex-basis:\s*min\(292px,\s*31vw\)/s)
    expect(dockCss).toMatch(/\.list\s*{[^}]*display:\s*flex/s)
    expect(dockCss).toMatch(/\.list\s*{[^}]*flex-direction:\s*column/s)
    expect(dockCss).not.toMatch(/grid-template-columns:\s*repeat\(5,/s)
    expect(avatarCss).toMatch(/\.card\s*{[^}]*width:\s*52px;[^}]*height:\s*64px/s)
  })

  it('renders each persona from bundled portrait pixels while keeping phase data for animation', () => {
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
    expect(portrait?.props?.src).toBe(portraitSrcForKind('cobalto'))
    expect(portraitSrcForKind('cobalto')).toMatch(/^data:image\/webp;base64,/)
    expect(avatar.props['data-phase']).toBe('verifying')
    expect(avatar.props['data-state']).toBe('running')
  })
})
