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
  it.each(['browser-probe', 'notion-browser-probe'])('hands off consent through the real Host (%s)', async (id) => {
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
      await page.context().route(consent, async route => route.fulfill({
        contentType: 'text/html', body: '<h1>Provider consent fixture</h1>',
      }))
      await page.goto(scaffold.baseUrl)
      await page.getByRole('button', { name: /^Settings/ }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Connectors', exact: true }).click()
      const popupPromise = page.waitForEvent('popup')
      const card = page.locator(id.startsWith('notion')
        ? '[data-connector-id="notion"]' : '[data-authorization-key="mcp-client/browser-probe"]')
      await card.getByRole('button', { name: 'Authorize', exact: true }).click()
      if (!id.startsWith('notion')) {
        const waiting = await popupPromise
        await expect.poll(async () => waiting.locator('#status').textContent(), { timeout: 15000 }).toContain('Completa el dato')
      } else {
        await page.getByLabel('Provider prerequisite').waitFor()
        expect(page.context().pages()).toHaveLength(1)
      }
      await page.getByLabel('Provider prerequisite').fill('continue')
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      const popup = await popupPromise
      await popup.getByRole('heading', { name: 'Provider consent fixture' }).waitFor({ timeout: 15000 })
      expect(popup.url()).toBe(consent)
      await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
    } finally {
      await browser?.close()
      await scaffold?.close()
      await rm(temporary, { recursive: true, force: true })
    }
  })
})
