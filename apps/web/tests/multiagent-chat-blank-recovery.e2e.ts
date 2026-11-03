/** Regression: nonblank session history must never hide the chat and composer. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const SESSION_ID = 'multiagent-chat-blank-recovery'

describe('web e2e: multi-agent chat history recovery', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps a visible transcript placeholder and composer while nonblank history is pending', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-multiagent-chat-blank-recovery'))
    let releaseHistory = (): void => {}
    const held = new Promise<void>(resolve => { releaseHistory = resolve })
    let markRequested = (): void => {}
    const requested = new Promise<void>(resolve => { markRequested = resolve })
    let intercepted = false
    await page.route('**/api/session.history', async route => {
      if (intercepted) { await route.continue(); return }
      intercepted = true
      markRequested()
      await held
      await route.continue()
    })
    try {
      const sidebar = page.getByRole('tree', { name: 'Sessions' })
      await sidebar.getByRole('treeitem', { name: /Use the read tool twice/ }).click()
      await requested
      const root = page.locator('div[data-phase="active"]')
      await root.waitFor({ timeout: 15_000 })
      expect(await root.locator('[data-composer-seat]').isVisible()).toBe(true)
      expect(await root.locator('textarea').first().isVisible()).toBe(true)
      await root.getByRole('status').waitFor({ timeout: 15_000 })
      expect(await root.locator('[data-chat-flow]').isVisible()).toBe(true)
    } finally {
      releaseHistory()
    }
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await page.locator('[data-composer-seat]').isVisible()).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
