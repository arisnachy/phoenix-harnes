import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

const chat = source('../src/client/skeleton/ConversationRoot.tsx')
const chatCss = source('../src/client/skeleton/ConversationRoot.module.css')
const layout = source('../../ui-layout/src/client/AppFrame.tsx')
const layoutCss = source('../../ui-layout/src/client/AppFrame.module.css')
const healthCss = source('../../ui-layout/src/client/HealthiaWorkspace.module.css')

describe('PHOENIX adaptive workspace lives in chat, not as a fixed window', () => {
  it('reuses the real nine-dot top-bar control and keeps existing plugin access', () => {
    expect(chat).toContain('aria-label="Aplicaciones PHOENIX"')
    expect(chat).toContain('aria-expanded={appMenuOpen}')
    expect(chat).toContain('className={css.appMenu}')
    expect(chat).toContain('appSearchRef')
    expect(chat).toContain("openSettingsSection('plugins')")
    expect(layout).not.toContain('className={css.appLauncher}')
    expect(layoutCss).not.toContain('.appLauncherButton')
  })

  it('places the app host in the conversation scrollport ahead of its composer', () => {
    const body = chat.indexOf('<SessionBodyOutlet sessionId={sessionId}')
    const host = chat.indexOf('data-adaptive-chat-host=""')
    const composer = chat.indexOf('{composerSeat}', host)
    expect(body).toBeGreaterThanOrEqual(0)
    expect(host).toBeGreaterThan(body)
    expect(composer).toBeGreaterThan(host)
    expect(layout).toContain("querySelector<HTMLElement>('[data-adaptive-chat-host]')")
    expect(layout).toContain('createPortal(')
    expect(layout).toContain('inlineAppHost')
    expect(layout).toContain('<HealthiaWorkspace')
    expect(layout).toContain('<AdaptiveAppPreview')
    expect(chatCss).toContain('.adaptiveChatHost:empty {display:none;}')
  })

  it('does not cap form height or push the conversation under a detached panel', () => {
    expect(healthCss).not.toContain('max-height: min(48vh, 390px)')
    expect(healthCss).not.toContain('margin: 54px 26px 0')
    expect(healthCss).toContain('max-height:none')
    expect(layoutCss).toContain('.adaptiveChatCard')
    expect(chatCss).toContain('.adaptiveChatHost')
  })

  it('keeps role selection, user-directed Kira actions and metadata-only inspection', () => {
    expect(chat).toContain("navigateApp('healthia','doctor')")
    expect(chat).toContain("navigateApp('healthia','patient')")
    expect(chat).toContain("phoenix:adaptive-app-mission")
    expect(chat).toContain("phoenix:adaptive-self-inspect-request")
    expect(chat).toContain("phoenix:adaptive-workspace-state-request")
    expect(layout).toContain("phoenix:adaptive-self-inspect")
    expect(layout).toContain('inspectRuntime?.().slots.map')
    expect(layout).toContain('restorePreviousAdaptiveForms()')
    expect(chat).not.toContain('patientValues:')
  })
})
