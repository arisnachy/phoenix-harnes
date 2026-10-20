import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workflow = readFileSync(fileURLToPath(new URL('../.github/workflows/phoenix-evolution-watch.yml', import.meta.url)), 'utf8')
const begin = workflow.indexOf('      - name: Refresh inbox with stable main')
const runMarker = '        run: |\n'
const start = workflow.indexOf(runMarker, begin) + runMarker.length
const finish = workflow.indexOf('\n      - name: Observe official upstream heads', start)
assert(begin >= 0 && start >= runMarker.length && finish > start)
const command = workflow.slice(start, finish).split('\n').map(line => line.replace(/^          /, '')).join('\n')
assert.match(workflow, /refresh_ready: \$\{\{ steps\.refresh\.outputs\.ready \}\}/)
assert.match(workflow, /if: needs\.observe-contracts\.outputs\.refresh_ready == 'true'/)
assert.equal((workflow.match(/if: steps\.refresh\.outputs\.ready == 'true'/g) || []).length, 2)

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}
function scenario(diverged) {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-evolution-watch-'))
  const remote = join(root, 'remote.git')
  git(root, 'init', '--bare', remote)
  const clone = join(root, 'checkout')
  git(root, 'clone', remote, clone)
  git(clone, 'config', 'user.name', 'Test')
  git(clone, 'config', 'user.email', 'test@example.test')
  git(clone, 'checkout', '-b', 'main')
  writeFileSync(join(clone, 'shared.txt'), 'shared\n')
  git(clone, 'add', 'shared.txt')
  git(clone, 'commit', '-m', 'common ancestor')
  git(clone, 'push', '-u', 'origin', 'main')
  git(clone, 'checkout', '-b', 'phoenix/evolution-inbox')
  if (diverged) {
    writeFileSync(join(clone, 'shared.txt'), 'inbox change\n')
    git(clone, 'commit', '-am', 'inbox unique change')
  }
  git(clone, 'push', '-u', 'origin', 'phoenix/evolution-inbox')
  const previousInbox = git(clone, 'rev-parse', 'HEAD')
  git(clone, 'checkout', 'main')
  writeFileSync(join(clone, 'shared.txt'), 'main change\n')
  git(clone, 'commit', '-am', 'main advanced')
  git(clone, 'push', 'origin', 'main')
  const main = git(clone, 'rev-parse', 'HEAD')
  git(clone, 'checkout', 'phoenix/evolution-inbox')
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const issue = join(root, 'issue.log')
  const gh = join(bin, 'gh')
  writeFileSync(gh, '#!/bin/sh\nif [ "$1" = issue ] && [ "$2" = list ]; then printf "%s\\n" "$PHOENIX_TEST_EXISTING_ISSUE"; exit 0; fi\nif [ "$1" = issue ] && [ "$2" = create ]; then printf "%s\\n" "$*" >> "$PHOENIX_TEST_ISSUE_LOG"; exit 0; fi\nexit 2\n')
  chmodSync(gh, 0o755)
  const output = join(root, 'github-output.txt')
  const env = { ...process.env, INBOX_BRANCH: 'phoenix/evolution-inbox', GITHUB_OUTPUT: output, GH_TOKEN: 'unit-test-only', PHOENIX_TEST_ISSUE_LOG: issue, PHOENIX_TEST_EXISTING_ISSUE: '', PATH: bin + ':' + process.env.PATH }
  return { root, remote, clone, output, issue, env, previousInbox, main }
}

test('divergent inbox with conflicts is preserved and downstream execution is disabled', { skip: process.platform === 'win32' }, () => {
  const s = scenario(true)
  try {
    const result = spawnSync('bash', ['-c', command], { cwd: s.clone, env: s.env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(readFileSync(s.output, 'utf8'), /^ready=false$/m)
    assert.equal(git(s.clone, 'rev-parse', 'HEAD'), s.previousInbox)
    assert.equal(git(s.clone, 'ls-remote', s.remote, 'refs/heads/phoenix/evolution-inbox').split(/\s+/)[0], s.previousInbox)
    assert.equal(git(s.clone, 'ls-remote', s.remote, 'refs/heads/main').split(/\s+/)[0], s.main)
    assert.notEqual(spawnSync('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: s.clone }).status, 0)
    assert.match(readFileSync(s.issue, 'utf8'), /evolution-inbox-reconciliation/)
  } finally { rmSync(s.root, { recursive: true, force: true }) }
})

test('clean fast-forward updates inbox and records ready=true', { skip: process.platform === 'win32' }, () => {
  const s = scenario(false)
  try {
    const result = spawnSync('bash', ['-c', command], { cwd: s.clone, env: s.env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(readFileSync(s.output, 'utf8'), /^ready=true$/m)
    assert.equal(git(s.clone, 'ls-remote', s.remote, 'refs/heads/phoenix/evolution-inbox').split(/\s+/)[0], s.main)
  } finally { rmSync(s.root, { recursive: true, force: true }) }
})

test('existing reconciliation issue is reused', { skip: process.platform === 'win32' }, () => {
  const s = scenario(true)
  try {
    const result = spawnSync('bash', ['-c', command], { cwd: s.clone, env: { ...s.env, PHOENIX_TEST_EXISTING_ISSUE: '42' }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(readFileSync(s.output, 'utf8'), /^ready=false$/m)
    assert.throws(() => readFileSync(s.issue, 'utf8'), /ENOENT/)
  } finally { rmSync(s.root, { recursive: true, force: true }) }
})
