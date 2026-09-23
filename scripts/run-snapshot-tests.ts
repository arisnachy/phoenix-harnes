/** Run snapshot tests with a Windows-safe application launch mode. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.ts'

export type SnapshotMode = 'replay' | 'record' | 'refresh'

const root = resolve(import.meta.dirname, '..')
const builtAgent = resolve(root, 'packages/examples/acp-demo/lib/bin.js')
const requiredRuntimeArtifacts = [
  resolve(root, 'vendor/cordis/lib/index.js'),
  resolve(root, 'packages/voice/voice/lib/typert.host.js'),
  resolve(root, 'packages/interaction/commands/lib/typert.host.js'),
  resolve(root, 'packages/goal/goal/lib/typert.host.js'),
  resolve(root, 'packages/typert/registry/lib/index.js'),
  resolve(root, 'packages/api/gateway/lib/index.js'),
] as const

/** Resolve the snapshot mode from the public package command. */
export function snapshotMode(raw: string | undefined): SnapshotMode {
  switch (raw) {
    case 'replay':
    case 'record':
    case 'refresh':
      return raw
    default:
      throw new Error(`snapshot runner: expected replay | record | refresh, got ${JSON.stringify(raw)}.`)
  }
}

/** Windows boots snapshots from compiled artifacts to avoid source-loader startup stalls. */
export function shouldUseBuiltExamples(
  platform = process.platform,
  configuredMode = process.env.DSH_EXAMPLE_MODE,
): boolean {
  return configuredMode === 'lib' || platform === 'win32'
}

function runPnpm(args: string[], env: NodeJS.ProcessEnv): void {
  const invocation = pnpmInvocation(args, env)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.signal !== null) throw new Error(`snapshot runner: pnpm ${args.join(' ')} exited on ${result.signal}.`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function main(args: string[]): void {
  const mode = snapshotMode(args[0])
  const forwarded = args.slice(1).filter(value => value !== '--')
  const configuredExampleMode = process.env.DSH_EXAMPLE_MODE
  const useBuilt = shouldUseBuiltExamples()
  const automaticWindowsLib = process.platform === 'win32' && configuredExampleMode !== 'lib'
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_SNAPSHOT: mode,
    ...(useBuilt ? { DSH_EXAMPLE_MODE: 'lib' } : {}),
    // The historical public snapshot command does not own the assembled Web
    // bundle suite. CI opts into lib mode explicitly after its complete build;
    // automatic Windows lib mode only replaces slow source subprocess boots.
    ...(automaticWindowsLib ? { DSH_SNAPSHOT_SKIP_WEB: '1' } : {}),
  }

  if (requiredRuntimeArtifacts.some(artifact => !existsSync(artifact))) {
    console.log('snapshot runner: runtime artifacts are missing; building Host + Client library contracts before replay.')
    runPnpm(['run', 'build:lib'], env)
  }

  if (useBuilt && !existsSync(builtAgent)) {
    console.log('snapshot runner: compiled examples are missing; building once before replay.')
    runPnpm(['run', 'build'], env)
  }

  const vitestArgs = ['exec', 'vitest', 'run', '--config', 'vitest.snapshot.config.ts']
  if (mode === 'record') vitestArgs.push('--update')
  vitestArgs.push(...forwarded)
  runPnpm(vitestArgs, env)
}

if (import.meta.main) main(process.argv.slice(2))
