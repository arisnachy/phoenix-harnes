// Retire only verified, integrated linked worktrees in the updater scratch root.
// Never force-remove a development worktree or delete an independent clone.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const legacyNames = new Set([
  'phoenix-odds-fallback',
  'phoenix-ticket-redaction-main', 'phoenix-ticket-redaction-stable',
  'phoenix-local-context-budget-stable', 'phoenix-local-context-budget',
  'phoenix-local-device',
  'phoenix-sports-reliability-main', 'phoenix-sports-reliability',
  'phoenix-sports-expert', 'phoenix-ticket-evidence-stable',
  'phoenix-ticket-evidence-main', 'phoenix-restore-progressive-main',
  'phoenix-restore-progressive-stable', 'phoenix-studio3d-orbit-stable',
  'phoenix-studio3d-orbit-main',
])
const MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000

function git(cwd, args) {
  return spawnSync('git', ['-c', 'core.longpaths=true', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export function disposableWorkspaceStatus(stdout) {
  // git worktree remove also removes ignored files. Allow only dependency
  // caches, not ignored .env, logs, databases, exports or private artifacts.
  return stdout.split('\0').filter(Boolean).every(entry =>
    entry.startsWith('!! ') && /(?:^|\/)node_modules(?:\/|$)/u.test(entry.slice(3)))
}

function eligible(path, name, root, pathKey, now) {
  if (!legacyNames.has(name.toLowerCase())
    && !existsSync(join(path, '.phoenix-disposable-worktree'))) return false
  if (/^phoenix-(?:runtime|stage|vault|.*backup)/iu.test(name)
    || existsSync(join(path, '.phoenix-keep'))) return false
  try {
    const info = lstatSync(path)
    if (!info.isDirectory() || info.isSymbolicLink() || now - info.mtimeMs < MIN_AGE_MS) return false
    if (!lstatSync(join(path, '.git')).isFile()) return false
    const common = git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const owner = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (common.status !== 0 || owner.status !== 0
      || pathKey(common.stdout.trim()) !== pathKey(owner.stdout.trim())) return false
    const head = git(path, ['rev-parse', 'HEAD'])
    if (head.status !== 0 || !/^[a-f0-9]{40}$/iu.test(head.stdout.trim())) return false
    // Require ancestry in an official remote-tracking integration branch.
    if (!['refs/remotes/origin/main', 'refs/remotes/origin/stable'].some(ref =>
      git(root, ['merge-base', '--is-ancestor', head.stdout.trim(), ref]).status === 0)) return false
    // Do not trust a status suppressed by assume-unchanged/skip-worktree flags.
    const flags = git(path, ['ls-files', '-v', '-z'])
    if (flags.status !== 0 || flags.stdout.split('\0').some(line => /^[a-zS] /u.test(line))) return false
    const status = git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'])
    if (status.status !== 0 || !disposableWorkspaceStatus(status.stdout)) return false
    return true
  } catch {
    return false
  }
}

export function retireIntegratedWorkspaces({ root, base, keep, pathKey, registered, processReferences, leaseValid }) {
  if (!registered || !leaseValid()) return
  const now = Date.now()
  let candidates
  try {
    candidates = readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^phoenix-[a-z0-9][a-z0-9_.-]*$/iu.test(entry.name))
      .map(entry => ({ name: entry.name, path: resolve(join(base, entry.name)) }))
      .filter(({ path, name }) => !keep.has(pathKey(path)) && registered.has(pathKey(path))
        && eligible(path, name, root, pathKey, now))
  } catch {
    return
  }
  if (candidates.length === 0) return
  const busy = processReferences(candidates.map(candidate => candidate.path))
  if (!busy) return
  for (const { name, path } of candidates) {
    if (!leaseValid()) return
    if (busy.has(pathKey(path)) || keep.has(pathKey(path))
      || !eligible(path, name, root, pathKey, Date.now())) continue
    const result = git(root, ['worktree', 'remove', path])
    if (result.status === 0 && !existsSync(path)) {
      console.error('[PHOENIX STORAGE] retired integrated development worktree: ' + name)
    }
  }
}
