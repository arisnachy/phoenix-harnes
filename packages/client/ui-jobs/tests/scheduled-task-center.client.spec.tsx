// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScheduledTaskCenter } from '../src/client/ScheduledTaskCenter.tsx'
import type { ScheduledTaskCenterProps } from '../src/client/ScheduledTaskCenter.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t: ScheduledTaskCenterProps['t'] = key => en[key as keyof typeof en] ?? key

describe('Scheduled tasks global manager', () => {
  it('opens from the sidebar event, lists Host-confirmed records, and closes', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: [
      { id: 'task-1', title: 'Neurociencia semanal', status: 'scheduled',
        nextRunAt: '2026-11-02T12:00:00.000Z', createdBy: 'user' },
    ] })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    expect(screen.getByRole('dialog', { name: 'Scheduled tasks' })).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('Neurociencia semanal')).toBeTruthy() })
    expect(call).toHaveBeenCalledWith('/phoenix-tasks', 'list', {}, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Close scheduled tasks' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never confirms a failed create; retries only through explicit user submission', async () => {
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string) =>
      endpoint === 'list' ? { ok: true, value: [] } : { ok: false, error: { message: 'Host rejected create' } })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(call).toHaveBeenCalledTimes(1) })
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Investigate' } })
    fireEvent.change(screen.getByLabelText('What should Phoenix do?'), { target: { value: 'Research real sources' } })
    fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2098-10-24T16:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Host rejected create') })
    expect(screen.queryByText('Investigate', { exact: true })).toBeNull()
    expect(call.mock.calls.filter((args: unknown[]) => args[1] === 'create')).toHaveLength(1)
  })

  it('uses Host-confirmed pause, resume, and cancel rather than optimistic local state', async () => {
    let status = 'scheduled'
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string) => {
      if (endpoint === 'list') {
        return { ok: true, value: [{ id: 'task-1', title: 'Seguimiento semanal', status,
          nextRunAt: '2026-12-01T12:00:00.000Z', createdBy: 'user' }] }
      }
      status = endpoint === 'pause' ? 'paused' : endpoint === 'resume' ? 'scheduled' : 'cancelled'
      return { ok: true, value: { id: 'task-1', status } }
    })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Pause: Seguimiento semanal' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Pause: Seguimiento semanal' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Resume: Seguimiento semanal' })).toBeTruthy() })
    expect(call).toHaveBeenCalledWith('/phoenix-tasks', 'pause', { id: 'task-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Resume: Seguimiento semanal' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Pause: Seguimiento semanal' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task: Seguimiento semanal' }))
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith('/phoenix-tasks', 'cancel', { id: 'task-1' })
      expect(screen.queryByRole('button', { name: 'Pause: Seguimiento semanal' })).toBeNull()
    })
  })

  it('retains previous task status when the Host rejects a state change', async () => {
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string) =>
      endpoint === 'list'
        ? { ok: true, value: [{ id: 'task-2', title: 'Persistir', status: 'scheduled',
          nextRunAt: '2026-12-01T12:00:00.000Z', createdBy: 'user' }] }
        : { ok: false, error: { message: 'Task is locked' } })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Pause: Persistir' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Pause: Persistir' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Task is locked') })
    expect(screen.getByRole('button', { name: 'Pause: Persistir' })).toBeTruthy()
  })

  it('renders only Host-confirmed execution receipts in the task history', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: [{
      id: 'task-historical',
      title: 'Clinical follow-up',
      status: 'completed',
      nextRunAt: '2026-11-02T12:00:00.000Z',
      createdBy: 'user',
      recentHistory: [{
        phase: 'deliver',
        status: 'completed',
        finishedAt: '2026-11-02T12:05:00.000Z',
        summary: 'Validated report delivered',
      }],
      instruction: 'Private source instructions never displayed',
    }] })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(screen.getByText('Clinical follow-up')).toBeTruthy() })
    fireEvent.click(screen.getByText(/Results and history/))
    expect(screen.getByText('Validated report delivered')).toBeTruthy()
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0)
    expect(screen.queryByText('Private source instructions never displayed')).toBeNull()
  })

  it('offers explicit conversation selection when more than one session is active', async () => {
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string, payload: unknown) => {
      if (endpoint === 'targets') return { ok: true, value: [{ id: 'root-a' }, { id: 'root-b' }] }
      if (endpoint === 'create') {
        expect(payload).toMatchObject({ targetAgentId: 'root-b' })
        return { ok: true, value: { id: 'new-1' } }
      }
      return { ok: true, value: [{ id: 'new-1', title: 'Plan',
        status: 'scheduled', nextRunAt: '2098-10-24T16:00:00.000Z', createdBy: 'user' }] }
    })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Choose conversation' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'Choose conversation' }))
    await waitFor(() => { expect(screen.getByRole('combobox', { name: 'Target conversation' })).toBeTruthy() })
    fireEvent.change(screen.getByRole('combobox', { name: 'Target conversation' }), { target: { value: 'root-b' } })
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Plan' } })
    fireEvent.change(screen.getByLabelText('What should Phoenix do?'), { target: { value: 'Prepare' } })
    fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2098-10-24T16:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    await waitFor(() => { expect(call.mock.calls.some((row: unknown[]) => row[1] === 'create')).toBe(true) })
  })

  it('deletes only after explicit confirmation and verifies the Host ledger is empty', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let exists = true
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string) => {
      if (endpoint === 'list') return { ok: true, value: exists ? [{
        id: 'record-1', title: 'Review results', status: 'scheduled',
        nextRunAt: '2026-12-01T12:00:00.000Z', createdBy: 'user',
      }] : [] }
      if (endpoint === 'delete') { exists = false; return { ok: true, value: { id: 'record-1', deleted: true } } }
      throw new Error('unexpected request')
    })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    const label = 'Delete permanently: Review results'
    await waitFor(() => { expect(screen.getByRole('button', { name: label })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(call.mock.calls.every((args: unknown[]) => args[1] !== 'delete')).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => { expect(screen.queryByText('Review results')).toBeNull() })
    expect(call).toHaveBeenCalledWith('/phoenix-tasks', 'delete', { id: 'record-1' })
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Review results'))
  })

  it('retains the task when the Host refuses deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const call = vi.fn().mockImplementation(async (_channel: string, endpoint: string) =>
      endpoint === 'list'
        ? { ok: true, value: [{ id: 'still-here', title: 'Safe record', status: 'paused',
          nextRunAt: '2026-12-01T12:00:00.000Z', createdBy: 'user' }] }
        : { ok: false, error: { message: 'task still running' } })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    const label = 'Delete permanently: Safe record'
    await waitFor(() => { expect(screen.getByRole('button', { name: label })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('task still running') })
    expect(screen.getByText('Safe record')).toBeTruthy()
  })

  it('does not send expired schedules to the Host', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: [] })
    render(<ScheduledTaskCenter t={t} connection={{ rpc: { call } }} />)
    fireEvent(window, new Event('phoenix:open-scheduled-tasks'))
    await waitFor(() => { expect(call).toHaveBeenCalled() })
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Expired' } })
    fireEvent.change(screen.getByLabelText('What should Phoenix do?'), { target: { value: 'Do something' } })
    fireEvent.change(screen.getByLabelText('Start date and time'), { target: { value: '2001-01-01T09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(screen.getByRole('alert').textContent).toContain('future date')
    expect(call.mock.calls.every((args: unknown[]) => args[1] === 'list')).toBe(true)
  })
})
