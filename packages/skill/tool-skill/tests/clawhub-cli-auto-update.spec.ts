import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..', '..', '..', '..')
const load = (path: string): string => readFileSync(resolve(root, path), 'utf8')

describe('PHOENIX ClawHub CLI auto-maintenance', () => {
  it('runs a version check during install, Windows update and pnpm phoenix startup', () => {
    const installer = load('install-phoenix.ps1')
    const updater = load('update-phoenix.ps1')
    const launcher = load('scripts/phoenix-web-entry.mjs')
    expect(installer).toContain('$clawHubBootstrap --ensure --update')
    expect(updater).toContain('$clawHubBootstrap --ensure --update')
    expect(launcher).toContain("script === 'phoenix-clawhub-bootstrap.mjs' ? ['--update']")
  })

  it('keeps the previous managed CLI when a staged update fails', () => {
    const source = load('scripts/phoenix-clawhub-bootstrap.mjs')
    expect(source).toContain("const staging = join(toolchains, '.clawhub-stage-'")
    expect(source).toContain('renameSync(prefix, backup)')
    expect(source).toContain('renameSync(backup, prefix)')
    expect(source).toContain('validCli(staged)')
    expect(source).toContain("'--ignore-scripts'")
    expect(source).toContain("view', 'clawhub', 'version'")
    expect(source).toContain('clawhub-status.json')
  })

  it('offers a single managed repair action in Connectors, never a duplicate Plugins store', () => {
    const connectors = load('packages/client/ui-settings-models/src/client/ClawHubConnectorStore.tsx')
    const plugins = load('packages/client/ui-settings-plugin-inventory/src/client/PluginInventorySettingsTab.tsx')
    expect(connectors).toContain("data-clawhub-store=")
    expect(connectors).toContain('prepareClawHubCli')
    expect(plugins).not.toContain('ClawHubMarketplace')
  })
})
