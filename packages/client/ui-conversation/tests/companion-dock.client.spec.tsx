// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { CompanionDock } from '../src/client/skeleton/CompanionDock.tsx'
afterEach(cleanup)
describe('Finix output', () => {
  it('opens without reserving a layout row or task menu', () => {
    const toggle = vi.fn()
    const view = render(<CompanionDock open={false} onToggle={toggle} />)
    expect(view.queryByLabelText('Salida de Finix')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Abrir Finix' }))
    expect(toggle).toHaveBeenCalledOnce()
  })
  it('anchors the output outside the composer and uses the spare gutter', () => {
    const root = readFileSync(new URL('../src/client/skeleton/ConversationRoot.tsx', import.meta.url), 'utf8')
    const styles = readFileSync(new URL('../src/client/skeleton/CompanionDock.module.css', import.meta.url), 'utf8')
    expect(root.indexOf('<CompanionDock')).toBeGreaterThan(root.indexOf('{composerSeat}'))
    expect(styles).toContain('min-width: 1760px')
    expect(styles).toContain('flex-basis: clamp(260px, 28cqw, 340px)')
    expect(root).toContain("renderSlot('conversation.side.activity', {})")
    expect(styles).toContain('overscroll-behavior: contain')
  })
  it('retains the same live team element when Finix opens', () => {
    const team = <div data-kira-teams=""><button type="button">Agente activo</button></div>
    const view = render(<CompanionDock open={false} onToggle={vi.fn()} team={team} />)
    const agent = view.getByRole('button', { name: 'Agente activo' })
    expect(agent.closest('[data-shared-kira-seat]')).not.toBeNull()
    view.rerender(<CompanionDock open onToggle={vi.fn()} team={team} />)
    expect(view.getByRole('button', { name: 'Agente activo' })).toBe(agent)
    expect(view.getByLabelText('Salida de Finix').closest('[data-finix-dock]')).toBe(agent.closest('[data-finix-dock]'))
  })
  it('reads actual output and shows the shared-input instruction', async () => {
    const loadOutput = vi.fn(async () => [{id:'1',title:'Hola',status:'completed',recentHistory:[{status:'completed',summary:'Hola, soy Finix'}]}])
    const view = render(<CompanionDock open onToggle={vi.fn()} loadOutput={loadOutput} />)
    await waitFor(() => expect(view.getByText('Hola, soy Finix')).toBeTruthy())
    expect(view.getByText(/input principal/)).toBeTruthy()
    expect(view.queryByText('Delegar y administrar tareas')).toBeNull()
  })
})

it('shows a dismissible speech bubble for a material initiative only when minimized', async () => {
  const loadOutput = vi.fn(async () => [{id:'r',title:'Monitor',status:'scheduled',resident:true,initiative:'Detecté 3 tareas fallidas.',recentHistory:[]}])
  const view = render(<CompanionDock open={false} onToggle={vi.fn()} loadOutput={loadOutput} />)
  await waitFor(() => expect(view.getByText('Detecté 3 tareas fallidas.')).toBeTruthy())
  fireEvent.click(view.getByRole('button', { name: 'Descartar aviso de Finix' }))
  expect(view.queryByText('Detecté 3 tareas fallidas.')).toBeNull()
})
