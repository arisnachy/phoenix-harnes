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


it('asks the Host to copy the saved signup key and opens the claim page without receiving the secret', async () => {
  const open = vi.fn(() => null)
  vi.stubGlobal('open', open)
  const prepareClaim = vi.fn(async () => ({
    copied: true as const,
    inboxId: 'kira@agentmail.to',
    claimUrl: 'https://console.agentmail.to/claim',
  }))
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
    prepareClaim,
  }

  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Copiar clave y abrir AgentMail' }))

  expect(await screen.findByText(/Clave de kira@agentmail\.to copiada por Phoenix/u)).toBeTruthy()
  expect(prepareClaim).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledWith('https://console.agentmail.to/claim', '_blank', 'noopener,noreferrer')
  expect(document.body.textContent).not.toContain('am_us_')

  vi.unstubAllGlobals()
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

it('corroborates a new Console API key before storing it and activating the new inbox', async () => {
  const calls: Array<{ action: string; input?: Record<string, unknown> }> = []
  const checks: string[] = []
  const client = {
    call: async (action: string, input?: Record<string, unknown>) => {
      calls.push({ action, ...(input === undefined ? {} : { input }) })
      return {
        account: action === 'console-key'
          ? {
            state: 'ready',
            inboxId: 'kira-new@agentmail.to',
            ownerEmail: 'owner@example.com',
            ownerLink: 'attached' as const,
            contacts: [],
          }
          : {
            state: 'pending-verification',
            inboxId: 'kira-old@agentmail.to',
            ownerEmail: 'owner@example.com',
            ownerLink: 'provider-conflict' as const,
            contacts: [],
          },
        connection: action === 'console-key' ? 'connecting' : 'disconnected',
        jobs: [],
      }
    },
    checkConsoleKey: async (apiKey: string) => {
      checks.push(apiKey)
      return {
        valid: true as const,
        organizationId: 'org_human',
        authenticationType: 'clerk',
        inboxCount: 1,
        inboxLimit: 3,
        capacityAvailable: true,
        inboxRead: true,
        scopeType: 'organization' as const,
        inboxCreate: true,
        messageSend: true,
      }
    },
  }

  render(<AssistantMailPanel client={client} />)
  const key = await screen.findByLabelText<HTMLInputElement>('Nueva API key de AgentMail')
  expect(key.type).toBe('password')
  const activate = screen.getByRole('button', { name: 'Guardar API y activar Kira' })
  expect((activate as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(key, { target: { value: 'am_us_console_secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Corroborar API key' }))

  expect(await screen.findByText('Comprobación de AgentMail')).toBeTruthy()
  expect(screen.getByText('✓ válida')).toBeTruthy()
  expect(screen.getByText('1/3')).toBeTruthy()
  expect(checks).toEqual(['am_us_console_secret'])
  expect((activate as HTMLButtonElement).disabled).toBe(false)
  expect(calls.some(call => call.action === 'console-key')).toBe(false)

  fireEvent.click(activate)

  expect(await screen.findByText('kira-new@agentmail.to')).toBeTruthy()
  expect(calls).toContainEqual({
    action: 'console-key',
    input: { apiKey: 'am_us_console_secret' },
  })
  expect(key.value).toBe('')
  expect(document.body.textContent).not.toContain('am_us_console_secret')
})


it('corroborates and rotates the API key of an already active Kira inbox without changing its address', async () => {
  const calls: Array<{ action: string; input?: Record<string, unknown> }> = []
  const checks: string[] = []
  const client = {
    call: async (action: string, input?: Record<string, unknown>) => {
      calls.push({ action, ...(input === undefined ? {} : { input }) })
      return {
        account: {
          state: 'ready',
          inboxId: 'kira-current@agentmail.to',
          ownerEmail: 'owner@example.com',
          ownerLink: 'attached' as const,
          contacts: [],
        },
        connection: action === 'console-key' ? 'connecting' : 'connected',
        jobs: [],
      }
    },
    checkConsoleKey: async (apiKey: string) => {
      checks.push(apiKey)
      return {
        valid: true as const,
        organizationId: 'org_human',
        authenticationType: 'clerk',
        inboxCount: 3,
        inboxLimit: 3,
        capacityAvailable: false,
        inboxRead: true,
        scopeType: 'organization' as const,
        inboxCreate: true,
        messageSend: true,
        currentInboxAccess: true,
        messageRead: true,
        realtime: true,
      }
    },
  }

  render(<AssistantMailPanel client={client} />)
  expect(await screen.findByText('kira-current@agentmail.to')).toBeTruthy()
  fireEvent.click(screen.getByText('API key de AgentMail · verificar o reemplazar'))
  const key = screen.getByLabelText<HTMLInputElement>('Nueva API key de AgentMail')
  fireEvent.change(key, { target: { value: 'am_us_rotated_secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Corroborar API key' }))

  expect(await screen.findByText('✓ accesible')).toBeTruthy()
  expect(screen.getAllByText('✓ disponible')).toHaveLength(2)
  const save = screen.getByRole('button', { name: 'Guardar API y verificar acceso' })
  expect((save as HTMLButtonElement).disabled).toBe(false)

  fireEvent.click(save)

  expect(await screen.findByText(/API actualizada/u)).toBeTruthy()
  expect(checks).toEqual(['am_us_rotated_secret'])
  expect(calls).toContainEqual({
    action: 'console-key',
    input: { apiKey: 'am_us_rotated_secret' },
  })
  expect(screen.getByText('kira-current@agentmail.to')).toBeTruthy()
  expect(document.body.textContent).not.toContain('am_us_rotated_secret')
})


it('supports first-run Console key setup after owner entry and corroboration', async () => {
  const candidate = ['am', 'first', 'run'].join('_')
  const calls: Array<{ action: string; input?: Record<string, unknown> }> = []
  const client = {
    call: async (action: string, input?: Record<string, unknown>) => {
      calls.push({ action, ...(input === undefined ? {} : { input }) })
      return {
        account: action === 'console-key'
          ? {
            state: 'ready',
            inboxId: 'kira-first@agentmail.to',
            ownerEmail: 'owner@example.com',
            ownerLink: 'attached' as const,
            contacts: [],
          }
          : { state: 'not-configured', contacts: [] },
        connection: action === 'console-key' ? 'connecting' : 'disconnected',
        jobs: [],
      }
    },
    checkConsoleKey: async () => ({
      valid: true as const,
      organizationId: 'org_human',
      inboxCount: 0,
      inboxLimit: 3,
      capacityAvailable: true,
      inboxRead: true,
      scopeType: 'organization' as const,
      inboxCreate: true,
      messageSend: true,
    }),
  }

  render(<AssistantMailPanel client={client} />)
  const key = await screen.findByLabelText<HTMLInputElement>('Nueva API key de AgentMail')
  fireEvent.change(key, { target: { value: candidate } })
  fireEvent.click(screen.getByRole('button', { name: 'Corroborar API key' }))

  expect(await screen.findByText('✕ escríbelo arriba')).toBeTruthy()
  const activate = screen.getByRole('button', { name: 'Guardar API y activar Kira' })
  expect((activate as HTMLButtonElement).disabled).toBe(true)

  fireEvent.change(screen.getByPlaceholderText('tu@correo.com'), { target: { value: 'owner@example.com' } })
  expect((activate as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(activate)

  expect(await screen.findByText('kira-first@agentmail.to')).toBeTruthy()
  expect(calls).toContainEqual({
    action: 'console-key',
    input: { apiKey: candidate, ownerEmail: 'owner@example.com' },
  })
  expect(document.body.textContent).not.toContain(candidate)
})


it('does not enable AgentMail key replacement when message_send is missing', async () => {
  const client = {
    call: async () => ({
      account: {
        state: 'ready',
        inboxId: 'kira@agentmail.to',
        ownerEmail: 'owner@example.com',
        ownerLink: 'attached' as const,
        contacts: [],
      },
      connection: 'connected',
      jobs: [],
    }),
    checkConsoleKey: async () => ({
      valid: true as const,
      organizationId: 'org_human',
      inboxCount: 2,
      inboxLimit: 3,
      capacityAvailable: true,
      inboxRead: true,
      scopeType: 'organization' as const,
      inboxCreate: true,
      messageSend: false,
      currentInboxAccess: true,
      messageRead: true,
      realtime: true,
    }),
  }

  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByText('API key de AgentMail · verificar o reemplazar'))
  fireEvent.change(screen.getByLabelText('Nueva API key de AgentMail'), { target: { value: 'am_restricted' } })
  fireEvent.click(screen.getByRole('button', { name: 'Corroborar API key' }))

  expect(await screen.findByText('✕ falta message_send')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Guardar API y verificar acceso' }).getAttribute('disabled')).not.toBeNull()
})

it('shows the sanitized AgentMail provider issue without marking the inbox disconnected', async () => {
  const client = {
    call: async () => ({
      account: {
        state: 'ready',
        inboxId: 'kira@agentmail.to',
        ownerEmail: 'owner@example.com',
        ownerLink: 'attached' as const,
        contacts: [],
      },
      connection: 'connected',
      providerIssue: {
        status: 403,
        code: 'missing_permission',
        reason: 'permission-missing',
        permission: 'message_send',
        fix: "This API key does not have the 'message_send' permission.",
      },
      jobs: [],
    }),
  }

  render(<AssistantMailPanel client={client} />)
  expect(await screen.findByText('Correo verificado · Activo')).toBeTruthy()
  expect(screen.getByText(/AgentMail 403 · missing_permission · falta message_send/u)).toBeTruthy()
  expect(screen.getByText(/does not have the 'message_send' permission/u)).toBeTruthy()
})


it('allows AgentMail key replacement when REST works but realtime falls back to polling', async () => {
  const candidate = ['am', 'polling', 'fallback'].join('_')
  const calls: Array<{ action: string; input?: Record<string, unknown> }> = []
  const client = {
    call: async (action: string, input?: Record<string, unknown>) => {
      calls.push({ action, ...(input === undefined ? {} : { input }) })
      return {
        account: {
          state: 'ready',
          inboxId: 'kira@agentmail.to',
          ownerEmail: 'owner@example.com',
          ownerLink: 'attached' as const,
          contacts: [],
        },
        connection: action === 'console-key' ? 'connected-polling' : 'connected',
        jobs: [],
      }
    },
    checkConsoleKey: async () => ({
      valid: true as const,
      organizationId: 'org_human',
      inboxCount: 2,
      inboxLimit: 3,
      capacityAvailable: true,
      inboxRead: true,
      scopeType: 'organization' as const,
      inboxCreate: true,
      messageSend: true,
      currentInboxAccess: true,
      messageRead: true,
      realtime: false,
    }),
  }

  render(<AssistantMailPanel client={client} />)
  fireEvent.click(await screen.findByText('API key de AgentMail · verificar o reemplazar'))
  fireEvent.change(screen.getByLabelText('Nueva API key de AgentMail'), { target: { value: candidate } })
  fireEvent.click(screen.getByRole('button', { name: 'Corroborar API key' }))

  expect(await screen.findByText('⚠ no disponible · usará polling')).toBeTruthy()
  const save = screen.getByRole('button', { name: 'Guardar API y verificar acceso' })
  expect(save.getAttribute('disabled')).toBeNull()
  fireEvent.click(save)

  expect(await screen.findByText(/operativo por REST\/polling/u)).toBeTruthy()
  expect(calls).toContainEqual({ action: 'console-key', input: { apiKey: candidate } })
  expect(document.body.textContent).not.toContain(candidate)
})
