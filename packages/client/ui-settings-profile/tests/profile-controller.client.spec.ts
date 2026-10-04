import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@phoenix-ai/dsh-client-runtime/client'
import { UserProfileForm } from '../src/client/profile-controller.ts'
import type { UserProfileSettings } from '../src/client/types.ts'

const persisted: UserProfileSettings = {
  assistantName: 'KIRA',
  assistantGender: 'feminine',
  preferredName: 'Arisnachy',
  dateOfBirth: '1982-02-20',
  gender: 'masculino',
  pronouns: 'él',
  tone: 'directo y cálido',
  consent: {
    preferredName: true,
    dateOfBirth: false,
    gender: true,
    pronouns: false,
    tone: true,
    family: false,
  },
}

function scopeHarness() {
  let snapshot: SettingsScopeSnapshot<UserProfileSettings> = {
    status: 'loading',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const scope: SettingsScope<UserProfileSettings> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(() => Promise.resolve()),
    unset: vi.fn(() => Promise.resolve()),
  }
  return {
    scope,
    publish(next: SettingsScopeSnapshot<UserProfileSettings>) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

describe('UserProfileForm hydration', () => {
  it('adopts the first persisted Host snapshot when the settings scope becomes ready', () => {
    const harness = scopeHarness()
    const form = new UserProfileForm(harness.scope)

    harness.publish({
      status: 'ready',
      value: persisted,
      base: {},
      user: persisted,
      revision: 4,
      writable: true,
      mode: 'host',
    })

    const state = form.store.getSnapshot()
    expect(state.available).toBe(true)
    expect(state.dirty).toBe(false)
    expect(state.preferredName.text).toBe('Arisnachy')
    expect(state.dateOfBirth.text).toBe('1982-02-20')
    expect(state.gender.text).toBe('masculino')
    expect(state.tone.text).toBe('directo y cálido')
    expect(state.consent.preferredName).toBe(true)

    form.dispose()
  })

  it('keeps a real local draft when a later Host snapshot arrives', () => {
    const harness = scopeHarness()
    const form = new UserProfileForm(harness.scope)
    harness.publish({
      status: 'ready',
      value: persisted,
      base: {},
      user: persisted,
      revision: 4,
      writable: true,
      mode: 'host',
    })

    form.inject().edit('preferredName', 'Ari local')
    harness.publish({
      status: 'ready',
      value: { ...persisted, preferredName: 'Ari remoto' },
      base: {},
      user: { ...persisted, preferredName: 'Ari remoto' },
      revision: 5,
      writable: true,
      mode: 'host',
    })

    expect(form.store.getSnapshot().preferredName.text).toBe('Ari local')
    expect(form.store.getSnapshot().dirty).toBe(true)

    form.dispose()
  })
})
