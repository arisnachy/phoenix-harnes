// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar } from '../src/client/ModelActivityAvatar.tsx'

const dockCss = readFileSync(new URL('../src/client/KiraTeamsDock.module.css', import.meta.url), 'utf8')
const avatarCss = readFileSync(new URL('../src/client/ModelActivityAvatar.module.css', import.meta.url), 'utf8')

describe('KIRA compact floating live-agent card regression', () => {
  it('keeps the desktop card and live avatar proportionally compact', () => {
    expect(dockCss).toMatch(/\.root\s*{[^}]*max-width:\s*320px/s)
    expect(dockCss).toMatch(/\.row\s*{[^}]*grid-template-columns:\s*58px\s+minmax\(0,\s*1fr\)/s)
    expect(dockCss).toMatch(/\.row\s*{[^}]*min-height:\s*72px/s)
    expect(avatarCss).toMatch(/\.card\s*{[^}]*width:\s*56px;[^}]*height:\s*56px/s)
  })

  it('renders the shipped portrait sprite as a real image element with a cache-busted source', () => {
    const avatar = ModelActivityAvatar({
      kind: 'cobalto',
      activity: { model: 'gpt-5.6-luna', phase: 'verifying' },
      running: true,
      pending: false,
      variant: 'card',
    })
    const children = Array.isArray(avatar.props.children) ? avatar.props.children : [avatar.props.children]
    const viewport = children.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait-image'] === true)
    const viewportChildren = Array.isArray(viewport?.props?.children)
      ? viewport.props.children
      : [viewport?.props?.children]
    const portrait = viewportChildren.find((child: { type?: unknown }) => child?.type === 'img')

    expect(viewport?.type).toBe('span')
    expect(portrait?.props?.src).toMatch(/^\/assets\/kira-agents\/kira-portraits\.webp\?v=/)
    expect(portrait?.props?.['data-agent-portrait-sprite']).toBe(true)
  })
})
