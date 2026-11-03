import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { describe, expect, it } from 'vitest'
import type {} from '@phoenix-ai/dsh-authorization'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

// Exercise the shipped browser, Host RPC and authorization interaction. Only
// the external provider is replaced; no client API response is intercepted.
describe('connector OAuth browser handoff', () => {
  it('serves the legacy OAuth waiting URL and forwards only a valid consent URL', async () => {
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    try {
      scaffold = await launchWebScaffold()
      browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' })
      const page = await browser.newPage({ locale: 'es-ES' })
      const consent = 'https://mcp.notion.com/oauth/authorize?state=legacy-browser-probe'
      await page.context().route(consent, async route => route.fulfill({
        contentType: 'text/html', body: '<h1>Legacy provider consent fixture</h1>',
      }))
      await page.goto(scaffold.baseUrl)
      await page.evaluate(() => {
        const button = document.createElement('button')
        button.id = 'launch-legacy-oauth'
        button.textContent = 'Launch legacy OAuth'
        button.onclick = () => {
          (window as Window & { __legacyOAuthPopup?: Window | null }).__legacyOAuthPopup =
            window.open('/oauth-waiting.html?v=20261007-1', '_blank')
        }
        document.body.appendChild(button)
      })
      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        page.locator('#launch-legacy-oauth').click(),
      ])
      await popup.getByRole('heading', { name: 'Conectando con tu proveedor…' }).waitFor()
      expect(new URL(popup.url()).pathname).toBe('/oauth-waiting.html')

      // A cached client must never turn this compatibility page into an
      // untrusted open redirect or a javascript: execution primitive.
      await page.evaluate(() => {
        (window as Window & { __legacyOAuthPopup?: Window | null }).__legacyOAuthPopup?.postMessage(
          { type: 'phoenix/oauth-navigate', url: 'javascript:alert(1)' }, window.location.origin)
      })
      await popup.getByText('El servidor no entregó una URL de autorización segura.', { exact: false }).waitFor()
      expect(new URL(popup.url()).pathname).toBe('/oauth-waiting.html')
      await page.evaluate((destination) => {
        (window as Window & { __legacyOAuthPopup?: Window | null }).__legacyOAuthPopup?.postMessage(
          { type: 'phoenix/oauth-navigate', url: destination }, window.location.origin)
      }, consent)
      await popup.getByRole('heading', { name: 'Legacy provider consent fixture' }).waitFor()
      expect(popup.url()).toBe(consent)
    } finally {
      await browser?.close()
      await scaffold?.close()
    }
  })

  it.each(['browser-probe', 'notion-browser-probe', 'mcp-a1b2c3d'])('hands off consent through the real Host (%s)', async (id) => {
    const temporary = await mkdtemp(join(tmpdir(), 'phoenix-oauth-browser-'))
    const overlay = join(temporary, 'isolated.patch.yml')
    await writeFile(overlay, '- id: plugin-inventory\n  disabled: true\n')
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    try {
      scaffold = await launchWebScaffold({ extraOverlayPath: overlay })
      const consent = 'https://www.notion.so/oauth/authorize?client_id=browser-probe'
      scaffold.ctx.authorization.registerFlow({
        key: credentialKey('mcp-client', id),
        label: id === 'browser-probe' ? 'Browser OAuth probe' : 'MCP notion',
        methods: [{ id: 'oauth', label: 'Authorize Notion' }],
        async run(session) {
          session.notify({ message: 'Discovering the Notion authorization endpoint' })
          await session.prompt({ kind: 'text', message: 'Provider prerequisite' })
          session.notify({ message: 'Continue at the provider', url: consent })
          await new Promise<void>((_resolve, reject) => {
            session.signal.addEventListener('abort', () => { reject(session.signal.reason) }, { once: true })
          })
        },
      })
      browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium' })
      const page = await browser.newPage({ locale: 'en-US' })
      await page.context().route(consent, async route => route.fulfill({
        contentType: 'text/html', body: '<h1>Provider consent fixture</h1>',
      }))
      await page.goto(scaffold.baseUrl)
      await page.getByRole('button', { name: /^Settings/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Connectors', exact: true }).click()
      const card = page.locator(id !== 'browser-probe'
        ? '[data-connector-id="notion"]' : '[data-authorization-key="mcp-client/browser-probe"]')
      await card.getByRole('button', { name: 'Authorize', exact: true }).click()
      // Discovery and prerequisites occur *inside* Phoenix: never open the old
      // waiting page or a speculative about:blank tab in the click gesture.
      await page.getByLabel('Provider prerequisite').waitFor()
      await page.getByLabel('Provider prerequisite').fill('continue')
      const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null)
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await page.getByRole('link', { name: 'Open authorization page' }).waitFor({ timeout: 15000 })
      const popup = await popupPromise
      if (popup !== null) {
        await popup.getByRole('heading', { name: 'Provider consent fixture' }).waitFor({ timeout: 15000 })
        expect(popup.url()).toBe(consent)
        await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      } else {
        // Chromium can decline an asynchronous popup. The client must still
        // expose the official consent hyperlink; no placeholder is required.
        const href = await page.getByRole('link', { name: 'Open authorization page' }).getAttribute('href')
        expect(href).toBe(consent)
      }
    } finally {
      await browser?.close()
      await scaffold?.close()
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
