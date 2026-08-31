// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PhoenixUpdateSnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type {
  PluginInventorySettingsTabInjected,
  PluginInventorySettingsTabProps,
} from '../src/client/PluginInventorySettingsTab.tsx'
import {
  UpdateFooterAction,
  updateLabelKey,
  type UpdateFooterActionInjected,
  type UpdateFooterActionProps,
} from '../src/client/UpdateFooterAction.tsx'
import { en, type PluginInventoryLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

type Snapshot = Awaited<ReturnType<PluginInventorySettingsTabInjected['list']>>
const t = ((key: PluginInventoryLocaleKey): string => en[key]) as PluginInventorySettingsTabProps['t']

function props(list: PluginInventorySettingsTabInjected['list']): PluginInventorySettingsTabProps {
  return {
    t,
    list,
  } as PluginInventorySettingsTabProps
}

function updateProps(
  readUpdateState: UpdateFooterActionInjected['readUpdateState'],
  restartForUpdate: UpdateFooterActionInjected['restartForUpdate'] = async () => ({ accepted: false, status: 'idle' }),
  wide = true,
  refreshForUpdate: UpdateFooterActionInjected['refreshForUpdate'] = async () => ({ accepted: true }),
): UpdateFooterActionProps {
  return {
    wide,
    t,
    readUpdateState,
    restartForUpdate,
    refreshForUpdate,
  }
}

const SNAPSHOT = {
  entries: [
    { entryId: '8a1b2c3d', moduleName: '@phoenix-ai/cordis-plugin-hmr', enabled: true, fiberPhase: 'active' },
    { entryId: 'pending', moduleName: 'cordis:pending-name', enabled: true, fiberPhase: 'pending' },
    { entryId: 'loading', moduleName: '@fixture/loading-name', enabled: true, fiberPhase: 'loading' },
    { entryId: 'failed', moduleName: '@fixture/failed-name', enabled: true, fiberPhase: 'failed' },
    { entryId: 'unloading', moduleName: '@fixture/unloading-name', enabled: true, fiberPhase: 'unloading' },
    { entryId: 'unobserved', moduleName: '@fixture/unobserved-name', enabled: true, fiberPhase: null },
    { entryId: 'disabled-entry', moduleName: '@phoenix-ai/dsh-host-directory-picker-native', enabled: false, fiberPhase: null },
  ],
} as unknown as Snapshot

describe('PluginInventorySettingsTab', () => {
  it('renders runtime status only for enabled plugins', async () => {
    const deferred = Promise.withResolvers<Snapshot>()
    const list = vi.fn(() => deferred.promise)
    const view = render(<PluginInventorySettingsTab {...props(list)} />)
    expect(screen.getByText(en.loading)).toBeTruthy()

    await act(async () => { deferred.resolve(SNAPSHOT) })
    expect(list).toHaveBeenCalledOnce()
    expect(screen.getByRole('searchbox', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.catalog })).toBeTruthy()
    expect(view.container.querySelector('[data-plugin-count]')?.textContent).toBe('7')
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getAllByText(en.enabledTag)).toHaveLength(6)
    expect(screen.getByText(en.disabledTag)).toBeTruthy()
    for (const value of [
      'Mounted',
      'Waiting for dependencies',
      'Loading',
      'Mount failed',
      'Unloading',
      'Not mounted',
    ]) {
      expect(screen.getByRole('img', { name: value })).toBeTruthy()
    }
    const active = screen.getByRole('button', { name: 'hmr, Mounted, Enabled' })
    expect(active.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(active)
    expect(active.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-loader-entry]')?.textContent).toBe('8a1b2c3d')
    expect(screen.getByText(en.configuration)).toBeTruthy()
    expect(screen.getByText(en.cordis)).toBeTruthy()
    fireEvent.click(active)
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()

    fireEvent.click(active)
    fireEvent.change(screen.getByRole('searchbox', { name: en.search }), {
      target: { value: 'disabled-entry' },
    })
    expect(view.container.querySelector('[data-loader-entry]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'directory-picker-native, Disabled' }))
    expect(screen.getAllByText(en.disabledTag)).toHaveLength(2)
    expect(screen.queryByText(en.cordis)).toBeNull()
    expect(screen.queryByText(en.unobserved)).toBeNull()
  })

  it('filters by module name or Loader entry id', async () => {
    render(<PluginInventorySettingsTab {...props(async () => SNAPSHOT)} />)
    const search = await screen.findByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'disabled-entry' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('directory-picker-native')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'cordis-plugin-hmr' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('hmr')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'not-a-plugin' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const list = vi.fn<PluginInventorySettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({ entries: [] })
    render(<PluginInventorySettingsTab {...props(list)} />)

    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('contains a synchronous Remote failure and ignores a result after unmount', async () => {
    const syncFailure = vi.fn(() => { throw new Error('namespace unavailable') }) as PluginInventorySettingsTabInjected['list']
    const failed = render(<PluginInventorySettingsTab {...props(syncFailure)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    failed.unmount()

    const deferred = Promise.withResolvers<Snapshot>()
    const pending = render(<PluginInventorySettingsTab {...props(() => deferred.promise)} />)
    pending.unmount()
    await act(async () => { deferred.resolve(SNAPSHOT) })

    const deferredFailure = Promise.withResolvers<Snapshot>()
    const pendingFailure = render(<PluginInventorySettingsTab {...props(() => deferredFailure.promise)} />)
    pendingFailure.unmount()
    await act(async () => { deferredFailure.reject(new Error('late failure')) })
  })
})

describe('UpdateFooterAction', () => {
  it.each([
    [{ status: 'idle' }, undefined],
    [{ status: 'checking' }, undefined],
    [{ status: 'current' }, undefined],
    [{ status: 'updated' }, undefined],
    [{ status: 'off' }, undefined],
    [{ status: 'available' }, 'updateAvailable'],
    [{ status: 'preparing', phase: 'source' }, 'updateSource'],
    [{ status: 'preparing', phase: 'dependencies' }, 'updateDependencies'],
    [{ status: 'preparing', phase: 'build' }, 'updateBuild'],
    [{ status: 'preparing', phase: 'smoke' }, 'updateSmoke'],
    [{ status: 'preparing', phase: 'future-phase' }, 'updateDependencies'],
    [{ status: 'ready' }, 'updateReady'],
    [{ status: 'restarting' }, 'updateRestarting'],
    [{ status: 'applying' }, 'updateApplying'],
    [{ status: 'rolling-back' }, 'updateRollingBack'],
    [{ status: 'rolled-back' }, 'updateRolledBack'],
    [{ status: 'paused' }, 'updatePaused'],
    [{ status: 'paused', phase: 'development-branch' }, undefined],
    [{ status: 'paused', detail: 'Automatic updates are disabled on branch codex/full-access-no-approval.' }, undefined],
    [{ status: 'error' }, 'updateError'],
    [{ status: 'rollback-failed' }, 'updateError'],
  ] as Array<[PhoenixUpdateSnapshot, PluginInventoryLocaleKey | undefined]>)('maps %# to stable localized copy', (snapshot, expected) => {
    expect(updateLabelKey(snapshot)).toBe(expected)
  })

  it('stays invisible during routine checks and transient Host read failures', async () => {
    const checking = render(<UpdateFooterAction {...updateProps(async () => ({ status: 'checking' }))} />)
    await act(async () => { await Promise.resolve() })
    expect(checking.container.textContent).toBe('')
    checking.unmount()

    const disconnected = render(<UpdateFooterAction {...updateProps(async () => { throw new Error('private read detail') })} />)
    await act(async () => { await Promise.resolve() })
    expect(disconnected.container.textContent).toBe('')
    expect(screen.queryByText('private read detail')).toBeNull()
  })

  it('stays absent while current and appears automatically on the next poll', async () => {
    vi.useFakeTimers()
    const readUpdateState = vi.fn<UpdateFooterActionInjected['readUpdateState']>()
      .mockResolvedValueOnce({ status: 'current', current: 'a'.repeat(40) })
      .mockResolvedValue({ status: 'preparing', phase: 'source', target: 'b'.repeat(40) })
    const view = render(<UpdateFooterAction {...updateProps(readUpdateState)} />)
    await act(async () => { await Promise.resolve() })
    expect(view.container.textContent).toBe('')

    await act(async () => { await vi.advanceTimersByTimeAsync(1250) })
    expect(screen.getByRole('status', { name: en.updateSource })).toBeTruthy()
    expect(readUpdateState).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ status: 'preparing', phase: 'build' }, 'updateBuild'],
    [{ status: 'restarting', phase: 'restart' }, 'updateRestarting'],
    [{ status: 'applying', phase: 'build' }, 'updateApplying'],
    [{ status: 'rolling-back', phase: 'smoke' }, 'updateRollingBack'],
  ] as Array<[PhoenixUpdateSnapshot, PluginInventoryLocaleKey]>)('renders active state %# as a live status row', async (snapshot, key) => {
    render(<UpdateFooterAction {...updateProps(async () => snapshot)} />)
    expect(await screen.findByRole('status', { name: en[key] })).toBeTruthy()
  })

  it('offers restart only after ready and binds one click to one request', async () => {
    const restart = Promise.withResolvers<{ accepted: true; status: 'restarting' }>()
    const restartForUpdate = vi.fn<UpdateFooterActionInjected['restartForUpdate']>(() => restart.promise)
    render(<UpdateFooterAction {...updateProps(async () => ({ status: 'ready', target: 'a'.repeat(40) }), restartForUpdate)} />)

    const button = await screen.findByRole('button', { name: en.updateRestart })
    expect(screen.getByText(en.updateReady)).toBeTruthy()
    expect(screen.getByText(en.updateRestart)).toBeTruthy()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(restartForUpdate).toHaveBeenCalledOnce()

    await act(async () => { restart.resolve({ accepted: true, status: 'restarting' }) })
    expect(await screen.findByRole('status', { name: en.updateRestarting })).toBeTruthy()
  })

  it('refreshes after a rejected restart and shows the host state', async () => {
    const readUpdateState = vi.fn<UpdateFooterActionInjected['readUpdateState']>()
      .mockResolvedValueOnce({ status: 'ready', target: 'a'.repeat(40) })
      .mockResolvedValueOnce({ status: 'paused', phase: 'worktree' })
    const restartForUpdate = vi.fn<UpdateFooterActionInjected['restartForUpdate']>()
      .mockResolvedValue({ accepted: false, status: 'paused' })
    render(<UpdateFooterAction {...updateProps(readUpdateState, restartForUpdate)} />)

    fireEvent.click(await screen.findByRole('button', { name: en.updateRestart }))
    await waitFor(() => { expect(screen.queryByRole('status', { name: en.updatePaused })).toBeNull() })
    expect(readUpdateState).toHaveBeenCalledTimes(2)
  })

  it('contains restart failures without exposing transport detail', async () => {
    const restartForUpdate = vi.fn<UpdateFooterActionInjected['restartForUpdate']>()
      .mockRejectedValue(new Error('private restart detail'))
    render(<UpdateFooterAction {...updateProps(async () => ({ status: 'ready', target: 'a'.repeat(40) }), restartForUpdate)} />)
    fireEvent.click(await screen.findByRole('button', { name: en.updateRestart }))
    expect(await screen.findByRole('status', { name: en.updateError })).toBeTruthy()
    expect(screen.queryByText('private restart detail')).toBeNull()
  })

  it('lets the user immediately retry a durable updater error', async () => {
    const readUpdateState = vi.fn<UpdateFooterActionInjected['readUpdateState']>()
      .mockResolvedValueOnce({ status: 'error', phase: 'prepare' })
      .mockResolvedValueOnce({ status: 'ready', target: 'c'.repeat(40) })
    render(<UpdateFooterAction {...updateProps(readUpdateState)} />)

    expect(await screen.findByRole('status', { name: en.updateError })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.updateRetry }))
    expect(await screen.findByRole('button', { name: en.updateRestart })).toBeTruthy()
    expect(readUpdateState).toHaveBeenCalledTimes(2)
  })

  it('wakes the updater before retrying a paused or failed state', async () => {
    const refreshForUpdate = vi.fn<UpdateFooterActionInjected['refreshForUpdate']>(async () => ({ accepted: true }))
    render(<UpdateFooterAction {...updateProps(async () => ({ status: 'error' }), undefined, true, refreshForUpdate)} />)

    fireEvent.click(await screen.findByRole('button', { name: en.updateRetry }))
    await waitFor(() => { expect(refreshForUpdate).toHaveBeenCalledOnce() })
  })

  it('automatically wakes the updater after a durable error', async () => {
    vi.useFakeTimers()
    const refreshForUpdate = vi.fn<UpdateFooterActionInjected['refreshForUpdate']>(async () => ({ accepted: true }))
    const readUpdateState = vi.fn<UpdateFooterActionInjected['readUpdateState']>(async () => ({ status: 'error' }))
    render(<UpdateFooterAction {...updateProps(readUpdateState, undefined, true, refreshForUpdate)} />)
    await act(async () => { await Promise.resolve() })

    expect(refreshForUpdate).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    expect(refreshForUpdate).toHaveBeenCalledOnce()
  })

  it('renders a ready update as a compact restart action', async () => {
    const target = 'b'.repeat(40)
    render(<UpdateFooterAction {...updateProps(async () => ({ status: 'ready', target }))} />)

    const card = await screen.findByTestId('phoenix-update-card')
    expect(card.getAttribute('data-update-status')).toBe('ready')
    expect(card.querySelector('[data-update-progress]')?.getAttribute('aria-valuenow')).toBe('100')
    expect(screen.getByText('bbbbbbbbbbbb')).toBeTruthy()
    expect(screen.queryByText(en.updateChannel)).toBeNull()
  })

  it('uses a compact accessible action on the collapsed rail and ignores late reads after unmount', async () => {
    const deferred = Promise.withResolvers<PhoenixUpdateSnapshot>()
    const pending = render(<UpdateFooterAction {...updateProps(() => deferred.promise, undefined, false)} />)
    pending.unmount()
    await act(async () => { deferred.resolve({ status: 'ready', target: 'a'.repeat(40) }) })

    render(<UpdateFooterAction {...updateProps(async () => ({ status: 'ready', target: 'a'.repeat(40) }), undefined, false)} />)
    const button = await screen.findByRole('button', { name: en.updateRestart })
    expect(button.textContent).toBe('')
  })
})
