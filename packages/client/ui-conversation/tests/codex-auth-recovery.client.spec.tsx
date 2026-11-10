// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@phoenix-ai/dsh-api-remotes/client'
import { CodexAuthRecovery, isCodexAuthFailure } from '../src/client/chat/CodexAuthRecovery.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Codex missing credential recovery', () => {
  it('recognizes the exact native Codex failure, not unrelated provider failures', () => {
    expect(isCodexAuthFailure('MISSING_CREDENTIAL',
      'Codex did not expose a usable ChatGPT session token. Run "codex login" again.')).toBe(true)
    expect(isCodexAuthFailure('MISSING_CREDENTIAL', 'Another provider needs a key')).toBe(false)
    expect(isCodexAuthFailure('RATE_LIMIT', 'Codex upstream failed')).toBe(false)
  })

  it('opens native ChatGPT authorization only after an explicit user click', async () => {
    const begin = vi.fn(async () => ({
      rpcId: 'codex-1',
      result: { ok: true as const, value: { attemptId: 'native-1', status: 'pending' as const } },
    }))
    const status = vi.fn(() => new Promise<never>(() => undefined))
    const cancel = vi.fn(async () => ({
      rpcId: 'codex-2',
      result: { ok: true as const, value: { cancelled: true } },
    }))
    const onClose = vi.fn()
    const api = { begin, status, cancel } as unknown as IApiClient['authorization']
    render(<CodexAuthRecovery api={api} open onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'Conectar ChatGPT con Codex' })).toBeDefined()
    expect(begin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión con ChatGPT' }))
    await waitFor(() => {
      expect(begin).toHaveBeenCalledWith({ key: 'subagent-codex/account', method: 'oauth' })
    })
    await waitFor(() => {
      expect(screen.getByText('Preparando el enlace seguro de ChatGPT…')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith({ attemptId: 'native-1' })
  })
})
