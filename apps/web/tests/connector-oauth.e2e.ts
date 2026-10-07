import { chromium, type Browser } from 'playwright'
import { describe, expect, it } from 'vitest'
import type {} from '@phoenix-ai/dsh-authorization'
import { credentialKey } from '@phoenix-ai/dsh-credentials'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

// Exercise the shipped browser, Host RPC and authorization interaction. Only
// the external provider is replaced; no client API response is intercepted.
describe('connector OAuth browser handoff', () => {
  it('forwards preparation, prerequisites and consent from the Host to the reserved tab', async () => {
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    try {
      scaffold = await launchWebScaffold({})
      const consent = `${scaffold.baseUrl}/oauth-waiting.html?provider-consent`
      scaffold.ctx.authorization.registerFlow({
        key: credentialKey('mcp-client', 'browser-probe'),
        label: 'Browser OAuth probe',
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
      await page.goto(scaffold.baseUrl)
      await page.getByRole('button', { name: /^Settings/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Connectors', exact: true }).click()
      const popupPromise = page.waitForEvent('popup')
      await page.locator('[data-authorization-key="mcp-client/browser-probe"]').getByRole('button', { name: 'Authorize', exact: true }).click()
      const popup = await popupPromise
      await expect.poll(async () => popup.locator('#status').textContent(), { timeout: 15000 }).toContain('Completa el dato')
      await page.getByLabel('Provider prerequisite').fill('continue')
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await popup.waitForURL(consent, { timeout: 15000 })
      expect(popup.url()).toBe(consent)
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    } finally {
      await browser?.close()
      await scaffold?.close()
    }
  })
})
