import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(name: string): string {
  return readFileSync(join(root, 'scripts', name), 'utf8')
}

describe('PHOENIX updater remote-tracking fetches', () => {
  it('force-refreshes stable channel and main observations in the source-checkout watcher', () => {
    const text = source('phoenix-auto-update.mjs')

    expect(text).toContain('`+refs/heads/${CHANNEL_BRANCH}:refs/remotes/${REMOTE}/${CHANNEL_BRANCH}`')
    expect(text).toContain('`+refs/heads/${manifest.sourceBranch}:refs/remotes/${REMOTE}/${manifest.sourceBranch}`')
  })

  it('force-refreshes managed-install observations through the configured remote', () => {
    const text = source('phoenix-managed-update.mjs')

    expect(text).toContain('`+refs/heads/${CHANNEL_BRANCH}:refs/remotes/${REMOTE}/${CHANNEL_BRANCH}`')
    expect(text).toContain('`+refs/heads/main:refs/remotes/${REMOTE}/main`')
    expect(text).not.toContain("'refs/heads/main:refs/remotes/origin/main'")
  })
})
