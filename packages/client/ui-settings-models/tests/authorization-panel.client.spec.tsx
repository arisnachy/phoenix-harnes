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
})
