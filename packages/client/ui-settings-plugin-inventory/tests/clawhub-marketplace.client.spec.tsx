// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ClawHubMarketplace } from '../src/client/ClawHubMarketplace.tsx'
import { es } from '../src/client/locales.ts'

afterEach(cleanup)

it('shows real ClawHub Skills from the existing plugin area without silently installing them', async () => {
  const browseClawHub = vi.fn(async () => ({
    source: 'clawhub' as const, family: 'skill' as const,
    items: [{ name: '@openclaw/skill-example', displayName: 'Skill Example',
      description: 'Published instructions', version: '1.0.0',
      family: 'skill' as const, official: false, installed: false }],
  }))
  const readClawHubState = vi.fn(async () => ({
    cli: 'managed' as const, openclaw: 'missing' as const,
    skillsDirectory: 'C:/example/skills', pluginExecution: 'not-configured' as const,
  }))
  const installClawHubSkill = vi.fn(async () => ({
    name: '@openclaw/skill-example', family: 'skill' as const,
    status: 'installed-skill' as const, detail: 'Installed',
  }))
  render(<ClawHubMarketplace browseClawHub={browseClawHub}
    readClawHubState={readClawHubState} installClawHubSkill={installClawHubSkill}
    t={key => es[key]} />)
  expect(await screen.findByText('Skill Example')).toBeTruthy()
  expect(installClawHubSkill).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: es.clawInstall }))
  await waitFor(() => expect(installClawHubSkill).toHaveBeenCalledWith({
    name: '@openclaw/skill-example', family: 'skill',
  }))
})

it('shows official code plugins without offering to run native code inside Kira', async () => {
  const browseClawHub = vi.fn(async ({ family }: { family: 'skill' | 'code-plugin' | 'bundle-plugin' }) => ({
    source: 'clawhub' as const, family,
    items: family === 'skill' ? [] : [{ name: '@openclaw/example',
      displayName: 'Example Plugin', description: 'Official connector',
      version: '2.0.0', official: true, installed: false, family }],
  }))
  render(<ClawHubMarketplace browseClawHub={browseClawHub}
    readClawHubState={async () => ({ cli: 'managed', openclaw: 'available',
      skillsDirectory: 'skills', pluginExecution: 'openclaw-runtime' })}
    installClawHubSkill={vi.fn()} t={key => es[key]} />)
  fireEvent.click(screen.getByRole('button', { name: es.clawCodePlugins }))
  expect(await screen.findByText('Example Plugin')).toBeTruthy()
  expect(screen.getByText(es.clawPluginUnavailable)).toBeTruthy()
  expect(screen.queryByRole('button', { name: es.clawInstall })).toBeNull()
})
