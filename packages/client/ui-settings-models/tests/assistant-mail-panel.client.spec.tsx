// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

it('offers a deliberate new mailbox after an ambiguous signup', async () => {
  const call = vi.fn(async (action: string) => ({
    account: action === 'new-signup'
      ? { state: 'pending-verification', inboxId: 'second@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }
      : { state: 'signup-ambiguous', ownerEmail: 'owner@example.com', contacts: [] },
    connection: 'disconnected',
    jobs: [],
  }))
  render(<AssistantMailPanel client={{ call }} />)
  const create = await screen.findByRole('button', { name: 'Crear otro buzón' })
  fireEvent.click(create)
  await act(async () => { await Promise.resolve() })
  expect(call).toHaveBeenCalledWith('new-signup', { ownerEmail: 'owner@example.com' })
  expect(await screen.findByText('second@agentmail.to')).toBeTruthy()
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

