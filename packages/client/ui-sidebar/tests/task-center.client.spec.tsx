// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskCenter, type TaskCenterConnection } from '../src/client/TaskCenter.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const scheduled = {
  id: 'task-123', title: 'Weekly class review', status: 'scheduled',
  nextRunAt: '2026-12-02T15:00:00.000Z', createdBy: 'user', delivery: 'work',
  recurrence: { kind: 'calendar', unit: 'week', every: 1, timezone: 'America/Santo_Domingo' },
  recentHistory: [],
}

describe('Scheduled Tasks Center', () => {
  it('creates durable tasks through the authenticated Phoenix endpoint', async () => {
    const calls: { endpoint: string; payload: unknown }[] = []
    const connection: TaskCenterConnection = {
      rpc: {
        async call(_channel, endpoint, payload) {
          calls.push({ endpoint, payload })
          return { ok: true, value: endpoint === 'list' ? [] : scheduled }
        },
      },
    }
    render(<TaskCenter connection={connection} onClose={vi.fn()} />)
    await screen.findByText('Aún no hay tareas. Puedes crear una aquí o pedirle a Kira que programe alguna por ti.')
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Leer estudios' } })
    fireEvent.change(screen.getByLabelText('Qué debe hacer Kira'), { target: { value: 'Buscar evidencia nueva' } })
    fireEvent.change(screen.getByLabelText('Repetición'), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }))
    await waitFor(() => {
      expect(calls.some(call => call.endpoint === 'create')).toBe(true)
    })
    const request = calls.find(call => call.endpoint === 'create')?.payload as Record<string, unknown>
    expect(request.title).toBe('Leer estudios')
    expect(request.delivery).toBe('work')
    expect(request.recurrence).toMatchObject({ kind: 'calendar', unit: 'week', every: 1 })
    expect(typeof request.runAt).toBe('string')
  })

  it('lists visible tasks and pauses them using their real task id', async () => {
    const endpoints: string[] = []
    const connection: TaskCenterConnection = {
      rpc: {
        async call(_channel, endpoint, payload) {
          endpoints.push(endpoint)
          if (endpoint === 'list') return { ok: true, value: [scheduled] }
          expect(payload).toEqual({ id: scheduled.id })
          return { ok: true, value: { ...scheduled, status: 'paused' } }
        },
      },
    }
    render(<TaskCenter connection={connection} onClose={vi.fn()} />)
    await screen.findByText('Weekly class review')
    expect(screen.getByText('Cada semana')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    await waitFor(() => {
      expect(endpoints).toContain('pause')
    })
  })

  it('closes by Escape, and reports a missing scheduler instead of simulating success', async () => {
    const close = vi.fn()
    render(<TaskCenter connection={undefined} onClose={close} />)
    await screen.findByRole('alert')
    expect(screen.getByText('La conexión del programador no está disponible')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
})
