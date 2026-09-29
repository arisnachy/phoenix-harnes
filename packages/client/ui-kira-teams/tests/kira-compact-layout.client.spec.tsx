// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ModelActivityAvatar, portraitSrcForKind } from '../src/client/ModelActivityAvatar.tsx'

const dockCss = readFileSync(new URL('../src/client/KiraTeamsDock.module.css', import.meta.url), 'utf8')
const avatarCss = readFileSync(new URL('../src/client/ModelActivityAvatar.module.css', import.meta.url), 'utf8')
const frameCss = readFileSync(new URL('../../ui-layout/src/client/AppFrame.module.css', import.meta.url), 'utf8')
const conversationCss = readFileSync(
  new URL('../../ui-conversation/src/client/skeleton/ConversationRoot.module.css', import.meta.url),
  'utf8',
)
const chatCss = readFileSync(
  new URL('../../ui-conversation/src/client/chat/ChatView.module.css', import.meta.url),
  'utf8',
)

describe('KIRA mission-control layout regression', () => {
  it('keeps one fixed-height activity strip and a narrow independent agent rail', () => {
    expect(dockCss).toMatch(/\.root\s*{[^}]*position:\s*fixed/s)
    expect(dockCss).toMatch(/\.strip\s*{[^}]*height:\s*44px/s)
    expect(dockCss).toMatch(/\.rail\s*{[^}]*width:\s*48px/s)
    expect(dockCss).toMatch(/\.avatarStack\s*{[^}]*display:\s*flex/s)
    expect(dockCss).toMatch(/\.railAgents\s*{[^}]*overflow-y:\s*auto/s)
    expect(dockCss).not.toMatch(/grid-template-columns:\s*repeat\(2,/s)
    expect(avatarCss).toMatch(/\.avatar\s*{[^}]*width:\s*42px;[^}]*height:\s*42px/s)
  })

  it('lets chat use the full center column because KIRA remains an overlay', () => {
    expect(frameCss).not.toMatch(/--dsh-kira-chat-clearance/)
    expect(frameCss).not.toMatch(/--dsh-kira-chat-content-width/)
    expect(frameCss).not.toMatch(/--dsh-kira-composer-max-width/)
    expect(conversationCss).not.toMatch(/padding-right:\s*var\(--dsh-kira-chat-clearance/)
    expect(conversationCss).toMatch(/--dsh-chat-content-width:\s*768px/)
    expect(conversationCss).toMatch(/--dsh-composer-card-max-width:\s*calc\(var\(--dsh-chat-content-width\) \+ 32px\)/)
    expect(frameCss).toMatch(/--dsh-chat-floating-overlay-axis-shift:\s*var\(--dsh-overlay-stable-chat-axis-offset, 0px\)/)
    expect(frameCss).not.toMatch(/\.centerCol:has\([^)]*data-kira-teams/s)
    expect(conversationCss).toMatch(
      /\.composerSeat\s*{[^}]*translateX\(calc\(0px - var\(--dsh-chat-floating-overlay-axis-shift, 0px\)\)\)/s,
    )
    expect(chatCss).toMatch(/\.column\s*{[^}]*translateX\(calc\(0px - var\(--dsh-chat-floating-overlay-axis-shift, 0px\)\)\)/s)
  })

  it('renders each persona from bundled portrait pixels while keeping phase data for animation', () => {
    const avatar = ModelActivityAvatar({
      kind: 'cobalto',
      activity: { model: 'gpt-5.6-luna', phase: 'verifying' },
      running: true,
      pending: false,
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
