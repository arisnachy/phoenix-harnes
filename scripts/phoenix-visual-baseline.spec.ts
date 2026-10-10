import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyPhoenixVisualBaseline } from './phoenix-visual-baseline.mjs'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-visual-guard-'))
  roots.push(root)
  const files = {
    'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css':
      '.unifiedHeader { min-height: 90px; } .unifiedHeader .sessionNavRow {} .unifiedHeader .crumbCurrent { text-overflow: ellipsis; }',
    'packages/client/ui-sidebar/src/client/SidebarRoot.module.css':
      '.root.collapsed {} .collapsed .primaryNavigation {} .collapsed .navLink {} --phoenix-side-ember: #e76020;',
    'packages/client/ui-layout/src/client/columns.ts':
      'export const SIDEBAR_COLLAPSED = 104',
    'packages/client/ui-conversation/src/client/chat/ChatView.module.css':
      '.turnStatusBrand { color: #ea5b22; } .phoenixActivity::before {}',
    'packages/client/ui-theme/src/theme-settings.ts':
      "export const DEFAULT_PREFERENCE: ThemePreference = 'light'",
    'packages/client/ui-theme/src/client/styles.ts':
      'installThemeStyles const leases = new Map lease.owners += 1',
    'packages/client/ui-theme/src/styles/base.css': ':root { color-scheme: light; }',
    'apps/web/dist/index.html': '<!doctype html><html><head><title>PHOENIX</title></head><body><main>Valid compiled Phoenix frontend entry</main></body></html>',
  }
  for (const [relative, body] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('PHOENIX visual release integrity', () => {
  it('accepts the approved compact shell and global stylesheet contract', () => {
    expect(verifyPhoenixVisualBaseline(fixture())).toBe(true)
  })
  it('rejects a release missing the warm sidebar theme before activation', () => {
    const root = fixture()
    const path = join(root, 'packages/client/ui-sidebar/src/client/SidebarRoot.module.css')
    writeFileSync(path, readFileSync(path, 'utf8').replace('--phoenix-side-ember: #e76020', ''))
    expect(() => verifyPhoenixVisualBaseline(root)).toThrow('visual integrity check failed')
  })
  it('rejects an incomplete web build rather than promoting a white fallback UI', () => {
    const root = fixture()
    writeFileSync(join(root, 'apps/web/dist/index.html'), '')
    expect(() => verifyPhoenixVisualBaseline(root)).toThrow('missing built web entry')
  })
})
