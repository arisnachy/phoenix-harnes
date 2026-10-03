// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMailPanel } from '../src/client/AssistantMailPanel.tsx'
afterEach(cleanup)
describe('local assistant mailbox settings', () => {
  it('shows the actual inbox and pending owner verification without claiming activation', async () => {
    const client = { call: async (action: string) => ({ account: { state: action === 'verify' ? 'ready' : 'pending-verification', inboxId: 'actual@agentmail.to', contacts: [] }, connection: 'disconnected', jobs: [] }) }
    render(<AssistantMailPanel client={client} />)
    expect(await screen.findByText('actual@agentmail.to')).toBeTruthy()
    expect(screen.getByText('Dirección de Kira')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copiar correo de Kira' })).toBeTruthy()
    expect(screen.getByText('Pendiente de verificación')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Código de verificación'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar y activar' }))
    expect(await screen.findByText(/Correo verificado/u)).toBeTruthy()
  })
})

it('preserves owner input typed before the initial host status resolves', async () => {
  let resolveStatus!: (value: {
    account: { state: string; contacts: readonly string[] }
    connection: string
    jobs: readonly []
  }) => void
  const pending = new Promise<{
    account: { state: string; contacts: readonly string[] }
    connection: string
    jobs: readonly []
  }>((resolve) => { resolveStatus = resolve })
  const client = { call: async (action: string) => {
    if (action === 'status') return pending
    return { account: { state: 'pending-verification', inboxId: 'actual@agentmail.to', contacts: [] }, connection: 'disconnected', jobs: [] }
  } }
  render(<AssistantMailPanel client={client} />)
  const owner = screen.getByLabelText<HTMLInputElement>('Tu correo para recibir el código de verificación')
  fireEvent.change(owner, { target: { value: 'owner@example.com' } })
  await act(async () => { resolveStatus({ account: { state: 'not-configured', contacts: [] }, connection: 'disconnected', jobs: [] }); await pending })
  expect(owner.value).toBe('owner@example.com')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Configurar correo de Kira' }).disabled).toBe(false)
})



it('shows Free-plan telemetry and requires an explicit cleanup click after preview', async () => {
  const actions: string[] = []
  const client = { call: async (action: string) => {
    actions.push(action)
    const cleanup = action === 'cleanup-preview'
      ? { mode: 'preview', candidateCount: 4 }
      : action === 'cleanup-trash'
        ? { mode: 'execute', candidateCount: 4, deleted: 4, failed: [] }
        : undefined
    return {
      account: { state: 'ready', inboxId: 'kira@agentmail.to', contacts: [] },
      connection: 'connected',
      quota: {
        plan: 'free' as const,
        limits: { inboxes: 3, monthlyEmails: 3000, storageBytes: 3221225472 },
        used: { inboxes: 1, monthlyEmails: 1250, storageBytes: 1073741824, storedMessages: 25, threads: 12 },
        remaining: { inboxes: 2, monthlyEmails: 1750, storageBytes: 2147483648 },
        utilization: { inboxes: 1 / 3, monthlyEmails: 1250 / 3000, storage: 1 / 3 },
        level: 'ok' as const,
        measuredAt: '2026-10-03T18:00:00.000Z',
        resetsAt: '2026-11-01T00:00:00.000Z',
      },
      ...(cleanup === undefined ? {} : { cleanup }),
      jobs: [],
    }
  } }
  render(<AssistantMailPanel client={client} />)
  expect(await screen.findByText('AgentMail Free')).toBeTruthy()
  expect(screen.getByText('1250/3000')).toBeTruthy()
  expect(screen.getByText(/Quedan 1750/u)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Revisar papelera antigua' }))
  expect(await screen.findByRole('button', { name: 'Eliminar 4 de papelera' })).toBeTruthy()
  expect(actions).not.toContain('cleanup-trash')
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar 4 de papelera' }))
  expect(await screen.findByText(/Limpieza: 4 eliminados/u)).toBeTruthy()
  expect(actions).toContain('cleanup-trash')
})
