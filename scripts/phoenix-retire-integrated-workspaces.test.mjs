import test from 'node:test'
import assert from 'node:assert/strict'
import { disposableWorkspaceStatus } from './phoenix-retire-integrated-workspaces.mjs'

test('only clean worktrees and ignored dependency caches can be retired', () => {
  assert.equal(disposableWorkspaceStatus(''), true)
  assert.equal(disposableWorkspaceStatus('!! node_modules/\0!! packages/core/node_modules/\0'), true)
  for (const status of ['?? draft.txt\0', ' M package.json\0', '!! .env\0', '!! data.sqlite\0', '!! reports/\0', '!! node_modules/\0!! private.txt\0']) {
    assert.equal(disposableWorkspaceStatus(status), false, status)
  }
})

import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { retireIntegratedWorkspaces } from './phoenix-retire-integrated-workspaces.mjs'

test('retirement requires integration, an idle lease, clean status and no private ignored files', t => {
  const base = mkdtempSync(join(tmpdir(), 'phoenix-retire-'))
  t.after(() => rmSync(base, { recursive: true, force: true }))
  const root = join(base, 'repo')
  mkdirSync(root)
  function git(cwd, args) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  git(root, ['init'])
  git(root, ['config', 'user.name', 'Storage Test'])
  git(root, ['config', 'user.email', 'storage@example.invalid'])
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n.env\n')
  git(root, ['add', '.gitignore'])
  git(root, ['commit', '-m', 'base'])
  const head = git(root, ['rev-parse', 'HEAD'])
  git(root, ['update-ref', 'refs/remotes/origin/main', head])
  const names = ['phoenix-odds-fallback', 'phoenix-ticket-redaction-main', 'phoenix-local-device', 'phoenix-sports-expert', 'phoenix-ticket-evidence-main', 'phoenix-studio3d-orbit-main']
  const paths = names.map(name => join(base, name))
  for (const path of paths) git(root, ['worktree', 'add', '--detach', path, head])
  mkdirSync(join(paths[0], 'node_modules'))
  writeFileSync(join(paths[0], 'node_modules', 'cache.txt'), 'generated')
  writeFileSync(join(paths[1], '.env'), 'private')
  writeFileSync(join(paths[2], 'draft.txt'), 'uncommitted')
  writeFileSync(join(paths[3], '.phoenix-keep'), '')
  git(paths[4], ['commit', '--allow-empty', '-m', 'not integrated'])
  const old = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
  for (const path of paths) utimesSync(path, old, old)
  const key = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
  const registered = new Set(paths.map(key))
  const config = { root, base, keep: new Set(), pathKey: key, registered,
    processReferences: () => new Set([key(paths[5])]), leaseValid: () => false }
  retireIntegratedWorkspaces(config)
  assert.ok(paths.every(existsSync))
  retireIntegratedWorkspaces({ ...config, leaseValid: () => true })
  assert.equal(existsSync(paths[0]), false)
  assert.ok(paths.slice(1).every(existsSync))
})
