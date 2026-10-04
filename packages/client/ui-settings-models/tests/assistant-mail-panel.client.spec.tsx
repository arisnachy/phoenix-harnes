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
    expect(screen.getByText('Verifica una vez')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Código de verificación'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verificar y activar' }))
    expect(await screen.findByText(/Correo verificado/u)).toBeTruthy()
  })
})

it('creates another mailbox only from the verified account', async () => {
  const calls: string[] = []
  const client = { call: async (action: string) => {
    calls.push(action)
    return { account: { state: 'ready', inboxId: action === 'create-inbox' ? 'second@agentmail.to' : 'first@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }, connection: 'disconnected', jobs: [] }
  } }
  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Crear otro buzón' }))
  expect(await screen.findByText('second@agentmail.to')).toBeTruthy()
  expect(calls).toContain('create-inbox')
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



it('offers owner-bound recovery without requiring an API key', async () => {
  const calls: string[] = []
  const client = { call: async (action: string) => {
    calls.push(action)
    return { account: { state: action === 'recover' ? 'pending-verification' : 'signup-ambiguous', ownerEmail: 'owner@example.com', ...(action === 'recover' ? { inboxId: 'existing@agentmail.to' } : {}), contacts: [] }, connection: 'disconnected', jobs: [] }
  } }
  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Recuperar y continuar' }))
  expect(await screen.findByText('existing@agentmail.to')).toBeTruthy()
  expect(calls).toContain('recover')
  expect(screen.queryByLabelText('Clave de recuperación de AgentMail')).toBeNull()
})
