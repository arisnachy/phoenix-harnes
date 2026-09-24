import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const updater = readFileSync(resolve('scripts/phoenix-auto-update.mjs'), 'utf8')
const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const managedUpdater = readFileSync(resolve('scripts/phoenix-managed-update.mjs'), 'utf8')
const updatePowerShell = readFileSync(resolve('update-phoenix.ps1'), 'utf8')
const desktop = readFileSync(resolve('apps/desktop-windows/Program.cs'), 'utf8')
const build = readFileSync(resolve('scripts/build.ts'), 'utf8')
const stableWorkflow = readFileSync(resolve('.github/workflows/phoenix-stable-update-channel.yml'), 'utf8')

describe('PHOENIX supervised updater runtime isolation', () => {
  it('promotes each green current main SHA to the stable release pointer', () => {
    expect(stableWorkflow).toContain('Promote stable release pointer')
    expect(stableWorkflow).toContain('"$TARGET_SHA:refs/heads/stable"')
    expect(stableWorkflow).toContain('--force-with-lease="refs/heads/stable:$stable_sha"')
  })

  it('shares updater control markers through the common Git directory across worktrees', () => {
    expect(updater).toContain('function controlDirectory(root)')
    expect(updater).toContain('return gitCommonDirectory(root) ?? gitDirectory(root)')
    expect(updater).toContain('join(controlDirectory(root), STATE_FILE)')
    expect(updater).toContain('join(controlDirectory(root), PREPARED_FILE)')
  })

  it('does not report a checkout as simply current when an older isolated runtime is still marked active', () => {
    expect(updater).toContain("const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'")
    expect(updater).toContain('function readActiveRuntime(root)')
    expect(updater).toContain('activeRuntime.target !== inspection.current')
    expect(updater).toContain('active isolated runtime is')
    expect(updater).toContain('Restart PHOENIX to reconcile the runtime')
  })

  it('uses a verified active isolated runtime as the effective update baseline', () => {
    expect(updater).toContain('function validatedActiveRuntime(root)')
    expect(updater).toContain('function effectiveCurrentCommit(root)')
    expect(updater).toContain('const activeRuntime = validatedActiveRuntime(root)')
    expect(updater).toContain('const current = activeRuntime?.target ?? sourceCurrent')
    expect(updater).toContain('prepared.base !== effectiveCurrentCommit(root)')
    expect(updater).toContain('already active in the verified isolated runtime; no update action is required')
  })

  it('allows the supervisor to stage stable while the source checkout stays on a development branch', () => {
    expect(updater).toContain("isolatedRuntime: process.env.PHOENIX_UPDATE_SUPERVISED === '1'")
    expect(updater).toContain("case 'isolate':")
  })

  it('runs the watcher from the active runtime so an isolated update becomes the new version baseline', () => {
    expect(supervisor).toContain("const activeUpdater = join(runtimeRoot, 'scripts', 'phoenix-auto-update.mjs')")
    expect(supervisor).toContain("const activeShim = join(runtimeRoot, 'scripts', 'phoenix-windows-command-shim.mjs')")
    expect(supervisor).toContain('cwd: runtimeRoot')
    expect(supervisor).toContain('PHOENIX_RUNTIME_ROOT: runtimeRoot')
  })

  it('clears the consumed prepared marker before relaunching an isolated runtime', () => {
    expect(supervisor).toContain('function clearPreparedRecord()')
    expect(supervisor).toContain('clearPreparedRecord()')
  })

  it('reanchors runtime-prepared candidates to the live HEAD before in-place activation', () => {
    expect(supervisor).toContain('function reanchorPreparedForLiveActivation(target)')
    expect(supervisor).toContain("const liveHead = gitValue(root, ['rev-parse', 'HEAD'])")
    expect(supervisor).toContain('if (prepared.base === liveHead) return true')
    expect(supervisor).toContain("mode: 'full'")
    expect(supervisor).toContain('reanchoredFromBase:')
    expect(supervisor).toContain('if (!reanchorPreparedForLiveActivation(requestedTarget))')
  })

  it('arms the prepared restart bridge after updater-driven incremental client builds', () => {
    expect(build).toContain("if (scope === 'client') armPreparedRestart(root, buildEnvironment)")
    expect(build).toContain("'phoenix-prepared-restart-bridge.mjs'")
    expect(build).toContain("'--arm-staging'")
  })
  it('namespaces persistent updater worktrees per checkout so stale clones cannot block updates', () => {
    expect(updater).toContain("import { createHash } from 'node:crypto'")
    expect(updater).toContain('function stageIdentity(root)')
    expect(updater).toContain('`phoenix-stage-${stageIdentity(root)}`')
    expect(supervisor).toContain('function stageIdentity()')
    expect(supervisor).toContain('`phoenix-stage-${stageIdentity()}`')
    expect(supervisor).toContain('`phoenix-runtime-${stageIdentity()}-${target.slice(0, 12)}`')
  })


  it('fails desktop startup closed after a newer stable target is known but cannot be activated', () => {
    expect(managedUpdater).toContain("const STARTUP_CHECK = process.argv.includes('--startup')")
    expect(managedUpdater).toContain('let staleTargetDiscovered = false')
    expect(managedUpdater).toContain('process.exitCode = 13')
    expect(managedUpdater).toContain("blockStaleStartup('update/preflight failed after discovering a newer stable target')")
  })

  it('propagates managed updater semantic exit codes through PowerShell to the desktop', () => {
    expect(updatePowerShell).toContain("if ($null -ne $code -and $code -ne 0) { exit $code }")
    expect(updatePowerShell).toContain("$code -eq 13")
    expect(desktop).toContain('if (updateProcess.ExitCode == 13)')
    expect(desktop).toContain('La versión vieja no se iniciará')
  })

})
