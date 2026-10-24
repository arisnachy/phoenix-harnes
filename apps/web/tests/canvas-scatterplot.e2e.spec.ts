import { chromium, type Browser, type Page } from 'playwright'
import { createReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const configuredUrl = process.env.CANVAS_SCATTERPLOT_URL
let url = configuredUrl

describe('Canvas2D scatterplot live demo', () => {
  let browser: Browser
  let page: Page
  let server: Server | undefined
  const consoleErrors: string[] = []

  beforeAll(async () => {
    if (url === undefined) {
      const htmlPath = fileURLToPath(new URL('../public/demos/canvas-scatterplot.html', import.meta.url))
      server = createServer((request, response) => {
        if (new URL(request.url ?? '/', 'http://127.0.0.1').pathname !== '/demos/canvas-scatterplot.html') {
          response.writeHead(404).end()
          return
        }
        response.setHeader('content-type', 'text/html; charset=utf-8')
        createReadStream(htmlPath).pipe(response)
      })
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('scatterplot test server did not expose a TCP address')
      url = `http://127.0.0.1:${address.port}/demos/canvas-scatterplot.html`
    }
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
    page.on('pageerror', (error) => { consoleErrors.push(error.message) })
    await page.goto(url!, { waitUntil: 'networkidle' })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    if (server !== undefined) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
  }, 60_000)

  it('renders the 100,000-point analytical surface and accessible fallback', async () => {
    expect((await page.getByTestId('point-count').textContent())?.trim()).toBe('100000')
    expect(await page.getByRole('img', { name: /scatterplot/i }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: /reiniciar/i }).isVisible()).toBe(true)
    expect(await page.getByRole('heading', { name: 'Teclado' }).isVisible()).toBe(true)
    expect(await page.locator('[aria-live="polite"]').isVisible()).toBe(true)
  })

  it('supports wheel zoom, pointer pan, reset, tooltip, and keyboard focus', async () => {
    const canvas = page.getByRole('img', { name: /scatterplot/i })
    const box = await canvas.boundingBox()
    if (box === null) throw new Error('canvas has no layout box')
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    expect((await page.locator('[aria-live="polite"]').textContent()) ?? '').toMatch(/punto/i)
    await page.mouse.wheel(0, -500)
    expect((await page.getByTestId('zoom').textContent())?.trim()).not.toBe('1.00×')

    const beforePan = await page.getByTestId('view-offset').innerText()
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + 90, centerY + 45)
    await page.mouse.up()
    expect(await page.getByTestId('view-offset').innerText()).not.toBe(beforePan)

    await page.getByRole('button', { name: /reiniciar/i }).click()
    expect((await page.getByTestId('zoom').textContent())?.trim()).toBe('1.00×')
    expect((await page.getByTestId('view-offset').textContent())?.trim()).toBe('0, 0')

    await canvas.focus()
    await page.keyboard.press('ArrowRight')
    expect((await page.locator('[aria-live="polite"]').textContent()) ?? '').toMatch(/punto/i)
    expect(consoleErrors).toEqual([])
  })
})
