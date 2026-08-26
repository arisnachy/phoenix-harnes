// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import { AuthorizationPanel } from '../src/client/AuthorizationPanel.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `auth-${String(rpc++)}` as never, result: { ok: true, value } }
}

describe('account authorization panel', () => {
  it('offers OAuth separately and begins without collecting an OpenAI password', async () => {
    const begin = vi.fn(() => Promise.resolve(ok({
      attemptId: 'de305d54-75b4-431b-adb2-eb6b9e546014',
      status: 'pending' as const,
    })))
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'llm-pi-ai/openai-codex',
        label: 'ChatGPT (Codex)',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
        inFlight: false,
      }] }))),
      begin,
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(),
      cancel: vi.fn(),
    } as unknown as IApiClient['authorization']

    render(<AuthorizationPanel api={api} t={key => en[key]} onAuthorized={vi.fn()} />)
    const button = await screen.findByRole('button', { name: /Sign in with ChatGPT \(Codex\)/ })
    expect(screen.getByText(/never asks for your OpenAI password/)).toBeTruthy()
    expect(screen.queryByLabelText(/password/i)).toBeNull()

    fireEvent.click(button)
    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'llm-pi-ai/openai-codex', method: 'oauth' })
    })
  })

  it('renders Codex-native connector metadata as graphical cards', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'subagent-codex/account',
        label: 'ChatGPT / Codex',
        methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
        inFlight: false,
        stored: { kind: 'api-key' as const },
        telemetry: {
          kind: 'account' as const,
          provider: 'Codex',
          plan: 'pro',
          primaryLimit: { usedPercent: 22 },
          connectors: [{
            id: 'github',
            name: 'GitHub',
            description: 'Work with repositories and pull requests.',
            iconUrl: 'https://cdn.example.test/github.svg',
            category: 'Developer tools',
            installUrl: 'https://example.test/install/github',
            accessible: true,
            enabled: true,
            installed: true,
            callable: true,
          }],
        },
      }] }))),
      begin: vi.fn(),
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(),
      cancel: vi.fn(),
    } as unknown as IApiClient['authorization']

    render(<AuthorizationPanel api={api} t={key => en[key]} onAuthorized={vi.fn()} />)

    expect(await screen.findByRole('img', { name: 'GitHub' })).toBeTruthy()
    expect(screen.getByText('Codex connectors')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.getByText('Work with repositories and pull requests.')).toBeTruthy()
    expect(screen.getByText('Connected · callable')).toBeTruthy()
    expect(screen.getByText(/78% remaining/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Manage GitHub/ }).getAttribute('href')).toBe('https://example.test/install/github')
  })

  it('renders Google Workspace services from the scopes the account actually granted', async () => {
    const api = {
      list: vi.fn(() => Promise.resolve(ok({ entries: [{
        key: 'authorization-google/account',
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
        stored: { kind: 'api-key' as const },
        telemetry: {
          kind: 'account' as const,
          provider: 'Google Workspace',
          accountType: 'oauth',
          connectors: [
            {
              id: 'gmail',
              name: 'Gmail',
              description: 'Read, organize, draft, and send mail.',
              category: 'Communication',
              accessible: true,
              enabled: true,
              installed: true,
              callable: true,
            },
            {
              id: 'drive',
              name: 'Google Drive',
              description: 'Find, read, create, and manage files.',
              category: 'Storage',
              accessible: true,
              enabled: true,
              installed: false,
              callable: false,
            },
          ],
        },
      }] }))),
      begin: vi.fn(),
      status: vi.fn(() => new Promise(() => undefined)),
      answer: vi.fn(),
      cancel: vi.fn(),
    } as unknown as IApiClient['authorization']

    render(<AuthorizationPanel api={api} t={key => en[key]} onAuthorized={vi.fn()} />)

    expect(await screen.findByText('Google Workspace services')).toBeTruthy()
    expect(screen.getByText('1 of 2 services authorized by this Google account')).toBeTruthy()
    expect(screen.getByText('Gmail')).toBeTruthy()
    expect(screen.getByText('Google Drive')).toBeTruthy()
    expect(screen.getByText('Permission needed')).toBeTruthy()
    expect(screen.queryByText(/access-token|refresh-token/i)).toBeNull()
  })
})