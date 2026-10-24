// Real assembled Settings RPC and file persistence with a synthetic account catalog.
// No provider requests or user settings are consumed by this scenario.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LlmAdapter, ReasoningEffortId, type LlmModelInfo, type LlmResolvedModelInfo, type StreamChunk } from '@phoenix-ai/dsh-llm'
import { settingsNamespace } from '@phoenix-ai/dsh-settings'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./eclipse-routing.overlay.yml', import.meta.url))
const MODELS = ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-6-luna', 'gpt-5.6-luna']
const profile = { mode: 'manual', executionEngine: 'internal', coordinator: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
  subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'xhigh' }, escalationSensitivity: 'adaptive', maxTeammates: 2 }

class SettingsCatalog extends LlmAdapter {
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(MODELS.map(id => ({ provider, id, name: id })))
  }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, reasoning: {
      efforts: ['low', 'medium', 'high', 'xhigh', 'max', ...model.endsWith('-sol') ? ['ultra'] : []]
        .map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId('high'),
    } })
  }
  override async *stream(): AsyncIterable<StreamChunk> { throw new Error('Settings test must not call a model') }
}

it('saves two Codex role routes and an independent engine preference across browser reload', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
  const registration = scaffold.ctx.llm.registerAdapter(['openai-codex'], new SettingsCatalog())
  const browser = await chromium.launch()
  try {
    const ordinaryModelBefore = JSON.stringify(scaffold.ctx.settings.get(settingsNamespace('agent-default-model')))
    // Real settings authority must advertise Eclipse before the browser starts.
    const described = await scaffold.ctx.apiProxy.settings.describe({ rpcId: 'eclipse-describe' as never, payload: {} })
    expect(described.result.ok).toBe(true)
    if (!described.result.ok) throw new Error(described.result.error.message)
    expect(described.result.value.namespaces.map(row => row.ns)).toContain('eclipse-routing')
    const page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: /^Settings/u }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.getByRole('button', { name: 'Fénix Eclipse', exact: true }).click()
    const content = dialog.locator('section[aria-label="Fénix Eclipse · Orchestration"]')
    await expect.poll(() => content.locator('#eclipse-coordinator').isEnabled()).toBe(true)
    expect(await content.locator('#eclipse-planner').count()).toBe(0)
    expect(await content.locator('#eclipse-specialist').count()).toBe(0)
    expect(await content.locator('#eclipse-coordinator option').allTextContents()).toEqual(['Automatic',
      'gpt-6.1-sol', 'gpt-6-luna'])
    await content.locator('#eclipse-mode').selectOption('manual')
    expect(await content.locator('#eclipse-planner').count()).toBe(0)
    await content.locator('#eclipse-coordinator').selectOption(JSON.stringify(['openai-codex', 'gpt-6.1-sol']))
    expect(await content.locator('#eclipse-effort-coordinator option[value="ultra"]').count()).toBe(1)
    await content.locator('#eclipse-effort-coordinator').selectOption('medium')
    await content.locator('#eclipse-subagent').selectOption(JSON.stringify(['openai-codex', 'gpt-6-luna']))
    expect(await content.locator('#eclipse-effort-subagent option[value="ultra"]').count()).toBe(0)
    await content.locator('#eclipse-effort-subagent').selectOption('xhigh')
    await content.locator('#eclipse-strategy').selectOption('adaptive')
    expect(await content.getByText('Unlimited per phase.', { exact: false }).count()).toBe(1)
    await content.locator('#eclipse-workers').selectOption('2')
    await content.locator('#eclipse-engine').selectOption('internal')
    await content.getByRole('button', { name: 'Check engine status', exact: true }).click()
    await content.getByText('Phoenix internal engine · Connected · phoenix', { exact: true }).waitFor()
    await content.getByRole('button', { name: 'Save Eclipse', exact: true }).click()
    await content.getByText('Eclipse settings saved.', { exact: true }).waitFor()
    expect(scaffold.ctx.settings.get(settingsNamespace('eclipse-routing'))).toMatchObject(profile)
    const persisted = await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8')
    expect(persisted).toContain('gpt-6.1-sol')
    expect(persisted).toContain('xhigh')
    expect(JSON.stringify(scaffold.ctx.settings.get(settingsNamespace('agent-default-model')))).toBe(ordinaryModelBefore)
    await content.getByText(/^PHOENIX · current · [a-f0-9]{8}$/u).waitFor()
    expect(await content.getByRole('button', { name: 'Prepare official OpenClaw', exact: true }).count()).toBe(1)
    expect(await content.locator('#eclipse-openclaw-version').getAttribute('placeholder')).toBe('2026.10.6')
    const screenshotDir = join(REPO_ROOT, '.artifacts', 'dual-core')
    await mkdir(screenshotDir, { recursive: true })
    await content.locator('#eclipse-mode').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotDir, 'eclipse-model-roles.png') })
    await content.getByRole('button', { name: 'Save Eclipse', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(screenshotDir, 'eclipse-execution-settings.png') })
    await compareOrRefreshGolden(join(REPO_ROOT, 'apps/web/tests/snapshots/eclipse-routing/settings.expected.md'),
      (await captureStableAria(page, 'section[aria-label="Fénix Eclipse · Orchestration"]', scaffold.workspaceCwd))
        .replace(/(listitem: PHOENIX · current · )[a-f0-9]{8}/gu, '$1<COMMIT>'), webSnapshotMode())
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: /^Settings/u }).click()
    await dialog.getByRole('button', { name: 'Fénix Eclipse', exact: true }).click()
    expect(await content.locator('#eclipse-planner').count()).toBe(0)
    expect(await content.locator('#eclipse-coordinator').inputValue()).toBe(JSON.stringify(['openai-codex', 'gpt-6.1-sol']))
    expect(await content.locator('#eclipse-effort-coordinator').inputValue()).toBe('medium')
    expect(await content.locator('#eclipse-strategy').inputValue()).toBe('adaptive')
    expect(await content.locator('#eclipse-effort-subagent').inputValue()).toBe('xhigh')
    expect(await content.locator('#eclipse-workers').inputValue()).toBe('2')
    expect(await content.locator('#eclipse-engine').inputValue()).toBe('internal')
    expect(JSON.stringify(scaffold.ctx.settings.get(settingsNamespace('agent-default-model')))).toBe(ordinaryModelBefore)
    expect(tripwire.pageErrors).toEqual([])
  } finally {
    await browser.close()
    registration()
    await scaffold.close()
  }
}, 180_000)
