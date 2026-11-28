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
    expect(styles).toContain('--finix-gutter: calc((100% - var(--dsh-composer-card-max-width')
    expect(styles).toContain('overscroll-behavior: contain')
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
