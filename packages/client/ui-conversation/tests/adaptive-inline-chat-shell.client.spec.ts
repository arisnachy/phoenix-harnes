import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const chat = source('../src/client/skeleton/ConversationRoot.tsx')
const layout = source('../../ui-layout/src/client/AppFrame.tsx')
const layoutCss = source('../../ui-layout/src/client/AppFrame.module.css')
const browser = source('../src/client/chat/ToolActivityFlow.tsx')
const browserCss = source('../src/client/chat/ToolActivityFlow.module.css')
const miniCss = source('../src/client/chat/MiniBrowser.module.css')
const healthCss = source('../../ui-layout/src/client/HealthiaWorkspace.module.css')

describe('PHOENIX side-by-side adaptive workspace and browser', () => {
  it('keeps the existing nine-dot launcher and all Kira/Healthia actions', () => {
    expect(chat).toContain('aria-label="Aplicaciones PHOENIX"')
    expect(chat).toContain('aria-expanded={appMenuOpen}')
    expect(chat).toContain("navigateApp('healthia','doctor')")
    expect(chat).toContain("navigateApp('healthia','patient')")
    expect(chat).toContain('phoenix:adaptive-app-mission')
    expect(layout).toContain('inspectRuntime?.().slots.map')
    expect(layout).toContain('restorePreviousAdaptiveForms()')
  })

  it('keeps Healthia separate but leaves the base chat and composer in their original position', () => {
    const appHost = layout.indexOf('data-adaptive-workspace-host=""')
    const chatHost = layout.indexOf('data-conversation-pane=""')
    expect(appHost).toBeGreaterThan(0)
    expect(chatHost).toBeGreaterThan(appHost)
    expect(layout).toContain('<HealthiaWorkspace')
    expect(layout).toContain('<AdaptiveAppPreview')
    expect(layout).toContain('adaptiveActive={adaptiveActive}')
    expect(layout).not.toContain('data-browser-workspace-host=""')
    expect(layout).not.toContain('inlineAppHost')
    expect(layout).not.toContain('createPortal(')
    expect(chat).not.toContain('data-adaptive-chat-host')
    expect(chat.indexOf('<SessionBodyOutlet')).toBeLessThan(chat.indexOf('{composerSeat}'))
    expect(layoutCss).toContain('.conversationPane')
    expect(layoutCss).toContain('.adaptiveWorkspacePane')
    expect(layoutCss).toContain('flex: 1 1 100%')
    expect(layoutCss).not.toContain('.browserWorkspacePane')
    expect(layoutCss).not.toContain('[data-browser-workspace-visible')
  })

  it('renders the browser and the real Kira responses side-by-side INSIDE the chat flow', () => {
    expect(browser).toContain('groupActiveBrowserFlow(ordinaryFlow, newestBrowserKey, nodes)')
    expect(browser).toContain('const showSidecar = live || savedAccessNotice !== null')
    expect(browser).toContain('return browserContent')
    expect(browser).toContain('newestToolBackedBrowserKey')
    expect(browser).toContain('hasNavigatedWebPage(page)')
    expect(browser).not.toContain('createPortal(')
    expect(browser).not.toContain("document.querySelector('[data-browser-workspace-host]')")
    expect(browser).not.toContain('data-browser-receipt="true"')
    expect(browserCss).toContain("grid-template-columns: minmax(0, 1.7fr) minmax(260px, .85fr)")
    expect(browserCss).toContain('height: min(64vh, 680px)')
    expect(browserCss).not.toContain('position: fixed;')
    expect(miniCss).toContain(":global([data-browser-workspace-active]) .browser:not([data-expanded='true']) .viewport")
    expect(layoutCss).toContain('@media (max-width: 980px)')
  })

  it('preserves clinical access guards and bounded form height in the separate workspace', () => {
    expect(healthCss).toContain('max-height:none')
    expect(healthCss).not.toContain('max-height: min(48vh, 390px)')
    expect(layout).toContain('name="adaptive"')
    expect(layout).toContain('restorePreviousAdaptiveApps()')
    expect(layout).toContain('restorePreviousAdaptiveForms()')
    expect(chat).not.toContain('patientValues:')
  })
})
