/** Real Loader, host, credentials, Kira loop and Chromium; only the external mail/model providers are deterministic. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { SessionId } from '@phoenix-ai/dsh-session'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { MailOutbox } from '../../../packages/hardness/adapters/src/assistant-mail-outbox.ts'
import { launchWebScaffold, compareOrRefreshGolden, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

class MailSocket extends EventTarget {
  constructor(_url: string) { super(); queueMicrotask(() => { this.dispatchEvent(new Event('open')) }) }
  send(_data: string): void {}
  close(): void {}
}

describe('Phoenix local email assistant', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let incoming = false
  let requestId = 'request-1'
  const replies = new Map<string, string>()
  const originalFetch = globalThis.fetch
  const adapter = new MockAdapter([
    toolCallResponse('mail-complete', 'phoenix_mail_complete', { outcome: 'completed', summary: 'El encargo fue revisado.', evidence: 'La comprobación solicitada terminó correctamente.' }),
    textResponse('MAIL_VERIFICATION_COMPLETED'),
    toolCallResponse('mail-complete-next', 'phoenix_mail_complete', { outcome: 'completed', summary: 'Segundo encargo revisado.', evidence: 'La segunda comprobación terminó correctamente.' }),
    textResponse('MAIL_NEXT_VERIFICATION_COMPLETED'),
  ])
  const providerFetch: typeof fetch = async (url, init) => {
    const address = (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url)
    if (!address.startsWith('https://api.agentmail.to/')) return originalFetch(url, init)
    if (address.endsWith('/agent/sign-up')) return Response.json({ api_key: 'keyless-mail-secret', inbox_id: 'kira-keyless@agentmail.to' })
    if (address.endsWith('/agent/verify')) return Response.json({ verified: true })
    if (address.includes('/messages?')) return Response.json({ count: incoming ? 1 : 0, messages: incoming ? [{ message_id: requestId }] : [] })
    if (address.endsWith(`/messages/${requestId}`)) return Response.json({ inbox_id: 'kira-keyless@agentmail.to', message_id: requestId, thread_id: 'thread-1', labels: ['received'], from: 'owner@example.com', subject: requestId === 'request-1' ? 'Encargo local' : 'Encargo nuevo', text: 'Revisa el encargo y entrega un resumen de la comprobación.', headers: {} })
    if (address.endsWith(`/messages/${requestId}/reply`)) {
      const key = new Headers(init?.headers).get('Idempotency-Key')!
      const body = JSON.parse((init?.body as string)) as { text: string; to: string[] }
      expect(body.to).toEqual(['owner@example.com'])
      replies.set(key, body.text)
      return Response.json({ message_id: `reply-${requestId}`, thread_id: 'thread-1' })
    }
    throw new Error('unexpected mail provider operation')
  }
  beforeAll(async () => {
    vi.stubGlobal('fetch', providerFetch)
    vi.stubGlobal('WebSocket', MailSocket)
    scaffold = await launchWebScaffold({})
    scaffold.ctx.llm.registerAdapter(['mail-test'], adapter)
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === undefined
      ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl)
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'mail-assistant')
    const lead = scaffold.ctx.agents.roots()[0]!
    const selected = await scaffold.ctx.apiProxy.sessions.selectModel({ rpcId: 'mail-model' as never, payload: { sessionId: lead.id, provider: 'mail-test', model: 'mail-test' } })
    expect(selected.result.ok).toBe(true)
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    vi.unstubAllGlobals()
  })
  it('enrolls through Integrations, works without the browser and shows one acknowledged result after reload', async () => {
    await page.getByRole('button', { name: /^Settings/u }).click({ timeout: 10_000 })
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Connectors', exact: true }).click()
    await page.getByLabel('Correo del propietario').fill('owner@example.com')
    await page.getByRole('button', { name: 'Crear mi correo gratuito' }).click({ timeout: 10_000 })
    await page.getByText('kira-keyless@agentmail.to', { exact: true }).waitFor()
    await page.getByLabel('Código de verificación').fill('123456')
    await page.getByRole('button', { name: 'Verificar correo' }).click()
    await page.getByText(/Correo verificado/u).waitFor()
    await page.close()
    incoming = true
    const connection = { rpc: { call: async (_channel: string,
      method: string,
      payload: unknown): Promise<{ ok: boolean
      value?: unknown }> => {
      const response = await originalFetch(`${scaffold.baseUrl}/phoenix-mail/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: scaffold.baseUrl }, body: JSON.stringify({ type: 'client-request', rpcId: `test-${method}`, method, payload }) })
      const result = await response.json() as { result: { ok: boolean; value?: unknown } }
      return result.result
    } } }
    const recovered = await connection.rpc.call('/phoenix-mail', 'refresh', {})
    expect(recovered.ok).toBe(true)
    expect(replies.size).toBe(1)
    expect([...replies.values()]).toEqual(['El encargo fue revisado.'])
    const repeated = await connection.rpc.call('/phoenix-mail', 'refresh', {})
    expect(repeated.ok).toBe(true)
    expect(replies.size).toBe(1)
    const persisted = await new MailOutbox(join(scaffold.workspaceCwd, '.phoenix-mail', 'outbox.json'), async () => {
      throw new Error('read-only acceptance inspection must not send mail')
    }).list()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.firstAttempt).toBeGreaterThan(0)
    const delivery = persisted.map(row => ({
      state: row.state, to: row.reply.to, text: row.reply.text, delivery: row.delivery,
    }))
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/phoenix-assistant-email/delivery.expected.json', import.meta.url)), JSON.stringify(delivery, null, 2), scaffold.mode)
    const status = await connection.rpc.call('/phoenix-mail', 'status', {})
    expect(status.ok && JSON.stringify(status.value)).toContain('replied')
    expect(JSON.stringify(status)).not.toContain('keyless-mail-secret')
    const missionId = (status.value as { jobs: { sessionId: string }[] }).jobs[0]!.sessionId as SessionId
    const transcript = await scaffold.ctx.sessionPersistence.load(missionId)
    const shape = transcript.events.flatMap<unknown>((event) => {
      // Pin the mail mission's authored transcript; unrelated live machine snapshots belong to their own scenarios.
      if (event.type === 'user/message' && !(event.data.source?.kind === 'plugin' && event.data.source.plugin === 'hardness-adapters')) return []
      if (event.type === 'user/message' || event.type === 'assistant/message') return [{ type: event.type, data: event.data }]
      if (event.type === 'tool/call' || event.type === 'tool/result') return [{ type: event.type, data: event.data }]
      if (event.type === 'turn/end') return [{ type: event.type, reason: event.data.reason }]
      return []
    })
    const stable = JSON.stringify(shape, (key, value: unknown) => ['id', 'messageId', 'callId', 'toolCallId', 'turnId', 'stepId', 'surfaceId'].includes(key) ? '<identity>' : value, 2)
    await compareOrRefreshGolden(fileURLToPath(new URL('./snapshots/phoenix-assistant-email/session.expected.json', import.meta.url)), stable, scaffold.mode)

    page = await newEnglishPage(browser)
    await page.goto(scaffold.baseUrl)
    await page.waitForSelector('[class*="frame"]')
    const result = page.getByRole('button', { name: /Encargo local.*El encargo fue revisado/u })
    await result.waitFor()
    await result.click()
    await expect.poll(() => result.count()).toBe(0)
    await page.reload()
    await page.waitForSelector('[class*="frame"]')
    expect(await result.count()).toBe(0)
    expect(await page.getByRole('textbox').count()).toBeGreaterThan(0)
    requestId = 'request-2'
    expect((await connection.rpc.call('/phoenix-mail', 'refresh', {})).ok).toBe(true)
    expect(replies.size).toBe(2)
    await page.reload()
    const fresh = page.getByRole('button', { name: /Encargo nuevo.*Segundo encargo revisado/u })
    await fresh.waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    const bounds = await fresh.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds?.width).toBeGreaterThan(40)
    expect(await page.locator('[aria-label="Atención proactiva de Phoenix"]').locator('[class*="attentionEntry"]').count()).toBeLessThanOrEqual(3)
    await page.getByRole('button', { name: 'Descartar Encargo nuevo' }).click()
    await expect.poll(() => fresh.count()).toBe(0)
    await page.reload()
    expect(await fresh.count()).toBe(0)

  }, 90_000)
})
