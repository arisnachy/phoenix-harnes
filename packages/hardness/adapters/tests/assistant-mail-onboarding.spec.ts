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


it('falls back from owner-bound signup 403 to receive-only signup and attaches the human', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-signup-403-fallback-'))
  try {
    const path = join(directory, 'account.json')
    let saved = ''
    const requests: Array<{ url: string; body: unknown; auth: string | null }> = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => saved || undefined,
      fetch: async (url, init) => {
        const address = requestAddress(url)
        const body = requestBody(init)
        requests.push({ url: address, body, auth: new Headers(init?.headers).get('Authorization') })
        if (requests.length === 1) {
          expect(body).toMatchObject({ human_email: 'owner@example.com', username: 'kira-local' })
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
        if (requests.length === 2) {
          expect(body).toEqual({ username: 'kira-local' })
          return Response.json({ api_key: 'am_receive_only', inbox_id: 'kira-local@agentmail.to' })
        }
        expect(address).toBe('https://api.agentmail.to/v0/agent/human')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_receive_only')
        expect(body).toEqual({ human_email: 'owner@example.com' })
        return Response.json({ human_email: 'owner@example.com', instructions: 'Enter the OTP.' })
      },
    })

    await expect(account.signup('owner@example.com', 'kira-local')).resolves.toMatchObject({
      state: 'pending-verification',
      ownerEmail: 'owner@example.com',
      inboxId: 'kira-local@agentmail.to',
    })
    expect(saved).toBe('am_receive_only')
    expect(requests).toHaveLength(3)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('returns the receive-only inbox when human attachment is temporarily rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-signup-403-attach-fails-'))
  try {
    const path = join(directory, 'account.json')
    let saved = ''
    let calls = 0
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => saved || undefined,
      fetch: async (_url, init) => {
        calls++
        if (calls === 1) return Response.json({ code: 'forbidden', message: 'Forbidden' }, { status: 403 })
        if (calls === 2) return Response.json({ api_key: 'am_receive_only', inbox_id: 'kira-fallback@agentmail.to' })
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_receive_only')
        return Response.json({ code: 'missing_permission', message: 'Forbidden' }, { status: 403 })
      },
    })

    await expect(account.signup('owner@example.com', 'kira-fallback')).resolves.toMatchObject({
      state: 'pending-verification',
      ownerEmail: 'owner@example.com',
      inboxId: 'kira-fallback@agentmail.to',
    })
    expect(saved).toBe('am_receive_only')
    expect(calls).toBe(3)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('rejects a mismatched human identity after the receive-only fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-fallback-owner-mismatch-'))
  try {
    let calls = 0
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async () => {
        calls++
        if (calls === 1) return Response.json({ message: 'Forbidden' }, { status: 403 })
        if (calls === 2) return Response.json({ api_key: 'am_receive_only', inbox_id: 'kira-local@agentmail.to' })
        return Response.json({ human_email: 'someone-else@example.com', instructions: 'Enter the OTP.' })
      },
    })
    await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('different human')
    expect((await account.status()).inboxId).toBe('kira-local@agentmail.to')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('does not bypass an explicit AgentMail quota 403 with another signup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-signup-quota-'))
  try {
    let calls = 0
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async () => {
        calls++
        return Response.json({ code: 'limit_exceeded', message: 'Forbidden', fix: 'Delete an old inbox.' }, { status: 403 })
      },
    })
    await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('limit')
    expect(calls).toBe(1)
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('restores the previous state when the receive-only fallback gets a confirmed rejection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-fallback-rejected-'))
  try {
    let calls = 0
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async () => {
        calls++
        if (calls === 1) return Response.json({ message: 'Forbidden' }, { status: 403 })
        return Response.json({ error: 'invalid username' }, { status: 400 })
      },
    })
    await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('400')
    expect(calls).toBe(2)
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('keeps fallback signup ambiguous when the receive-only response is lost', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-fallback-ambiguous-'))
  try {
    let calls = 0
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async () => {
        calls++
        if (calls === 1) return Response.json({ message: 'Forbidden' }, { status: 403 })
        throw new Error('lost receive-only signup response')
      },
    })
    await expect(account.signup('owner@example.com', 'kira-local')).rejects.toThrow('receive-only')
    expect(calls).toBe(2)
    expect((await account.status()).state).toBe('signup-ambiguous')
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
      const request = requestBody(init) as { username: string; client_id?: string }
      calls++
      return Response.json({ inbox_id: `${request.username}@agentmail.to` })
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
    let request: { username: string; client_id?: string } | undefined
    const options = { path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(request).toBeUndefined()
        request = requestBody(init) as typeof request
        throw new Error('provider created inbox but response was lost')
      }
      expect(requestAddress(url)).toContain(`${request!.username}%40agentmail.to`)
      return Response.json({ inbox_id: `${request!.username}@agentmail.to` })
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

it('retries a confirmed absent inbox with the same address without duplicating it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-inbox-absent-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    const requests: Array<{ username: string; client_id?: string }> = []
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async () => {}, resolveKey: async () => 'test-secret', fetch: async (_url, init) => {
      if (init?.method !== 'POST') return Response.json({}, { status: 404 })
      const request = requestBody(init) as { username: string; client_id?: string }
      requests.push(request)
      if (requests.length === 1) throw new Error('request did not reach provider')
      return Response.json({ inbox_id: `${request.username}@agentmail.to` })
    } })
    await expect(account.createInbox()).rejects.toThrow('ambiguous')
    expect((await account.createInbox()).inboxId).toBe(`${requests[0]!.username}@agentmail.to`)
    expect(requests).toHaveLength(2)
    expect(requests[0]?.client_id).toBeUndefined()
    expect(requests[1]).toEqual(requests[0])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('recovers missing access to a previously verified mailbox without demoting verified state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-ready-recover-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }))
    let key = ''
    const account = new MailOnboarding({ path, timeoutMs: 1000, saveKey: async (value) => { key = value }, fetch: async (url, init) => {
      const address = requestAddress(url)
      if (address.endsWith('/agent/sign-up')) {
        expect(requestBody(init)).toMatchObject({ human_email: 'owner@example.com' })
        return Response.json({ api_key: 'rotated-test-secret', inbox_id: 'original@agentmail.to' })
      }
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer rotated-test-secret')
      return Response.json({ inbox_id: 'original@agentmail.to' })
    } })
    expect(await account.recover()).toMatchObject({ state: 'ready', inboxId: 'original@agentmail.to', ownerEmail: 'owner@example.com' })
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

it('keeps one receive-only inbox when AgentMail refuses the owner link', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-owner-link-conflict-'))
  try {
    const path = join(directory, 'account.json')
    let saved = ''
    let calls = 0
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => saved || undefined,
      fetch: async (url, init) => {
        calls++
        const address = requestAddress(url)
        if (calls === 1) {
          expect(address).toBe('https://api.agentmail.to/v0/agent/sign-up')
          expect(requestBody(init)).toMatchObject({ human_email: 'owner@example.com' })
          return Response.json({ message: 'Forbidden' }, { status: 403 })
        }
        if (calls === 2) {
          expect(address).toBe('https://api.agentmail.to/v0/agent/sign-up')
          expect(requestBody(init)).toEqual({ username: 'kira-local' })
          return Response.json({ api_key: 'am_receive_only', inbox_id: 'kira-local@agentmail.to' })
        }
        expect(address).toBe('https://api.agentmail.to/v0/agent/human')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_receive_only')
        return Response.json({ code: 'human_account_conflict' }, { status: 409 })
      },
    })

    await expect(account.signup('owner@example.com', 'kira-local')).resolves.toMatchObject({
      state: 'pending-verification',
      ownerEmail: 'owner@example.com',
      ownerLink: 'provider-conflict',
      inboxId: 'kira-local@agentmail.to',
    })
    await expect(account.recover()).resolves.toMatchObject({
      state: 'pending-verification',
      ownerLink: 'provider-conflict',
      inboxId: 'kira-local@agentmail.to',
    })
    expect(saved).toBe('am_receive_only')
    expect(calls).toBe(4)
  } finally { await rm(directory, { recursive: true, force: true }) }
})


it('marks a receive-only mailbox ready after Console claim ownership becomes visible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-claim-confirm-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'pending-verification',
      inboxId: 'kira@agentmail.to',
      ownerEmail: 'owner@example.com',
      ownerLink: 'provider-conflict',
      signupUsername: 'kira',
      contacts: [],
    }))
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async () => {},
      resolveKey: async () => 'am_us_saved',
      fetch: async (url, init) => {
        expect(requestAddress(url)).toBe('https://api.agentmail.to/v0/organizations')
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_us_saved')
        return Response.json({
          organization_id: 'org_1',
          authentication_id: 'user_1',
          authentication_type: 'clerk',
        })
      },
    })

    await expect(account.confirmClaim()).resolves.toMatchObject({
      state: 'ready',
      inboxId: 'kira@agentmail.to',
      ownerEmail: 'owner@example.com',
      ownerLink: 'attached',
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('keeps the mailbox pending until AgentMail exposes Console ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-claim-wait-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'pending-verification',
      inboxId: 'kira@agentmail.to',
      ownerEmail: 'owner@example.com',
      ownerLink: 'provider-conflict',
      contacts: [],
    }))
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async () => {},
      resolveKey: async () => 'am_us_saved',
      fetch: async () => Response.json({ organization_id: 'org_1' }),
    })

    await expect(account.confirmClaim()).rejects.toThrow('finish Claim inbox')
    expect(await account.status()).toMatchObject({
      state: 'pending-verification',
      ownerLink: 'provider-conflict',
      inboxId: 'kira@agentmail.to',
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('corroborates a human Console API key without storing it or creating an inbox', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-check-'))
  try {
    let saved = ''
    const requests: string[] = []
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      fetch: async (url, init) => {
        const address = requestAddress(url)
        requests.push(address)
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer am_us_console_key')
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            authentication_type: 'clerk',
            inbox_count: 1,
            inbox_limit: 3,
          })
        }
        expect(address).toBe('https://api.agentmail.to/v0/inboxes')
        return Response.json({ count: 1, inboxes: [], limit: 1 })
      },
    })

    await expect(account.inspectConsoleKey('am_us_console_key')).resolves.toEqual({
      valid: true,
      organizationId: 'org_human',
      authenticationType: 'clerk',
      inboxCount: 1,
      inboxLimit: 3,
      capacityAvailable: true,
      inboxRead: true,
    })
    expect(saved).toBe('')
    expect(requests).toEqual([
      'https://api.agentmail.to/v0/organizations',
      'https://api.agentmail.to/v0/inboxes',
    ])
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('reports an otherwise valid Console key that lacks inbox_read without mutating state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-check-read-'))
  try {
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async (url) => {
        const address = requestAddress(url)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            inbox_count: 2,
            inbox_limit: 3,
          })
        }
        return Response.json({
          code: 'missing_permission',
          fix: "This API key does not have the 'inbox_read' permission.",
        }, { status: 403 })
      },
    })

    await expect(account.inspectConsoleKey('am_us_restricted')).resolves.toMatchObject({
      valid: true,
      inboxRead: false,
      capacityAvailable: true,
    })
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('corroborates a replacement key against Kira current inbox and message access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-check-ready-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'ready',
      inboxId: 'kira-current@agentmail.to',
      ownerEmail: 'owner@example.com',
      contacts: [],
    }))
    const requests: string[] = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async () => {},
      fetch: async (url) => {
        const address = requestAddress(url)
        requests.push(address)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            inbox_count: 3,
            inbox_limit: 3,
          })
        }
        if (address.endsWith('/inboxes')) return Response.json({ count: 1, inboxes: [], limit: 1 })
        if (address.endsWith('/inboxes/kira-current%40agentmail.to')) {
          return Response.json({ inbox_id: 'kira-current@agentmail.to' })
        }
        if (address.includes('/inboxes/kira-current%40agentmail.to/messages?')) {
          return Response.json({ messages: [] })
        }
        throw new Error(`unexpected request: ${address}`)
      },
    })

    await expect(account.inspectConsoleKey('am_us_replacement')).resolves.toMatchObject({
      valid: true,
      inboxCount: 3,
      inboxLimit: 3,
      capacityAvailable: false,
      inboxRead: true,
      currentInboxAccess: true,
      messageRead: true,
    })
    expect(requests).toHaveLength(4)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('migrates a ready stale agent-signup inbox to an existing Console Kira inbox without agent signup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-migrate-ready-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'ready',
      inboxId: 'old-agent-org@agentmail.to',
      ownerEmail: 'owner@example.com',
      contacts: ['trusted@example.com'],
    }))
    let saved = ''
    const requests: string[] = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => saved || undefined,
      fetch: async (url) => {
        const address = requestAddress(url)
        requests.push(address)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_console',
            authentication_id: 'user_console',
            inbox_count: 1,
            inbox_limit: 3,
          })
        }
        if (address.endsWith('/inboxes/old-agent-org%40agentmail.to')) {
          return Response.json({ code: 'not_found', message: 'Not found' }, { status: 404 })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          return Response.json({
            count: 1,
            limit: 100,
            inboxes: [{ inbox_id: 'kira-console@agentmail.to', email: 'kira-console@agentmail.to', display_name: 'Kira' }],
          })
        }
        if (address.endsWith('/inboxes/kira-console%40agentmail.to')) {
          return Response.json({ inbox_id: 'kira-console@agentmail.to' })
        }
        if (address.includes('/inboxes/kira-console%40agentmail.to/messages?')) {
          return Response.json({ messages: [] })
        }
        throw new Error(`unexpected request: ${address}`)
      },
    })

    await expect(account.adoptConsoleKey('am_console_key')).resolves.toMatchObject({
      state: 'ready',
      inboxId: 'kira-console@agentmail.to',
      ownerEmail: 'owner@example.com',
      contacts: ['trusted@example.com'],
    })
    expect(saved).toBe('am_console_key')
    expect(requests.some(value => value.includes('/agent/sign-up'))).toBe(false)
    expect(requests.some(value => value.includes('/agent/human'))).toBe(false)
    expect(requests.some(value => value === 'https://api.agentmail.to/v0/inboxes')).toBe(false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('rotates a ready Kira mailbox to a corroborated Console key without changing its inbox', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-rotate-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'ready',
      inboxId: 'kira-current@agentmail.to',
      ownerEmail: 'owner@example.com',
      contacts: ['trusted@example.com'],
    }))
    let saved = ''
    const requests: string[] = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      fetch: async (url) => {
        const address = requestAddress(url)
        requests.push(address)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            inbox_count: 3,
            inbox_limit: 3,
          })
        }
        if (address.endsWith('/inboxes/kira-current%40agentmail.to')) {
          return Response.json({ inbox_id: 'kira-current@agentmail.to' })
        }
        if (address.includes('/inboxes/kira-current%40agentmail.to/messages?')) {
          return Response.json({ messages: [] })
        }
        throw new Error(`unexpected request: ${address}`)
      },
    })

    await expect(account.adoptConsoleKey('am_us_replacement')).resolves.toMatchObject({
      state: 'ready',
      inboxId: 'kira-current@agentmail.to',
      ownerEmail: 'owner@example.com',
      contacts: ['trusted@example.com'],
    })
    expect(saved).toBe('am_us_replacement')
    expect(requests).toEqual([
      'https://api.agentmail.to/v0/organizations',
      'https://api.agentmail.to/v0/inboxes/kira-current%40agentmail.to',
      expect.stringContaining('/inboxes/kira-current%40agentmail.to/messages?'),
    ])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('creates the first Kira inbox from a corroborated Console key and explicit Phoenix owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-first-run-'))
  try {
    let saved = ''
    let createdInbox = ''
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      fetch: async (url, init) => {
        const address = requestAddress(url)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            authentication_type: 'clerk',
            inbox_count: 0,
            inbox_limit: 3,
          })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          return Response.json({ count: 0, inboxes: [], limit: 100 })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          const body = requestBody(init) as Record<string, unknown>
          createdInbox = `${String(body.username)}@agentmail.to`
          return Response.json({
            inbox_id: createdInbox,
            email: createdInbox,
                      })
        }
        if (createdInbox.length > 0
          && address === `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(createdInbox)}`) {
          return Response.json({ inbox_id: createdInbox })
        }
        if (address.includes('/messages?')) return Response.json({ messages: [] })
        throw new Error(`unexpected request: ${address}`)
      },
    })

    await expect(account.adoptConsoleKey('am_us_console_key', 'owner@example.com')).resolves.toMatchObject({
      state: 'ready',
      inboxId: createdInbox,
      ownerEmail: 'owner@example.com',
      ownerLink: 'attached',
    })
    expect(saved).toBe('am_us_console_key')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('adopts a human Console API key by creating a fresh inbox in that organization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'pending-verification',
      inboxId: 'old-signup@agentmail.to',
      ownerEmail: 'owner@example.com',
      ownerLink: 'provider-conflict',
      contacts: ['trusted@example.com'],
      sessionId: 'workspace-1',
    }))
    let saved = ''
    let createdInbox = ''
    const requests: Array<{ url: string; auth: string | null; body?: unknown }> = []
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => 'am_us_old_signup_key',
      fetch: async (url, init) => {
        const address = requestAddress(url)
        const auth = new Headers(init?.headers).get('Authorization')
        requests.push({
          url: address,
          auth,
          ...(init?.body === undefined ? {} : { body: requestBody(init) }),
        })
        if (address.endsWith('/organizations')) {
          expect(auth).toBe('Bearer am_us_console_key')
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            authentication_type: 'clerk',
            inbox_count: 1,
            inbox_limit: 3,
          })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          expect(auth).toBe('Bearer am_us_console_key')
          return Response.json({ count: 0, inboxes: [], limit: 100 })
        }
        if (address.includes('/messages?')) {
          expect(auth).toBe('Bearer am_us_console_key')
          return Response.json({ messages: [] })
        }
        if (createdInbox.length > 0 && address === `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(createdInbox)}`) {
          expect(auth).toBe('Bearer am_us_console_key')
          return Response.json({ inbox_id: createdInbox })
        }
        expect(address).toBe('https://api.agentmail.to/v0/inboxes')
        expect(auth).toBe('Bearer am_us_console_key')
        const body = requestBody(init) as Record<string, unknown>
        expect(body.domain).toBe('agentmail.to')
        expect(body.display_name).toBe('Kira')
        expect(typeof body.username).toBe('string')
        expect(body.client_id).toBeUndefined()
        createdInbox = `${String(body.username)}@agentmail.to`
        return Response.json({
          inbox_id: createdInbox,
          email: createdInbox,
                  })
      },
    })

    const result = await account.adoptConsoleKey('am_us_console_key')
    expect(result).toMatchObject({
      state: 'ready',
      ownerEmail: 'owner@example.com',
      ownerLink: 'attached',
      contacts: ['trusted@example.com'],
      sessionId: 'workspace-1',
    })
    expect(result.inboxId).toMatch(/^kira-[a-f0-9]{8}@agentmail\.to$/u)
    expect(result.inboxId).not.toBe('old-signup@agentmail.to')
    expect(saved).toBe('am_us_console_key')
    expect(requests).toHaveLength(5)
    expect(requests[1]?.url).toContain('/inboxes')
    expect(requests[3]?.url).toContain('/inboxes/')
    expect(requests[4]?.url).toContain('/messages?')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('does not require optional organization authentication metadata during a key check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-optional-auth-'))
  try {
    let saved = ''
    const account = new MailOnboarding({
      path: join(directory, 'account.json'),
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      fetch: async (url) => {
        const address = requestAddress(url)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_console',
            inbox_count: 1,
            inbox_limit: 3,
          })
        }
        expect(address).toBe('https://api.agentmail.to/v0/inboxes')
        return Response.json({ count: 1, inboxes: [], limit: 1 })
      },
    })

    await expect(account.inspectConsoleKey('am_us_console_optional_auth')).resolves.toMatchObject({
      valid: true,
      organizationId: 'org_console',
      inboxCount: 1,
      inboxLimit: 3,
      inboxRead: true,
    })
    expect(saved).toBe('')
    expect((await account.status()).state).toBe('not-configured')
  } finally { await rm(directory, { recursive: true, force: true }) }
})


it('reconciles an ambiguous Console-key inbox create without minting a duplicate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-mail-console-key-ambiguous-'))
  try {
    const path = join(directory, 'account.json')
    await writeFile(path, JSON.stringify({
      state: 'pending-verification',
      inboxId: 'old-signup@agentmail.to',
      ownerEmail: 'owner@example.com',
      ownerLink: 'provider-conflict',
      contacts: [],
    }))
    let saved = ''
    let createdUsername = ''
    let creates = 0
    const account = new MailOnboarding({
      path,
      timeoutMs: 1000,
      saveKey: async (value) => { saved = value },
      resolveKey: async () => saved || undefined,
      fetch: async (url, init) => {
        const address = requestAddress(url)
        if (address.endsWith('/organizations')) {
          return Response.json({
            organization_id: 'org_human',
            authentication_id: 'user_human',
            authentication_type: 'clerk',
          })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          return Response.json({ count: 0, inboxes: [], limit: 100 })
        }
        if (address === 'https://api.agentmail.to/v0/inboxes') {
          creates++
          const body = requestBody(init) as Record<string, unknown>
          createdUsername = String(body.username)
          expect(body.client_id).toBeUndefined()
          throw new Error('confirmation lost')
        }
        if (address.includes('/messages?')) return Response.json({ messages: [] })
        expect(address).toBe(`https://api.agentmail.to/v0/inboxes/${createdUsername}%40agentmail.to`)
        return Response.json({
          inbox_id: `${createdUsername}@agentmail.to`,
          email: `${createdUsername}@agentmail.to`,
                  })
      },
    })

    await expect(account.adoptConsoleKey('am_us_console_key')).rejects.toThrow('confirmation is ambiguous')
    expect(saved).toBe('am_us_console_key')
    expect(creates).toBe(1)

    await expect(account.adoptConsoleKey('am_us_console_key')).resolves.toMatchObject({
      state: 'ready',
      inboxId: `${createdUsername}@agentmail.to`,
      ownerLink: 'attached',
    })
    expect(creates).toBe(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
