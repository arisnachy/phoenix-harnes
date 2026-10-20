// Deterministic UI history seed with synthetic assistant text; no provider
// transcript, model usage, real website, or saved credential is represented.
import { mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  fixtureUserPrompts,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/secure-login', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const FIRST_USE_EXPECTED = join(SNAPSHOT_DIR, 'first-use.expected.md')
const SAVED_ACCESS_EXPECTED = join(SNAPSHOT_DIR, 'saved-access.expected.md')
const MODE = webSnapshotMode()
const SESSION_ID = 'secure-login-web-e2e'
const PROMPT = 'Open https://example.org/login in the browser.'
const ACTIVITY_TEXT = 'SECURE_LOGIN_ACTIVITY_VISIBLE'

const LOGIN_FIELDS = [
  {
    key: 'account', role: 'account', label: 'Usuario real', placeholder: 'Usuario real',
    inputType: 'text', required: true,
  },
  {
    key: 'secret', role: 'secret', label: 'Contraseña real', placeholder: 'Contraseña real',
    inputType: 'password', required: true,
  },
  {
    key: 'extra:0', role: 'extra', label: 'Código de organización', placeholder: 'Código de organización',
    inputType: 'text', required: true,
  },
] as const

type VaultMode = 'first-use' | 'saved'

/** Assert visibility through Playwright while keeping Vitest as the test runner. */
async function visible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout: 15_000 })
  expect(await locator.isVisible()).toBe(true)
}

/** Install only metadata routes; no account, password, or Vault value crosses the browser. */
async function mockLoopbackBrowser(page: Page, mode: VaultMode): Promise<void> {
  const browserState = {
    available: true,
    tabId: 'secure-login-tab',
    url: 'https://example.org/login',
    title: 'Example sign in',
    tabs: [{ id: 'secure-login-tab', title: 'Example sign in', url: 'https://example.org/login' }],
  }
  const profiles = [
    {
      id: 'personal', saved: mode === 'saved', automatic: false,
      source: mode === 'saved' ? 'dpapi' : 'none',
    },
    { id: 'kira', saved: false, automatic: false, source: 'none' },
  ] as const
  await page.route('**/phoenix-mini-browser/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/state')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(browserState),
      })
      return
    }
    if (pathname.endsWith('/frame')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="480" viewBox="0 0 1000 480">'
          + '<rect width="1000" height="480" fill="#f7f7f5"/>'
          + '<text x="64" y="95" font-family="sans-serif" font-size="28" fill="#30302c">Página de prueba de acceso</text>'
          + '<text x="64" y="142" font-family="sans-serif" font-size="18" fill="#65655e">example.org · Sin credenciales reales</text></svg>',
      })
      return
    }
    await route.continue()
  })
  await page.route('**/phoenix-secure-login/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/status')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          saved: mode === 'saved', automatic: false, profile: 'personal', profiles,
        }),
      })
      return
    }
    if (pathname.endsWith('/detect')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          required: true, formVisible: true, gateVisible: true,
          canOpenInPlace: false, warningVisible: false, fields: LOGIN_FIELDS,
        }),
      })
      return
    }
    // The test never submits a credential. Keep any accidental button click
    // metadata-only so the route cannot become a credential transport.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'login-form-not-found', saved: mode === 'saved', profiles }),
    })
  })
}

/** Open the seeded URL request on the real assembled page. */
async function openSecureLoginSession(page: Page, scaffold: WebScaffold): Promise<void> {
  await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  const rows = page.locator('[role="treeitem"]')
  await rows.first().waitFor({ state: 'visible', timeout: 15_000 })
  await rows.first().click()
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
  await rows.nth(1).click()
  await visible(page.getByText(PROMPT, { exact: true }))
}

/** Capture an intentional success artifact outside the committed snapshot directory. */
async function saveEvidenceShot(page: Page, name: string): Promise<void> {
  const artifactDir = join(REPO_ROOT, '.artifacts')
  mkdirSync(artifactDir, { recursive: true })
  await page.screenshot({ path: join(artifactDir, name + '.png'), fullPage: true })
}

describe('web e2e: Secure Ask protected credential card', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole> = { warnings: [], pageErrors: [] }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    if (MODE !== 'record') {
      const fixture = await readFile(FIXTURE, 'utf8')
      expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
      await seedSession(scaffold, fixture, SESSION_ID)
    }
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('renders first-use detected fields inside the browser pane and preserves chat activity', async () => {
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await mockLoopbackBrowser(page, 'first-use')
    onTestFailed(() => saveFailureShot(page!, 'web-e2e-secure-login-first-use'))
    await openSecureLoginSession(page, scaffold)

    const workspace = page.locator('[data-chat-flow-kind="browser-workspace"]').first()
    const pane = workspace.locator('[class*="browserPane"]')
    const secure = pane.getByRole('region', { name: 'Acceso seguro de Kira' })
    await visible(secure)
    await visible(page.getByText(ACTIVITY_TEXT, { exact: true }))
    await visible(secure.getByLabel('Usuario real'))
    await visible(secure.getByLabel('Contraseña real'))
    await visible(secure.getByLabel('Código de organización'))
    expect(await secure.locator('input[type="password"]').count()).toBe(1)

    const snapshot = await captureStableAria(page, '[data-secure-ask="true"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(FIRST_USE_EXPECTED, snapshot, MODE)
    await saveEvidenceShot(page, 'web-e2e-secure-login-first-use')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps saved access compact, leaves no password prompt, and collapses without hiding chat activity', async () => {
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await mockLoopbackBrowser(page, 'saved')
    onTestFailed(() => saveFailureShot(page!, 'web-e2e-secure-login-saved'))
    await openSecureLoginSession(page, scaffold)

    const workspace = page.locator('[data-chat-flow-kind="browser-workspace"]').first()
    const pane = workspace.locator('[class*="browserPane"]')
    const secure = pane.getByRole('region', { name: 'Acceso seguro de Kira' })
    const activity = workspace.getByRole('complementary', { name: 'Actividad del agente' })
    await visible(secure)
    await visible(activity)
    await visible(secure.getByText('Ya existe un acceso guardado para este sitio. No es necesario escribirlo otra vez.'))
    await visible(secure.getByRole('button', { name: 'Usar acceso guardado' }))
    await visible(secure.getByRole('button', { name: 'Cambiar o completar credenciales' }))
    expect(await secure.locator('input[type="password"]').count()).toBe(0)
    await visible(page.getByText(ACTIVITY_TEXT, { exact: true }))

    const snapshot = await captureStableAria(page, '[data-secure-ask="true"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(SAVED_ACCESS_EXPECTED, snapshot, MODE)

    await secure.getByRole('button', { name: 'Contraer acceso seguro' }).click()
    await visible(secure.getByRole('button', { name: 'Expandir acceso seguro' }))
    await visible(page.getByText(ACTIVITY_TEXT, { exact: true }))
    await saveEvidenceShot(page, 'web-e2e-secure-login-saved')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the Secure Ask snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['first-use.expected.md', 'saved-access.expected.md', 'session.jsonl'])
  })
})
