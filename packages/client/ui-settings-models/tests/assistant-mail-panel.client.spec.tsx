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
    expect(screen.getByText('Pendiente de verificación')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Código de verificación'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar correo' }))
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
  const owner = screen.getByLabelText('Correo del propietario')
  fireEvent.change(owner, { target: { value: 'owner@example.com' } })
  await act(async () => { resolveStatus({ account: { state: 'not-configured', contacts: [] }, connection: 'disconnected', jobs: [] }); await pending })
  expect(owner).toHaveValue('owner@example.com')
  expect(screen.getByRole('button', { name: 'Crear mi correo gratuito' })).not.toBeDisabled()
})

