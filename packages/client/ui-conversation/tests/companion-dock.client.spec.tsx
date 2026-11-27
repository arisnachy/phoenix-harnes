// @vitest-environment jsdom
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
  it('reads actual output and shows the shared-input instruction', async () => {
    const loadOutput = vi.fn(async () => [{id:'1',title:'Hola',status:'completed',recentHistory:[{status:'completed',summary:'Hola, soy Finix'}]}])
    const view = render(<CompanionDock open onToggle={vi.fn()} loadOutput={loadOutput} />)
    await waitFor(() => expect(view.getByText('Hola, soy Finix')).toBeTruthy())
    expect(view.getByText(/input principal/)).toBeTruthy()
    expect(view.queryByText('Delegar y administrar tareas')).toBeNull()
  })
})
