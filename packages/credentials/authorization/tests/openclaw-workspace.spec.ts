import type { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationSession } from '../src/index.ts'
import {
  authorizeGoogleWithOpenClaw,
  openClawInternals,
  registerOpenClawGithubAuthorization,
  requestGoogleWithOpenClaw,
} from '../src/openclaw-workspace.ts'

const originalRun = openClawInternals.run

afterEach(() => {
  openClawInternals.run = originalRun
})

function result(stdout = ''): Promise<{ stdout: string; stderr: string }> {
  return Promise.resolve({ stdout, stderr: '' })
}

function session(overrides: Partial<AuthorizationSession> = {}): AuthorizationSession {
  return {
    method: 'oauth',
    signal: new AbortController().signal,
    notify: vi.fn(),
    prompt: vi.fn(async () => ''),
    ...overrides,
  } as unknown as AuthorizationSession
}

describe('OpenClaw Workspace authorization bridge', () => {
  it('reuses an already verified gog account instead of starting a second Google OAuth flow', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    openClawInternals.run = async (command, args) => {
      calls.push({ command, args })
      if (command === 'gog' && args[0] === '--version') return result('gog 0.43.0')
      if (command === 'gog' && args[0] === 'auth' && args[1] === 'list') {
        return result(JSON.stringify({ accounts: [{ email: 'owner@example.com', valid: true }] }))
      }
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    }

    const activeSession = session()
    await expect(authorizeGoogleWithOpenClaw(activeSession)).resolves.toBe('owner@example.com')
    expect(activeSession.prompt).not.toHaveBeenCalled()
    expect(calls.some(call => call.args.includes('add'))).toBe(false)
  })

  it('routes the existing Gmail search broker contract through gog without changing the model tool schema', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = []
    openClawInternals.run = async (command, args) => {
      calls.push({ command, args })
      return result(JSON.stringify({ messages: [{ id: 'm1' }] }))
    }

    const response = await requestGoogleWithOpenClaw('owner@example.com', {
      service: 'gmail',
      path: 'users/me/messages?q=is%3Aunread&maxResults=5',
    })

    expect(response?.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      command: 'gog',
      args: expect.arrayContaining([
        'gmail', 'messages', 'search', 'is:unread',
        '--max', '5',
        '--account', 'owner@example.com',
        '--json', '--no-input',
      ]),
    })
  })

  it('routes Docs, Sheets, Slides and Contacts reads through their official gog surfaces', async () => {
    const calls: string[][] = []
    openClawInternals.run = async (_command, args) => {
      calls.push([...args])
      return result('{}')
    }

    await requestGoogleWithOpenClaw('owner@example.com', {
      service: 'docs',
      path: 'documents/doc-1',
    })
    await requestGoogleWithOpenClaw('owner@example.com', {
      service: 'sheets',
      path: 'spreadsheets/sheet-1/values/Sheet1%21A1%3AD20',
    })
    await requestGoogleWithOpenClaw('owner@example.com', {
      service: 'slides',
      path: 'presentations/deck-1',
    })
    await requestGoogleWithOpenClaw('owner@example.com', {
      service: 'contacts',
      path: 'people:searchContacts?query=Alice',
    })

    expect(calls[0]?.slice(0, 3)).toEqual(['docs', 'cat', 'doc-1'])
    expect(calls[1]?.slice(0, 4)).toEqual(['sheets', 'get', 'sheet-1', 'Sheet1!A1:D20'])
    expect(calls[2]?.slice(0, 3)).toEqual(['slides', 'raw', 'deck-1'])
    expect(calls[3]?.slice(0, 3)).toEqual(['contacts', 'search', 'Alice'])
  })

  it('runs GitHub device auth through gh and stores only a PHOENIX adoption marker', async () => {
    let flow: {
      run(session: AuthorizationSession): Promise<void>
      inspect(signal?: AbortSignal): Promise<unknown>
    } | undefined
    const records = new Map<string, unknown>()
    const ctx = {
      authorization: {
        registerFlow(candidate: unknown) {
          flow = candidate as typeof flow
          return () => {}
        },
      },
      credentials: {
        readRecord(key: unknown) {
          return Promise.resolve(records.get(String(key)))
        },
        modifyRecord(key: unknown, updater: () => Promise<unknown>) {
          return updater().then((value) => {
            records.set(String(key), value)
          })
        },
        deleteRecord(key: unknown) {
          records.delete(String(key))
          return Promise.resolve()
        },
      },
    } as unknown as Context

    registerOpenClawGithubAuthorization(ctx)
    expect(flow).toBeDefined()

    let loggedIn = false
    openClawInternals.run = async (command, args, options) => {
      if (command !== 'gh') throw new Error('unexpected binary')
      if (args[0] === '--version') return result('gh version 2')
      if (args[0] === 'api') {
        if (!loggedIn) throw new Error('not logged in')
        return result('arisnachy\n')
      }
      if (args[0] === 'auth' && args[1] === 'login') {
        options?.onOutput?.('First copy your one-time code: ABCD-EFGH')
        loggedIn = true
        return result('')
      }
      throw new Error(`unexpected gh args: ${args.join(' ')}`)
    }

    const notify = vi.fn()
    await flow?.run(session({ notify }))
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://github.com/login/device',
    }))
    await expect(flow?.inspect()).resolves.toEqual(expect.objectContaining({
      kind: 'account',
      provider: 'GitHub',
      accountType: 'openclaw-gh',
    }))
  })
})
