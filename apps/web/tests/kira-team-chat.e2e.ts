/** Real Loader, HTTP/WebSocket, host persistence and main-composer acceptance. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GenerateOptions } from '@phoenix-ai/dsh-llm'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defineTool } from '@phoenix-ai/dsh-tools'
import type {} from '@phoenix-ai/dsh-agent-team'
import { MockAdapter, textResponse, toolCallResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

/** Replay only nondeterministic model output; delivery, tools, files and UI remain real. */
function continueAddressedMission(options: GenerateOptions) {
  const text = options.messages.flatMap(message => message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const assignment = options.messages.find(message => message.role === 'user')?.content
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
  const name = assignment.includes('Review zenith') ? 'ZENITH' : assignment.includes('Review argo') ? 'ARGO' : undefined
  if (name === undefined) return textResponse('KIRA_TEAM_COMPLETION')
  const requestId = text.match(/\[Team user message ([a-zA-Z0-9_-]+)\]/u)?.[1]
  if (requestId === undefined) throw new Error('No real directed user question reached the teammate')
  expect(text).toContain('User priority: answer this person at the next safe boundary')
  expect(text).toContain('Then continue your existing mission')
  const calls = options.messages.flatMap(message => message.content)
    .flatMap(block => block.type === 'tool-call' ? [block.name] : [])
  if (!calls.includes('team_chat_answer')) return toolCallResponse(`answer-${name}`, 'team_chat_answer', {
    message_id: requestId, text: `${name}_CONTEXTUAL_REPLY`,
  })
  if (!calls.includes('team_test_continue')) return toolCallResponse(`continue-${name}`, 'team_test_continue', {})
  return textResponse(`${name}_MISSION_CONTINUED`)
}

describe('Kira team in the existing main chat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const release = Promise.withResolvers<undefined>()
  let entered = 0
  const adapter = new MockAdapter([
    textResponse('KIRA_TEAM_COORDINATION'),
    toolCallResponse('start-zenith', 'send_message', { target: 'lead', purpose: 'update', message: 'Kira, contrastaré las fuentes de Zenith antes de entregar el resultado.' }),
    toolCallResponse('hold-zenith', 'team_test_hold', {}, 'ZENITH_REAL_FINDING'),
    toolCallResponse('start-argo', 'send_message', { target: 'lead', purpose: 'update', message: 'Kira, buscaré las fuentes de Argo y te diré qué puedo verificar.' }),
    toolCallResponse('hold-argo', 'team_test_hold', {}, 'ARGO_REAL_VERIFICATION'),
    ...Array.from({ length: 12 }, () => continueAddressedMission),
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
      agent.ctx.tools.register(defineTool({ name: 'team_test_continue', description: 'Persist the resumed mission checkpoint', parameters: {},
        output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
        async execute() { await writeFile(join(scaffold.workspaceCwd, `${agent.id}.resume.txt`), 'mission resumed after the user answer'); return {} },
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
    expect(lead.ctx.tools.schemas(lead).map(tool => tool.name)).toContain('image_generation')
    const selected = await scaffold.ctx.apiProxy.sessions.selectModel({ rpcId: 'team-model' as never, payload: { sessionId: lead.id, provider: 'team-chat-test', model: 'team-chat-test' } })
    expect(selected.result.ok).toBe(true)
    await page.locator('textarea:enabled').last().fill('USER_TEAM_MISSION')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await page.getByText('KIRA_TEAM_COORDINATION', { exact: true }).waitFor()
    const prepared = lead.session.events.findLast(event => event.type === 'request/header')
    if (prepared?.type !== 'request/header') throw new Error('No actual model request was persisted')
    const badge = page.locator(`[data-kira-model="${prepared.data.header.config.model}"]`).first()
    await badge.waitFor()
    expect(await badge.getAttribute('title')).toBe(`${prepared.data.header.config.provider} · ${prepared.data.header.config.model}`)
    const kiraPortrait = page.locator('[data-team-author="kira"] img').first()
    await expect.poll(() => kiraPortrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const geometry = await kiraPortrait.evaluate((image) => {
      const portrait = image.getBoundingClientRect()
      const avatar = image.parentElement!.getBoundingClientRect()
      const holder = image.parentElement!.parentElement!.getBoundingClientRect()
      return {
        portrait: { width: portrait.width, left: portrait.left, top: portrait.top, right: portrait.right, bottom: portrait.bottom },
        holder: { width: holder.width, left: holder.left, top: holder.top, right: holder.right, bottom: holder.bottom },
        avatar: { width: avatar.width, height: avatar.height },
      }
    })
    expect(geometry.portrait.width, JSON.stringify(geometry)).toBeGreaterThanOrEqual(28)
    expect(Math.abs(geometry.avatar.width - geometry.avatar.height)).toBeLessThan(1)
    expect(geometry.portrait.left).toBeGreaterThanOrEqual(geometry.holder.left)
    expect(geometry.portrait.top).toBeGreaterThanOrEqual(geometry.holder.top)
    expect(geometry.portrait.right).toBeLessThanOrEqual(geometry.holder.right)
    expect(geometry.portrait.bottom).toBeLessThanOrEqual(geometry.holder.bottom)
    await page.screenshot({ path: '/tmp/phoenix-kira-visible-author.png' })
    const start = async (name: string) => await scaffold.ctx.agentTeams.spawnTeammate(lead, {
      name, description: `${name} review evidence`, prompt: [{ type: 'text', text: `Review ${name}` }], context: 'fresh', provider: 'spawn', signal: new AbortController().signal,
    })
    const zenith = await start('zenith')
    const argo = await start('argo')
    await expect.poll(() => entered).toBe(2)
    try { await page.getByText('Zenith, Review zenith', { exact: true }).waitFor({ timeout: 5000 }) } catch (error) {
      throw new Error(JSON.stringify({ errors: tripwire.pageErrors, body: await page.locator('body').innerText() }), { cause: error })
    }
    await page.getByText('Argo, Review argo', { exact: true }).waitFor()
    const argoStart = page.locator(`[data-team-sender-id="${argo.member.id}"]`).filter({ hasText: 'Kira, buscaré las fuentes de Argo' })
    await argoStart.waitFor()
    expect(await argoStart.locator('img').count()).toBeGreaterThan(0)
    await page.screenshot({ path: '/tmp/phoenix-team-real-handoff.png', fullPage: true })
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
    const humanMessage = transcript.messages.find(row => row.text === 'USER_TEAM_MISSION')!
    await scaffold.ctx.agentTeams.reactToChat(lead, { sessionId: lead.id, messageId: humanMessage.id, emoji: '❤️', active: true })
    const livePulse = page.waitForFunction(id => document.querySelector(`[data-team-reactions="${id}"]`)
      ?.querySelector('button[title="Argo"]')?.getAnimations().some(animation => animation.playState === 'running'), humanMessage.id)
    await scaffold.ctx.agentTeams.reactToChat(actualArgo, { sessionId: lead.id, messageId: humanMessage.id, emoji: '👍', active: true })
    await livePulse
    const humanActions = page.locator(`[data-team-reactions="${humanMessage.id}"]`)
    await humanActions.locator('button[title="Kira"]').waitFor()
    await humanActions.locator('button[title="Argo"]').waitFor()
    expect(await humanActions.getAttribute('data-author-kind')).toBe('user')
    expect(await humanActions.evaluate(element => getComputedStyle(element).justifyContent)).toBe('flex-end')
    for (const row of [zenithRow, argoRow]) {
      const size = await row.locator('img').first().boundingBox()
      expect(size!.width).toBeGreaterThanOrEqual(24)
    }
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
    const humanReply = (await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(row => row.text === '@Zenith @Argo USER_FOCUS_12')!
    const replyBubble = await page.locator('[data-team-sender-id="user"]').filter({ hasText: 'USER_FOCUS_12' }).locator('[class*="bubble"]').boundingBox()
    const replyReaction = await page.locator(`[data-team-reactions="${humanReply.id}"]`).getByRole('button', { name: 'Add reaction', exact: true }).boundingBox()
    expect(Math.abs(replyReaction!.x - replyBubble!.x)).toBeLessThan(8)
    await page.reload()
    await zenithRow.waitFor()
    await argoRow.waitFor()
    await peerRow.waitFor()
    await expect.poll(() => actions.getByRole('button', { name: '👍 · User', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-team-sender-id="user"]').filter({ hasText: 'USER_FOCUS_12' }).count()).toBe(1)
    expect(adapter.requests).toHaveLength(calls)
    await humanActions.locator('button[title="Kira"]').waitFor()
    await humanActions.locator('button[title="Argo"]').waitFor()
    await expect.poll(() => humanActions.locator('button[title="Argo"]').evaluate(button => button.getAnimations().length)).toBe(0)
    await page.setViewportSize({ width: 600, height: 900 })
    await expect.poll(async () => await page.evaluate((id) => {
      const bubble = document.querySelector(`[data-kira-team-message="${id}"] [class*="bubble"]`)!.getBoundingClientRect()
      const action = document.querySelector(`[data-team-reactions="${id}"] button`)!.getBoundingClientRect()
      return Math.abs(action.left - bubble.left)
    }, humanReply.id)).toBeLessThan(8)
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.screenshot({ path: '/tmp/phoenix-kira-team-chat.png', fullPage: true })
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
  it('answers the addressed user before resuming real child work without a second turn or duplicate answers', async () => {
    const lead = scaffold.ctx.agents.list().find(agent => agent.session.header.origin !== 'subagent')
    if (lead === undefined) throw new Error('real main session is not active')
    const transcript = await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })
    const request = transcript.messages.find(row => row.text === '@Zenith @Argo USER_FOCUS_12')
    if (request === undefined) throw new Error('the real composer did not persist its directed request')
    const children = (request.deliveries ?? []).map(delivery => scaffold.ctx.sessions.get(delivery.targetId as never))
    if (children.length !== 2 || children.some(child => child === undefined)) throw new Error('the request has no two real targets')
    release.resolve(undefined)
    for (const name of ['ZENITH', 'ARGO']) {
      await page.getByText(`${name}_CONTEXTUAL_REPLY`, { exact: true }).waitFor()
      await page.getByText(`${name}_MISSION_CONTINUED`, { exact: true }).waitFor()
    }
    const finished = await scaffold.ctx.agentTeams.chatMessages({ sessionId: lead.id })
    for (const child of children) {
      if (child === undefined) throw new Error('target child disappeared')
      await expect.poll(() => scaffold.ctx.agents.get(child.id)).toBeUndefined()
      const answer = finished.messages.find(row => row.id === `${child.id}:answer:${request.id}`)
      expect(answer).toMatchObject({ senderId: child.id, replyTo: request.id })
      expect(child.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(child.events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
      const answerCall = child.events.find(event => event.type === 'tool/call' && event.data.name === 'team_chat_answer')
      const continuedCall = child.events.find(event => event.type === 'tool/call' && event.data.name === 'team_test_continue')
      if (answerCall === undefined || continuedCall === undefined) throw new Error('the real tool pipeline did not answer and continue')
      expect(answerCall.seq).toBeLessThan(continuedCall.seq)
      expect(await readFile(join(scaffold.workspaceCwd, `${child.id}.resume.txt`), 'utf8')).toBe('mission resumed after the user answer')
      expect(finished.messages.filter(row => row.id === answer!.id)).toHaveLength(1)
    }
    await page.reload()
    for (const name of ['ZENITH', 'ARGO']) {
      await page.getByText(`${name}_CONTEXTUAL_REPLY`, { exact: true }).waitFor()
      expect(await page.getByText(`${name}_CONTEXTUAL_REPLY`, { exact: true }).count()).toBe(1)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
})
