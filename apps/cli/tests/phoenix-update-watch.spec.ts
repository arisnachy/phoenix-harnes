import { describe, expect, it } from 'vitest'
import { phoenixUpdateWatcherPolicy } from '../src/phoenix-update-watch.ts'

describe('PHOENIX update watcher ownership', () => {
  it('keeps ecosystem watchers alive when Windows supervision owns stable activation', () => {
    expect(phoenixUpdateWatcherPolicy({
      PHOENIX_UPDATE_SUPERVISED: '1',
      PHOENIX_UPDATE_MODE: 'auto',
      PHOENIX_UPSTREAM_UPDATE_MODE: 'auto',
      PHOENIX_CODEX_UPDATE_MODE: 'auto',
    })).toEqual({
      supervised: true,
      startStableWatcher: false,
      startPreparedRestartBridge: true,
      startUpstreamWatcher: true,
      startCodexWatcher: true,
    })
  })

  it('lets each ecosystem watcher be disabled independently', () => {
    expect(phoenixUpdateWatcherPolicy({
      PHOENIX_UPDATE_SUPERVISED: '1',
      PHOENIX_AUTO_UPDATE: '0',
      PHOENIX_UPSTREAM_UPDATE_MODE: 'off',
      PHOENIX_CODEX_UPDATE_MODE: 'off',
    })).toEqual({
      supervised: true,
      startStableWatcher: false,
      startPreparedRestartBridge: false,
      startUpstreamWatcher: false,
      startCodexWatcher: false,
    })
  })

  it('keeps the ordinary Host-owned stable watcher outside supervisor mode', () => {
    expect(phoenixUpdateWatcherPolicy({})).toEqual({
      supervised: false,
      startStableWatcher: true,
      startPreparedRestartBridge: false,
      startUpstreamWatcher: true,
      startCodexWatcher: true,
    })
  })
})
