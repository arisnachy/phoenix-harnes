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


it('repairs a mistyped owner email during recovery instead of looping on the bad address', async () => {
  const calls: Array<{ action: string; input?: Record<string, unknown> }> = []
  const client = { call: async (action: string, input?: Record<string, unknown>) => {
    calls.push({ action, ...(input === undefined ? {} : { input }) })
    return {
      account: action === 'owner'
        ? { state: 'pending-verification', inboxId: 'kira@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }
        : { state: 'signup-ambiguous', ownerEmail: 'owner@example.comy', contacts: [] },
      connection: action === 'owner' ? 'verification-required' : 'disconnected',
      jobs: [],
    }
  } }
  render(<AssistantMailPanel client={client} />)
  const owner = await screen.findByLabelText<HTMLInputElement>('Correo propietario que recibirá el código')
  expect(owner.value).toBe('owner@example.comy')
  fireEvent.change(owner, { target: { value: 'owner@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Corregir correo y continuar' }))
  expect(await screen.findByText('Verifica una vez')).toBeTruthy()
  expect(calls).toContainEqual({ action: 'owner', input: { ownerEmail: 'owner@example.com' } })
})
it('can replace an unrecoverable mailbox in one click', async () => {
  vi.stubGlobal('confirm', () => true)
  const calls: string[] = []
  const client = { call: async (action: string) => {
    calls.push(action)
    return {
      account: action === 'replace'
        ? { state: 'pending-verification', inboxId: 'replacement@agentmail.to', ownerEmail: 'owner@example.com', contacts: [] }
        : { state: 'signup-ambiguous', ownerEmail: 'owner@example.com', contacts: [] },
      connection: 'disconnected',
      jobs: [],
    }
  } }
  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'No se puede recuperar: crear uno nuevo' }))
  expect(await screen.findByText('replacement@agentmail.to')).toBeTruthy()
  expect(calls).toContain('replace')
  vi.unstubAllGlobals()
})


it('turns an AgentMail permission 403 into a visible recovery action', async () => {
  const calls: string[] = []
  const client = { call: async (action: string) => {
    calls.push(action)
    return {
      account: {
        state: action === 'recover' ? 'pending-verification' : 'ready',
        inboxId: 'kira@agentmail.to',
        ownerEmail: 'owner@example.com',
        contacts: [],
      },
      connection: action === 'recover' ? 'verification-required' : 'recovery-required',
      jobs: [],
    }
  } }
  render(<AssistantMailPanel client={client} />)
  expect(await screen.findByText('AgentMail requiere recuperar acceso')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Recuperar acceso y verificar' }))
  expect(await screen.findByText('Verifica una vez')).toBeTruthy()
  expect(calls).toContain('recover')
})

it('shows owner-link recovery instead of an OTP field when AgentMail refused the human attachment', async () => {
  const calls: string[] = []
  const client = { call: async (action: string) => {
    calls.push(action)
    return {
      account: {
        state: 'pending-verification',
        inboxId: 'kira@agentmail.to',
        ownerEmail: 'owner@example.com',
        ownerLink: 'provider-conflict' as const,
        contacts: [],
      },
      connection: 'disconnected',
      jobs: [],
    }
  } }

  render(<AssistantMailPanel client={client} />)
  expect(await screen.findByText('Vincula propietario')).toBeTruthy()
  expect(screen.queryByLabelText('Código de verificación')).toBeNull()
  expect(screen.getByText(/AgentMail rechazó asociar este correo/u)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar vinculación' }))
  expect(calls).toContain('recover')
})


it('copies the saved AgentMail signup key and opens the claim page without rendering the secret', async () => {
  const writeText = vi.fn(async (_value: string) => {})
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  const open = vi.fn(() => null)
  vi.stubGlobal('open', open)
  const client = {
    call: async () => ({
      account: {
        state: 'pending-verification',
        inboxId: 'kira@agentmail.to',
        ownerEmail: 'owner@example.com',
        ownerLink: 'provider-conflict' as const,
        contacts: [],
      },
      connection: 'disconnected',
      jobs: [],
    }),
    prepareClaim: async () => ({
      apiKey: 'am_us_super_secret',
      inboxId: 'kira@agentmail.to',
      claimUrl: 'https://console.agentmail.to/claim',
    }),
  }

  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Copiar clave y abrir AgentMail' }))

  expect(await screen.findByText(/Clave de kira@agentmail\.to copiada/u)).toBeTruthy()
  expect(writeText).toHaveBeenCalledWith('am_us_super_secret')
  expect(open).toHaveBeenCalledWith('https://console.agentmail.to/claim', '_blank', 'noopener,noreferrer')
  expect(screen.queryByText('am_us_super_secret')).toBeNull()

  vi.unstubAllGlobals()
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: undefined })
})


it('confirms a claimed inbox and leaves the verification-only state', async () => {
  const calls: string[] = []
  const client = {
    call: async (action: string) => {
      calls.push(action)
      return {
        account: action === 'claim-status'
          ? {
              state: 'ready',
              inboxId: 'kira@agentmail.to',
              ownerEmail: 'owner@example.com',
              ownerLink: 'attached' as const,
              contacts: [],
            }
          : {
              state: 'pending-verification',
              inboxId: 'kira@agentmail.to',
              ownerEmail: 'owner@example.com',
              ownerLink: 'provider-conflict' as const,
              contacts: [],
            },
        connection: action === 'claim-status' ? 'connecting' : 'disconnected',
        jobs: [],
      }
    },
  }

  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ya lo reclamé · comprobar' }))

  expect(await screen.findByText(/Correo verificado/u)).toBeTruthy()
  expect(calls).toContain('claim-status')
  expect(screen.queryByText('Vincula propietario')).toBeNull()
})
