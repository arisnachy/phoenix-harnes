// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { CompanionDock, companionPose } from '../src/client/skeleton/CompanionDock.tsx'
import type { ProactivityAttentionItem } from '../src/client/contract/slots.ts'
afterEach(cleanup)
const upcoming: ProactivityAttentionItem = { id: 't', taskId: 't', revision: '1', title: 'Revisar el sistema', kind: 'upcoming', at: '2026-11-27T10:00:00Z', score: 1 }
describe('resident companion seat', () => {
  it('shows only a compact launcher until opened', () => {
    const toggle = vi.fn()
    const v = render(<CompanionDock open={false} onToggle={toggle} attention={[]} onTasks={vi.fn()} onReview={vi.fn()} canReview />)
    expect(v.queryByLabelText('Actividad de Fénix')).toBeNull()
    fireEvent.click(v.getByRole('button', { name: 'Abrir Fénix' }))
    expect(toggle).toHaveBeenCalledOnce()
  })
  it('uses real notice data and delegates to the existing task center', () => {
    const tasks = vi.fn(), review = vi.fn()
    const v = render(<CompanionDock open onToggle={vi.fn()} attention={[upcoming]} onTasks={tasks} onReview={review} canReview />)
    expect(v.getByText('Próxima tarea')).toBeTruthy()
    fireEvent.click(v.getByText('Revisar el sistema'))
    expect(review).toHaveBeenCalledWith(upcoming)
    fireEvent.click(v.getByRole('button', { name: 'Delegar y administrar tareas' }))
    expect(tasks).toHaveBeenCalledOnce()
  })
  it('prioritizes real failures and protects unsent drafts', () => {
    expect(companionPose([upcoming, { ...upcoming, kind: 'failure' }])).toBe('tools')
    const review = vi.fn()
    const v = render(<CompanionDock open onToggle={vi.fn()} attention={[upcoming]} onTasks={vi.fn()} onReview={review} canReview={false} />)
    expect((v.getByRole('button', { name: /Revisar el sistema/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(review).not.toHaveBeenCalled()
  })
})
