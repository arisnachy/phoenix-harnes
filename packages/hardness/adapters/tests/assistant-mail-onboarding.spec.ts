import { SessionId } from '@phoenix-ai/dsh-session'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MailOnboarding } from '../src/assistant-mail-onboarding.ts'

describe('mail onboarding', () => {
  it('persists ambiguous signup without retrying or claiming a verified inbox', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
    try {
      let calls = 0
      const options = { path: join(directory, 'account.json'), saveKey: async (_key: string) => {}, fetch: async () => { calls++; throw new Error('unknown result') }, timeoutMs: 1000 }
      const account = new MailOnboarding(options)
      await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('ambiguous')
      const restarted = new MailOnboarding(options)
      expect((await restarted.status()).state).toBe('signup-ambiguous')
      await expect(restarted.signup('owner@example.com', 'kira-local')).rejects.toThrow('existing')
      expect(calls).toBe(1)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('allows a deliberate second mailbox after an ambiguous provider result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
    try {
      let calls = 0
      let key = ''
      const account = new MailOnboarding({
        path: join(directory, 'account.json'),
        timeoutMs: 1000,
        saveKey: async (value) => { key = value },
        resolveKey: async () => key,
        fetch: async () => {
          calls += 1
          if (calls === 1) throw new Error('unknown result')
          return Response.json({ api_key: 'second-secret', inbox_id: 'second@agentmail.to' })
        },
      })
      await expect(account.signup('owner@example.com', 'kira-first')).rejects.toThrow('ambiguous')
      await expect(account.signup('owner@example.com', 'kira-hidden-retry')).rejects.toThrow('existing')
      expect(calls).toBe(1)

      const second = await account.signupAnother('owner@example.com', 'kira-second')
      expect(second).toMatchObject({
        state: 'pending-verification',
        inboxId: 'second@agentmail.to',
      })
      expect(key).toBe('second-secret')
      expect(calls).toBe(2)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('stores the actual inbox and secret, then verifies owner before enabling jobs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
    try {
      let key = ''
      const account = new MailOnboarding({ path: join(directory, 'account.json'), timeoutMs: 1000, saveKey: async (value) => { key = value }, fetch: async url => Response.json((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/verify') ? { verified: true } : { api_key: 'secret', inbox_id: 'actual@agentmail.to' }), resolveKey: async () => key })
      expect((await account.signup('owner@example.com', 'wanted')).state).toBe('pending-verification')
      expect((await account.status()).inboxId).toBe('actual@agentmail.to')
      expect(JSON.stringify(await account.status())).not.toContain('secret')
      expect((await account.verify('123456')).state).toBe('ready')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

it('bounds existing-account verification attempts and never leaks the challenge in status', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-'))
  try {
    let sentCode = ''
    const account = new MailOnboarding({ path: join(directory, 'account.json'), timeoutMs: 1000, saveKey: async () => {}, fetch: async (url, init) => {
      if ((typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).endsWith('/messages/send')) sentCode = ((JSON.parse((init?.body as string)) as { text: string }).text.match(/\d{6}/u)?.[0] ?? '')
      return Response.json({ inbox_id: 'kira@agentmail.to' })
    } })
    await account.connect('owner@example.com', 'kira@agentmail.to', 'secret')
    expect(JSON.stringify(await account.status())).not.toContain('challenge')
    const wrong = sentCode === '111111' ? '222222' : '111111'
    for (let attempt = 0; attempt < 10; attempt++) await expect(account.verify(wrong)).rejects.toThrow('verification')
    await expect(account.verify(sentCode)).rejects.toThrow('expired')
    expect((await account.status()).state).toBe('pending-verification')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('preserves contact revocation and explicit workspace selection during automatic binding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-binding-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'kira@agentmail.to', ownerEmail: 'owner@example.com', contacts: ['revoked@example.com'] }))
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {} })
    await Promise.all([
      account.configure([], SessionId('owner-selected')),
      account.bindSessionIfUnset(SessionId('automatic-root')),
    ])
    expect(await account.status()).toMatchObject({ contacts: [], sessionId: 'owner-selected' })
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'kira@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    await account.bindSessionIfUnset(SessionId('automatic-root'))
    expect(await account.status()).toMatchObject({ contacts: [], sessionId: 'automatic-root' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
