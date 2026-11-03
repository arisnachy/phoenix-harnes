// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useState } from 'react'
import {
  TheOddsApiConnectorSetup,
  type TheOddsApiClient,
  type TheOddsApiSnapshot,
} from '../src/client/TheOddsApiConnectorSetup.tsx'

afterEach(() => {
  cleanup()
})

const state: TheOddsApiSnapshot = {
  configured: true,
  verified: true,
  source: 'vault',
  status: 'ready',
  requestsRemaining: 488,
  requestsUsed: 12,
}

function Fixture({ client }: { client: TheOddsApiClient }) {
  const [snapshot, setSnapshot] = useState<TheOddsApiSnapshot | undefined>()
  return <TheOddsApiConnectorSetup client={client} snapshot={snapshot} onStatus={setSnapshot}/>
}

describe('The Odds API connector setup', () => {
  it('accepts secret in a password field, submits only to Host, and shows quota without key', async () => {
    const configure = vi.fn(async () => state)
    const client = {
      state: vi.fn(async () => state),
      configure,
      disconnect: vi.fn(async () => ({ ...state, configured: false })),
    }
    const view = render(<Fixture client={client}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Añadir API key' }))
    const input = screen.getByLabelText('API key · The Odds API v4') as HTMLInputElement
    expect(input.type).toBe('password')
    const token = '0123456789abcdef0123456789abcdef'
    fireEvent.change(input, { target: { value: token } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en el vault y verificar' }))
    await waitFor(() => { expect(configure).toHaveBeenCalledWith(token) })
    await waitFor(() => { expect(screen.getByText(/Conectada · API key verificada/)).toBeTruthy() })
    expect(view.container.textContent).not.toContain(token)
    expect(view.container.textContent).toContain('488 restantes')
  })

  it('never falsely marks a network failure as connected', async () => {
    const client = {
      state: vi.fn(async () => ({ ...state, status: 'unreachable' as const, verified: false })),
      configure: vi.fn(async () => ({ ...state, status: 'unreachable' as const, verified: false })),
      disconnect: vi.fn(async () => state),
    }
    render(<Fixture client={client}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Añadir API key' }))
    fireEvent.change(screen.getByLabelText('API key · The Odds API v4'), { target: { value: '0123456789abcdef' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar en el vault y verificar' }))
    await waitFor(() => { expect(screen.getByText(/Clave guardada · sin verificación de red/)).toBeTruthy() })
    expect(screen.queryByText(/Conectada · API key verificada/)).toBeNull()
  })
})
