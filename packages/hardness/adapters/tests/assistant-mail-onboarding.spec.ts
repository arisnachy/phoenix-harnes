import { SessionId } from '@phoenix-ai/dsh-session'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MailOnboarding } from '../src/assistant-mail-onboarding.ts'

function requestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
  return JSON.parse(init.body) as unknown
}
function requestAddress(url: Parameters<typeof fetch>[0]): string {
  return typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
}

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
  it('recovers the existing mailbox after an ambiguous provider result', async () => {
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

      const second = await account.recover()
      expect(second).toMatchObject({
        state: 'pending-verification',
        inboxId: 'second@agentmail.to',
      })
      expect(key).toBe('second-secret')
      expect(calls).toBe(2)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('resends pending verification through agent human without rotating a valid key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-resend-owner-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'pending-verification',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@example.com',
        contacts: [],
        signupUsername: 'kira-original',
      }))
      const saveKey = vi.fn()
      const requests: string[] = []
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey,
        resolveKey: async () => 'am_valid',
        fetch: async (url, init) => {
          requests.push(requestAddress(url))
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_valid')
          expect(requestBody(init)).toEqual({ human_email: 'owner@example.com' })
          return Response.json({ human_email: 'owner@example.com', instructions: 'Enter the OTP.' })
        },
      })

      await expect(account.recover()).resolves.toMatchObject({
        state: 'pending-verification',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@example.com',
      })
      expect(requests).toEqual(['https://api.agentmail.to/v0/agent/human'])
      expect(saveKey).not.toHaveBeenCalled()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('repairs a mistyped pending owner through agent human and keeps the same inbox', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-owner-repair-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'pending-verification',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@gmail.comy',
        contacts: ['trusted@example.com'],
      }))
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey: async () => {},
        resolveKey: async () => 'am_valid',
        fetch: async (url, init) => {
          expect(requestAddress(url)).toBe('https://api.agentmail.to/v0/agent/human')
          expect(requestBody(init)).toEqual({ human_email: 'owner@gmail.com' })
          return Response.json({ human_email: 'owner@gmail.com', instructions: 'Enter the OTP.' })
        },
      })

      await expect(account.changeOwner('owner@gmail.com')).resolves.toMatchObject({
        state: 'pending-verification',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@gmail.com',
        contacts: ['trusted@example.com'],
      })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('falls back to a fresh corrected owner enrollment when the pending key gets a bare 403', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-owner-403-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'pending-verification',
        inboxId: 'old@agentmail.to',
        ownerEmail: 'owner@example.comy',
        contacts: [],
      }))
      let saved = ''
      let calls = 0
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey: async (value) => { saved = value },
        resolveKey: async () => 'am_stale',
        fetch: async (url, init) => {
          calls++
          const address = requestAddress(url)
          if (address.endsWith('/agent/human')) {
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_stale')
            return Response.json({ message: 'Forbidden' }, { status: 403 })
          }
          expect(address).toBe('https://api.agentmail.to/v0/agent/sign-up')
          expect(requestBody(init)).toMatchObject({ human_email: 'owner@example.com' })
          return Response.json({ api_key: 'am_fresh', inbox_id: 'fresh@agentmail.to' })
        },
      })

      await expect(account.changeOwner('owner@example.com')).resolves.toMatchObject({
        state: 'pending-verification',
        inboxId: 'fresh@agentmail.to',
        ownerEmail: 'owner@example.com',
      })
      expect(saved).toBe('am_fresh')
      expect(calls).toBe(2)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('starts a corrected owner enrollment when an ambiguous signup has no recoverable key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-owner-restart-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'signup-ambiguous',
        ownerEmail: 'owner@gmail.comy',
        contacts: ['trusted@example.com'],
        sessionId: 'workspace-1',
      }))
      let saved = ''
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey: async (value) => { saved = value },
        resolveKey: async () => undefined,
        fetch: async (_url, init) => {
          expect(requestBody(init)).toMatchObject({ human_email: 'owner@gmail.com' })
          return Response.json({ api_key: 'am_corrected', inbox_id: 'fresh@agentmail.to' })
        },
      })

      await expect(account.changeOwner('owner@gmail.com')).resolves.toMatchObject({
        state: 'pending-verification',
        inboxId: 'fresh@agentmail.to',
        ownerEmail: 'owner@gmail.com',
        contacts: ['trusted@example.com'],
        sessionId: 'workspace-1',
      })
      expect(saved).toBe('am_corrected')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('rotates a rejected key for an already verified mailbox and proves the exact inbox before keeping ready state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-restore-key-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'ready',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@example.com',
        contacts: ['trusted@example.com'],
        signupUsername: 'kira-original',
      }))
      let saved = ''
      const requests: string[] = []
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey: async (value) => { saved = value },
        fetch: async (url, init) => {
          const address = requestAddress(url)
          requests.push(address)
          if (address.endsWith('/agent/sign-up')) {
            expect(requestBody(init)).toMatchObject({
              human_email: 'owner@example.com',
              username: 'kira-original',
              source: 'phoenix-local',
            })
            return Response.json({ api_key: 'am_rotated', inbox_id: 'kira-original@agentmail.to' })
          }
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_rotated')
          return Response.json({ inbox_id: 'kira-existing@agentmail.to' })
        },
      })

      await expect(account.restoreCredential()).resolves.toMatchObject({
        state: 'ready',
        inboxId: 'kira-existing@agentmail.to',
        ownerEmail: 'owner@example.com',
        contacts: ['trusted@example.com'],
      })
      expect(saved).toBe('am_rotated')
      expect(requests).toEqual([
        'https://api.agentmail.to/v0/agent/sign-up',
        'https://api.agentmail.to/v0/inboxes/kira-existing%40agentmail.to',
      ])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('adopts the provider signup inbox when the persisted verified inbox was deleted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-restore-stale-inbox-'))
    try {
      const path = join(directory, 'account.json')
      await writeFile(path, JSON.stringify({
        state: 'ready',
        inboxId: 'deleted@agentmail.to',
        ownerEmail: 'owner@example.com',
        contacts: [],
        signupUsername: 'kira-original',
      }))
      const account = new MailOnboarding({
        path,
        timeoutMs: 1000,
        saveKey: async () => {},
        fetch: async (url) => {
          const address = requestAddress(url)
          if (address.endsWith('/agent/sign-up')) {
            return Response.json({ api_key: 'am_rotated', inbox_id: 'current@agentmail.to' })
          }
          if (address.endsWith('/inboxes/deleted%40agentmail.to')) {
            return Response.json({ code: 'not_found' }, { status: 404 })
          }
          if (address.endsWith('/inboxes/current%40agentmail.to')) {
            return Response.json({ inbox_id: 'current@agentmail.to' })
          }
          throw new Error(`unexpected request: ${address}`)
        },
      })

      await expect(account.restoreCredential()).resolves.toMatchObject({
        state: 'ready',
        inboxId: 'current@agentmail.to',
        ownerEmail: 'owner@example.com',
      })
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


it('keeps a confirmed signup rejection retryable instead of labelling it a lost confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-rejected-'))
  try {
    const account = new MailOnboarding({ path: join(directory, 'account.json'), timeoutMs: 1000, saveKey: async () => {}, fetch: async () => Response.json({ error: 'private provider details' }, { status: 400 }) })
    await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('400')
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('recovers the same persisted owner through official signup without a manually supplied key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-recover-'))
  try {
    const path = join(directory, 'account.json')
    let calls = 0
    let saved = 0
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => { saved++ }, fetch: async (_url, init) => {
      calls++
      if (calls === 1) throw new Error('lost response')
      const request: unknown = requestBody(init)
      expect(request).toMatchObject({ human_email: 'owner@example.com', username: 'kira-original' })
      return Response.json({ api_key: 'new-test-key', inbox_id: 'existing@agentmail.to' })
    } })
    await expect(account.signup('owner@example.com', 'kira-original')).rejects.toThrow('ambiguous')
    await account.configure(['contact@example.com'], SessionId('original-workspace'))
    await expect(account.signup('someone-else@example.com', 'kira-other')).rejects.toThrow('existing')
    const recover = account as unknown as { recover(): Promise<unknown> }
    await expect(recover.recover()).resolves.toMatchObject({ state: 'pending-verification', ownerEmail: 'owner@example.com', inboxId: 'existing@agentmail.to', contacts: ['contact@example.com'], sessionId: 'original-workspace' })
    expect(saved).toBe(1)
    expect(calls).toBe(2)
    expect(JSON.stringify(await account.status())).not.toContain('new-test-key')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('creates a separate inbox while retaining the verified owner, contacts and workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-new-inbox-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: ['contact@example.com'], sessionId: 'original-workspace' }))
    let calls = 0
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async (url, init) => {
      expect(requestAddress(url)).toBe('https://api.agentmail.to/v0/inboxes')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-secret')
      const request = requestBody(init) as { username: string; client_id: string }
      calls++
      return Response.json({ inbox_id: `${request.username}@agentmail.to`, client_id: request.client_id })
    } })
    const result = await account.createInbox()
    expect(result).toMatchObject({ state: 'ready', ownerEmail: 'owner@example.com', contacts: ['contact@example.com'], sessionId: 'original-workspace' })
    expect(result.inboxId).not.toBe('original@agentmail.to')
    expect(calls).toBe(1)
    expect(JSON.stringify(result)).not.toMatch(/clientId|newInboxRequest|test-secret/u)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('reconciles an uncertain inbox creation after restart without repeating POST', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-inbox-reconcile-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    let request: { username: string; client_id: string } | undefined
    const options = { path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(request).toBeUndefined()
        request = requestBody(init) as typeof request
        throw new Error('provider created inbox but response was lost')
      }
      expect(requestAddress(url)).toContain(`${request!.username}%40agentmail.to`)
      return Response.json({ inbox_id: `${request!.username}@agentmail.to`, client_id: request!.client_id })
    } }
    const account = new MailOnboarding(options)
    await expect(account.createInbox()).rejects.toThrow('ambiguous')
    expect((await account.status()).inboxId).toBe('original@agentmail.to')
    const restarted = new MailOnboarding(options)
    expect((await restarted.createInbox()).inboxId).toBe(`${request!.username}@agentmail.to`)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('keeps the existing inbox when a response belongs to another creation request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-inbox-mismatch-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async () => Response.json({ inbox_id: 'someone-else@agentmail.to', client_id: 'different-request' }) })
    await expect(account.createInbox()).rejects.toThrow('identity')
    expect((await account.status()).inboxId).toBe('original@agentmail.to')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('serializes connection and recovery while a provider request is in flight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-enrollment-lock-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'signup-ambiguous', ownerEmail: 'owner@example.com', contacts: [] }))
    let respond!: (response: Response) => void
    let announce!: () => void
    const started = new Promise<void>((resolve) => { announce = resolve })
    const response = new Promise<Response>((resolve) => { respond = resolve })
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, fetch: async (_url, init) => {
      if (init?.method === 'POST') return Response.json({})
      announce()
      return response
    } })
    const connecting = account.connect('owner@example.com', 'original@agentmail.to', 'test-secret')
    await started
    await expect(account.recover()).rejects.toThrow('in progress')
    respond(Response.json({ inbox_id: 'original@agentmail.to' }))
    await connecting
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('retries a confirmed absent inbox with the same address and client identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-inbox-absent-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    const requests: Array<{ username: string; client_id: string }> = []
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async (_url, init) => {
      if (init?.method !== 'POST') return Response.json({}, { status: 404 })
      const request = requestBody(init) as { username: string; client_id: string }
      requests.push(request)
      if (requests.length === 1) throw new Error('request did not reach provider')
      return Response.json({ inbox_id: `${request.username}@agentmail.to`, client_id: request.client_id })
    } })
    await expect(account.createInbox()).rejects.toThrow('ambiguous')
    expect((await account.createInbox()).inboxId).toBe(`${requests[0]!.username}@agentmail.to`)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('recovers missing access to a previously verified mailbox through its persisted owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-ready-recover-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    let key = ''
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async (value) => { key = value }, fetch: async (_url, init) => {
      expect(requestBody(init)).toMatchObject({ human_email: 'owner@example.com' })
      return Response.json({ api_key: 'rotated-test-secret', inbox_id: 'original@agentmail.to' })
    } })
    expect(await account.recover()).toMatchObject({ state: 'pending-verification', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com' })
    expect(key).toBe('rotated-test-secret')
  } finally { await rm(directory, { recursive: true, force: true }) }
})


it('deletes a reachable old inbox and clears the enrollment so signup can start again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-discard-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'old@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    const requests: { url: string; method?: string }[] = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async () => {},
      resolveKey: async () => 'test-secret',
      fetch: async (url, init) => {
        requests.push({ url: requestAddress(url), ...(init?.method === undefined ? {} : { method: init.method }) })
        if (init?.method === 'DELETE') return new Response(null, { status: 204 })
        return Response.json({ api_key: 'new-secret', inbox_id: 'new@agentmail.to' })
      },
    })
    await expect(account.discard()).resolves.toMatchObject({ state: 'not-configured', contacts: [] })
    expect(requests[0]).toEqual({ url: 'https://api.agentmail.to/v0/inboxes/old%40agentmail.to', method: 'DELETE' })
    await expect(account.signup('owner@example.com', 'kira-new')).resolves.toMatchObject({ state: 'pending-verification', inboxId: 'new@agentmail.to' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('clears an unrecoverable local enrollment even when its credential is already gone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-discard-lost-key-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'signup-ambiguous', ownerEmail: 'owner@example.com', contacts: [] }))
    const fetch = vi.fn()
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => undefined, fetch })
    await expect(account.discard()).resolves.toMatchObject({ state: 'not-configured', contacts: [] })
    expect(fetch).not.toHaveBeenCalled()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
