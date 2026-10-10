// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'

// English-dictionary translate stub: the shell renders the same copy the
// assertions below query by accessible name.
const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never

function mountShell({ collapsed = false, width = 300 }: { collapsed?: boolean; width?: number } = {}) {
  const startSession = vi.fn()
  const toggleSidebar = vi.fn()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width }
  const root = () => (
    <SidebarRoot
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={startSession} toggleSidebar={toggleSidebar} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide} />
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    toggleSidebar,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('routes primary navigation to focused action surfaces instead of Settings navigation', () => {
    const b = mountShell()
    const features: Array<{ destination: string; label: string }> = []
    let libraries = 0
    const onFeature = (event: Event) => {
      features.push((event as CustomEvent<{ destination: string; label: string }>).detail)
    }
    const onLibrary = () => { libraries++ }
    window.addEventListener('phoenix:open-feature', onFeature)
    window.addEventListener('phoenix:open-workspace-library', onLibrary)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Home' }))
      expect(b.startSession).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
      fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
      fireEvent.click(screen.getByRole('button', { name: 'Team' }))
      fireEvent.click(screen.getByRole('button', { name: 'Library' }))
      expect(features).toEqual([
        { destination: 'discover', label: 'Discover' },
        { destination: 'connectors', label: 'Connectors' },
        { destination: 'team', label: 'Team' },
      ])
      expect(libraries).toBe(1)
    } finally {
      window.removeEventListener('phoenix:open-feature', onFeature)
      window.removeEventListener('phoenix:open-workspace-library', onLibrary)
    }
  })

  it('routes New Session (capsule + wordmark) and the column toggle', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the capsule start a session.
    const starters = screen.getAllByRole('button', { name: 'New session' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
  })

  it('renders generic brand fallbacks when no package fills the slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    const { container } = render(<SidebarRoot
      collapsed={false} width={300}
      useSessions={neverHook} useWorkspaces={neverHook}
      startSession={vi.fn()} toggleSidebar={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    expect(screen.getByText('PHOENIX')).toBeTruthy()
    expect(screen.getByText('0123456')).toBeTruthy()
    expect(container.querySelector('img[src="/phoenix-emblem.png"]')?.getAttribute('width')).toBe('38')
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('uses the warm premium sidebar geometry and maintains the accessible collapse control', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-sidebar/src/client/SidebarRoot.module.css'), 'utf8')
    expect(css).toContain('--phoenix-side-ember: #e76020')
    expect(css).toContain('border-radius: 0 22px 22px 0')
    expect(css).toContain('background: var(--phoenix-side-ember)')
    expect(css).toContain('.root:not(.collapsed) .navLink:first-child')
    expect(css).toContain('.root:not(.collapsed) .footerActions:not(:empty)')
    expect(css).toContain('.root:not(.collapsed) .regionArea')
    mountShell()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
  })

  it('hands the region its wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('switches immediately to the rail and restores expanded controls on demand', () => {
    const b = mountShell()
    b.rerender({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    b.rerender({ collapsed: false })
    expect(b.regionOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeTruthy()
  })

  it('keeps original navigation actions available while the sidebar is closed', () => {
    const b = mountShell({ collapsed: true, width: 104 })
    const received: string[] = []
    const onFeature = (e: Event) => { received.push((e as CustomEvent<{ destination: string }>).detail.destination) }
    const onLibrary = () => { received.push('library') }
    const onTeam = () => { received.push('team') }
    window.addEventListener('phoenix:open-feature', onFeature)
    window.addEventListener('phoenix:open-workspace-library', onLibrary)
    window.addEventListener('phoenix:toggle-team-directory', onTeam)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Home' }))
      fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
      fireEvent.click(screen.getByRole('button', { name: 'Connectors' }))
      fireEvent.click(screen.getByRole('button', { name: 'Team' }))
      fireEvent.click(screen.getByRole('button', { name: 'Library' }))
      expect(b.startSession).toHaveBeenCalledOnce()
      expect(received).toEqual(['discover', 'connectors', 'team', 'library'])
      expect(screen.queryByText('Discover')).toBeNull()
    } finally {
      window.removeEventListener('phoenix:open-feature', onFeature)
      window.removeEventListener('phoenix:open-workspace-library', onLibrary)
      window.removeEventListener('phoenix:toggle-team-directory', onTeam)
    }
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })
})
