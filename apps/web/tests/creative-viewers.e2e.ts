// Keyless integration: real Code Mode worker and publishers, synthetic artwork,
// then durable replay in the assembled web client. No model/provider usage is invented.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import WorkerRuntime from '@phoenix-ai/dsh-code-runtime-worker-thread'
import { CallId } from '@phoenix-ai/dsh-llm'
import { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import Tools from '@phoenix-ai/dsh-tools'
import { createPhoenixComicTool } from '../../../packages/hardness/adapters/src/comic-tool.ts'
import { createPhoenixSceneMapTool } from '../../../packages/hardness/adapters/src/scene-map-tool.ts'
import { createPhoenixGeoMapTool } from '../../../packages/hardness/adapters/src/geo-map-tool.ts'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const PROMPT = 'Verificar el visor del cómic y los mapas con datos sintéticos.'
const SNAPSHOT = join(REPO_ROOT, 'apps/web/tests/snapshots/creative-viewers/ui.expected.md')
// Real 128x128 PNG test pattern; this verifies transport, never artistic quality.
const ART = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABMElEQVR4nO3RMQ0AIADAMMAZPvCDbWT0YFWwZPPsO+IsHfC7BmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYA7AGikQIkd+ic2QAAAABJRU5ErkJggg=='
const image = '<img onload="document.body.dataset.comicScript=\'executed\'" alt="Patrón sintético de prueba" src="data:image/png;base64,' + ART + '">'
const HTML = '<!doctype html><html lang="es"><head><title>Cómic de prueba</title><style>body{margin:0}.edition{display:grid;gap:12px}.comic-cover-page,.comic-page{position:relative;min-height:300px;background:#e9d8c0}img{max-width:100%;width:180px}.bubble{font:24px sans-serif}</style></head><body><main class="edition">'
  + '<section class="comic-cover-page cover-front" data-comic-cover="front">' + image + '<h1>Portada de prueba</h1></section>'
  + '<section class="comic-page"><article class="panel">' + image + '<div class="dialogues"><div class="bubble">El visor conserva la página.</div></div></article></section>'
  + '<section class="comic-cover-page cover-back" data-comic-cover="back">' + image + '<h2>Contraportada de prueba</h2></section></main></body></html>'

it('publishes comic and map subcalls through Code Mode and opens their real viewers', async () => {
  const scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const runtime = new Context()
  const browser = await chromium.launch()
  try {
    await runtime.plugin(SystemPrompt)
    await runtime.plugin(Tools, { mode: 'code' })
    await runtime.plugin(WorkerRuntime)
    runtime.tools.register(createPhoenixComicTool())
    runtime.tools.register(createPhoenixSceneMapTool())
    runtime.tools.register(createPhoenixGeoMapTool())
    const events: { type: string; data: unknown }[] = []
    const agent = { id: SessionId('creative-worker'), session: {
      header: { cwd: scaffold.workspaceCwd },
      append: (type: string, data: unknown) => { events.push({ type, data }) },
    } } as unknown as Agent
    const geo = { source: 'Datos sintéticos para verificar el visor', layers: [{ id: 'puntos', name: 'Prueba', kind: 'points',
      features: [{ id: 'sitio', label: 'Sitio de prueba', coordinates: [[-70.69, 19.78]], value: 7, detail: 'Dato sintético' }] }] }
    const code = 'await tools.phoenix_comic(' + JSON.stringify({ title: 'Cómic de prueba', html: HTML }) + ');'
      + 'await tools.phoenix_scene_map({title:"Isla Bruma",demo:true});'
      + 'await tools.phoenix_geo_map(' + JSON.stringify({ title: 'Mapa geográfico de prueba', map: geo }) + ');'
    const result = await runtime.tools.execute({ name: 'run_code', callId: CallId('creative-call'),
      arguments: { code, description: 'Publicar cómic y mapas de prueba' }, signal: new AbortController().signal, agent })
    expect(result.isError).toBe(false)
    const dispatches = events.filter(event => event.type === 'tool/code-dispatch')
    expect(dispatches).toHaveLength(3)
    for (const event of dispatches) expect(event.data).toMatchObject({ isError: false, meta: { artifact: { executable: false } } })
    const rows = [
      { type: 'session', version: 0, id: '{{sessionId}}', cwd: '{{cwd}}/workspace', createdAt: 0 },
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', surfaceOp: 'append', data: { role: 'user', id: 'viewer-user', source: { kind: 'user' }, content: [{ type: 'text', text: PROMPT }] } },
      { type: 'session/title', data: { title: 'Visores de cómic y mapas', messageSeqs: [1], source: { kind: 'fallback' } } },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'creative-call', name: 'run_code', arguments: JSON.stringify({ code, description: 'Publicar cómic y mapas de prueba' }) } },
      ...events,
      { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
        role: 'user', id: 'viewer-tool-result', source: { kind: 'tool', callId: 'creative-call' },
        content: [{ type: 'tool-result', toolCallId: 'creative-call', content: result.content, isError: result.isError }],
      } } },
      { type: 'step/end', data: { turn: 1, step: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    await seedSession(scaffold, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'creative-viewers')
    const page = await newEnglishPage(browser)
    const consoleWatch = watchConsole(page)
    await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#edf1ee"/></svg>' }))
    await page.goto(scaffold.baseUrl)
    const tree = page.locator('[role="treeitem"]')
    await tree.first().click()
    await expect.poll(() => tree.count()).toBeGreaterThanOrEqual(2)
    await tree.nth(1).click()
    await page.getByText(PROMPT, { exact: true }).waitFor()
    await page.locator('[data-phoenix-comic-studio]').waitFor()
    const comic = page.locator('[data-artifact-mime="application/vnd.phoenix.comic+html"]')
    const frame = comic.frameLocator('iframe')
    await frame.getByText('El visor conserva la página.', { exact: true }).waitFor()
    expect(await frame.locator('img').count()).toBe(3)
    await expect.poll(() => frame.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth >= 128))).toBe(true)
    const comicDownload = page.waitForEvent('download')
    await comic.getByRole('button', { name: 'Download', exact: true }).click()
    const downloadedComic = await comicDownload
    expect(downloadedComic.suggestedFilename()).toMatch(/\.html$/u)
    const comicPath = await downloadedComic.path()
    if (comicPath === null) throw new Error('Comic download did not produce a local file')
    const downloadedHtml = await readFile(comicPath, 'utf8')
    expect(downloadedHtml).toContain('Content-Security-Policy')
    expect(downloadedHtml).toContain("script-src 'none'")
    expect(downloadedHtml).toContain('El visor conserva la página.')
    const savedReader = await newEnglishPage(browser)
    await savedReader.setContent(downloadedHtml)
    await expect.poll(() => savedReader.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true)
    expect(await savedReader.locator('body').getAttribute('data-comic-script')).toBeNull()
    await savedReader.close()
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await comic.getByRole('button', { name: 'Expand', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/creative-comic-reader.png') })
    await page.getByRole('button', { name: 'Collapse', exact: true }).click()
    const map = page.locator('[data-artifact-mime="application/vnd.phoenix.scene-map+json"]')
    await map.getByRole('button', { name: 'Explorar Torre del Viento', exact: true }).click()
    await map.getByText('El vigía escucha los nombres del viento.', { exact: true }).waitFor()
    const download = page.waitForEvent('download')
    await map.getByRole('button', { name: 'Exportar SVG', exact: true }).click()
    const svg = await (await download).path()
    if (svg === null) throw new Error('Map SVG download did not produce a local file')
    expect(await readFile(svg, 'utf8')).toContain('Isla Bruma')
    const realMap = page.locator('[data-artifact-mime="application/vnd.phoenix.geo+json"]')
    await realMap.getByRole('region', { name: 'Mapa interactivo: Mapa geográfico de prueba' }).waitFor()
    expect(await realMap.getByRole('button', { name: 'Seleccionar Sitio de prueba' }).count()).toBe(1)
    await mkdir(join(REPO_ROOT, 'apps/web/tests/snapshots/creative-viewers'), { recursive: true })
    const snapshots = await Promise.all(['application/vnd.phoenix.comic+html', 'application/vnd.phoenix.scene-map+json', 'application/vnd.phoenix.geo+json']
      .map(mime => captureStableAria(page, '[data-artifact-mime="' + mime + '"]', scaffold.workspaceCwd)))
    await compareOrRefreshGolden(SNAPSHOT, snapshots.join('\n\n'), webSnapshotMode())
    await mkdir(join(REPO_ROOT, '.artifacts'), { recursive: true })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/creative-viewers.png'), fullPage: true })
    await realMap.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/creative-geographic-map.png') })
    await page.reload()
    await page.locator('[data-phoenix-comic-studio]').waitFor()
    expect(await page.locator('[data-hardness-artifact]').count()).toBe(3)
    expect(consoleWatch.pageErrors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
  }
}, 180_000)
