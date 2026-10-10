#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Product visual baseline for automatic Windows updates. A runtime that loses
 * these defining stylesheet rules must NOT be promoted merely because the
 * TypeScript build succeeded. Keep this deliberately narrow: it protects the
 * approved look, not a user's light/dark preference.
 */
export function verifyPhoenixVisualBaseline(root) {
  const required = [
    ['packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css',
      ['.unifiedHeader', 'min-height: 68px;', '.unifiedHeader .crumbCurrent', 'text-overflow: ellipsis;']],
    ['packages/client/ui-sidebar/src/client/SidebarRoot.module.css',
      ['--phoenix-side-ember: #e76020', '.root.collapsed', '.collapsed .primaryNavigation', '.collapsed .navLink']],
    ['packages/client/ui-layout/src/client/columns.ts',
      ['export const SIDEBAR_COLLAPSED = 72']],
    ['packages/client/ui-theme/src/client/styles.ts',
      ['installThemeStyles', 'const leases = new Map', 'lease.owners += 1']],
    ['packages/client/ui-theme/styles/base.css', [':root']],
  ]
  const missing = []
  for (const [path, fragments] of required) {
    const file = resolve(root, path)
    if (!existsSync(file)) {
      missing.push(`${path}: missing theme source`)
      continue
    }
    const body = readFileSync(file, 'utf8')
    for (const fragment of fragments) {
      if (!body.includes(fragment)) missing.push(`${path}: missing ${fragment}`)
    }
  }
  const client = resolve(root, 'apps/web/dist/index.html')
  if (!existsSync(client) || readFileSync(client, 'utf8').trim().length < 100) {
    missing.push('apps/web/dist/index.html: missing built web entry')
  }
  if (missing.length > 0) {
    throw new Error(`Phoenix visual integrity check failed; update must not activate:\n${missing.join('\n')}`)
  }
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  verifyPhoenixVisualBaseline(resolve(process.cwd()))
  console.log('[PHOENIX THEME] verified approved colors, collapsed icon rail, compact header and web build')
}
