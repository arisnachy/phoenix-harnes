/** Real Loader, HTTP/WebSocket, host persistence and main-composer acceptance. */
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-agent-team'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

describe('Kira team in the existing main chat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const release = Promise.withResolvers<undefined>()
  let entered = 0
  const adapter = new MockAdapter([
    textResponse('KIRA_TEAM_COORDINATION'),
    toolCallResponse('hold-zenith', 'team_test_hold', {}, 'ZENITH_REAL_FINDING'),
    toolCallResponse('hold-argo', 'team_test_hold', {}, 'ARGO_REAL_VERIFICATION'),
    textResponse('ZENITH_CONTEXTUAL_REPLY'), textResponse('ARGO_CONTEXTUAL_REPLY'), 'hang', 'hang',
  ])
  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    scaffold.ctx.llm.registerAdapter(['team-chat-test'], adapter)
    scaffold.ctx.on('agent/session-start', ({ agent }) => {
      if (agent.session.header.origin !== 'subagent') return
      agent.ctx.tools.register(defineTool({ name: 'team_test_hold', description: 'Deterministic keyless barrier', parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
        async execute() { entered++; await release.promise; return {} },
      }))
    })
    browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH === undefined
      ? {} : { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('console', (message) => { if (message.type() === 'error') tripwire.pageErrors.push(message.text()) })
    await page.goto(scaffold.baseUrl)
    try { await page.waitForSelector('[class*="frame"]') } catch (error) {
      await page.screenshot({ path: '/tmp/phoenix-kira-boot-failure.png' })
      throw new Error(JSON.stringify({ warnings: tripwire.warnings, errors: tripwire.pageErrors, body: await page.locator('body').innerText() }), { cause: error })
    }
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'kira-team-chat')
  }, 120_000)
  afterAll(async () => {
    release.resolve(undefined)
    await browser?.close()
    await scaffold?.close()
  })
  it('shows real avatars, routes a contextual multi-target reply, persists reactions and reloads without duplicate rows', async () => {
    const lead = scaffold.ctx.agents.list().find(agent => agent.session.header.origin !== 'subagent')
    if (lead === undefined) throw new Error('real main session is not active')
    const selected = await scaffold.ctx.apiProxy.sessions.selectModel({ rpcId: 'team-model' as never, payload: { sessionId: lead.id, provider: 'team-chat-test', model: 'team-chat-test' } })
    expect(selected.result.ok).toBe(true)
    await page.locator('textarea:enabled').last().fill('USER_TEAM_MISSION')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText('KIRA_TEAM_COORDINATION', { exact: true }).waitFor()
    const start = async (name: string) => await scaffold.ctx.agentTeams.spawnTeammate(lead, {
      name, description: `${name} review evidence`, prompt: [{ type: 'text', text: `Review ${name}` }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal,
    })
    const zenith = await start('zenith')
    const argo = await start('argo')
    await expect.poll(() => entered).toBe(2)
    const zenithRow = page.locator(`[data-team-sender-id="${zenith.member.id}"]`).filter({ hasText: 'ZENITH_REAL_FINDING' })
    const argoRow = page.locator(`[data-team-sender-id="${argo.member.id}"]`).filter({ hasText: 'ARGO_REAL_VERIFICATION' })
    await zenithRow.waitFor()
    await argoRow.waitFor()
    expect(await zenithRow.locator('img').count()).toBeGreaterThan(0)
    expect(await argoRow.locator('img').count()).toBeGreaterThan(0)
    const transcript = await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })
    const finding = transcript.messages.find(row => row.text === 'ZENITH_REAL_FINDING')!
    const actualArgo = scaffold.ctx.agents.get(argo.member.id)
    if (actualArgo === undefined) throw new Error('Argo is not active')
    const peer = await scaffold.ctx.agentTeams.sendMessage(actualArgo, {
      target: 'zenith', content: [{ type: 'text', text: 'ARGO_PEER_QUESTION_EVIDENCE' }],
      purpose: 'question', delivery: 'quiet', signal: new AbortController().signal,
    })
    const peerRow = page.locator(`[data-team-sender-id="${argo.member.id}"]`).filter({ hasText: 'ARGO_PEER_QUESTION_EVIDENCE' })
    await peerRow.waitFor()
    expect(await peerRow.textContent()).toContain('Zenith')
    await expect.poll(() => scaffold.ctx.agents.get(zenith.member.id)?.inbox.nextStep
      .some(message => message.content.some(block => block.type === 'text' && block.text.includes('ARGO_PEER_QUESTION_EVIDENCE')))).toBe(true)
    expect((await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
      .some(message => message.id === peer.messageId)).toBe(true)
    const calls = adapter.requests.length
    await scaffold.ctx.agentTeams.reactToChat(lead, { sessionId: lead.id, messageId: finding.id, emoji: '✅', active: true })
    await scaffold.ctx.agentTeams.reactToChat(scaffold.ctx.agents.get(argo.member.id)!, { sessionId: lead.id, messageId: finding.id, emoji: '👩🏽‍💻', active: true })
    const actions = page.locator(`[data-team-reactions="${finding.id}"]`)
    await actions.getByRole('button', { name: 'Add reaction', exact: true }).click()
    await actions.getByRole('button', { name: '👍', exact: true }).click()
    await expect.poll(async () => (await actions.textContent())?.includes('👩🏽‍💻')).toBe(true)
    expect(adapter.requests).toHaveLength(calls)
    await actions.getByRole('button', { name: 'Add reaction', exact: true }).click()
    await actions.getByRole('button', { name: '+', exact: true }).click()
    try { await actions.getByPlaceholder('Search emoji').waitFor({ timeout: 10_000 }) } catch (error) {
      await page.screenshot({ path: '/tmp/phoenix-kira-picker-failure.png' })
      throw new Error(JSON.stringify({ errors: tripwire.pageErrors, warnings: tripwire.warnings, body: await page.locator('body').innerText() }), { cause: error })
    }
    await actions.getByPlaceholder('Search emoji').fill('rocket')
    await actions.locator('button[data-unified="1f680"]').click()
    await expect.poll(async () => (await actions.textContent())?.includes('🚀')).toBe(true)
    expect(adapter.requests).toHaveLength(calls)
    await actions.getByRole('button', { name: 'Reply', exact: true }).click()
    await page.locator('[data-team-reply-context]').waitFor()
    const composer = page.locator('textarea:enabled').last()
    await composer.fill('@Zenith @Argo USER_FOCUS_12')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(async () => (await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.filter(row => row.text === '@Zenith @Argo USER_FOCUS_12').length).toBe(1)
    expect(await page.locator('[data-team-sender-id="user"]').filter({ hasText: 'USER_FOCUS_12' }).count()).toBe(1)
    for (const id of [zenith.member.id, argo.member.id]) {
      const child = scaffold.ctx.sessions.get(id)!
      expect(child.events.some(event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-step'
        && event.data.inserted.some(message => message.content.some(block => block.type === 'text' && block.text.includes('ZENITH_REAL_FINDING') && block.text.includes('USER_FOCUS_12'))))).toBe(true)
    }
    await page.reload()
    await zenithRow.waitFor()
    await argoRow.waitFor()
    await peerRow.waitFor()
    await expect.poll(() => actions.getByRole('button', { name: /👍 1/ }).count()).toBe(1)
    expect(await page.locator('[data-team-sender-id="user"]').filter({ hasText: 'USER_FOCUS_12' }).count()).toBe(1)
    expect(adapter.requests).toHaveLength(calls)
    await page.screenshot({ path: '/tmp/phoenix-kira-team-chat.png', fullPage: true })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
})
